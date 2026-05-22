import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { DocumentArtifactType, DocumentMetadataFilter } from "@mindory/core/artifacts";
import {
  ProcessingError,
  type EmbeddingsProvider,
  type SearchVectorArtifactsInput,
  type SearchVectorChunksInput,
  type UpsertVectorArtifactsInput,
  type UpsertVectorChunksInput,
  type VectorArtifactIndexResult,
  type VectorArtifactSearchHit,
  type VectorIndex,
  type VectorIndexResult,
  type VectorSearchHit
} from "@mindory/core/processing";
import type { ArtifactVectorSearchHit, ArtifactVectorSearchInput, ArtifactVectorSearchRepository } from "@mindory/core/search";
import type { DocumentChunkSearchHit, DocumentChunkSearchInput, DocumentChunkSearchRepository, SourceRef } from "@mindory/core/memory";
import type { MindoryDatabase } from "@mindory/db/repositories";

export interface PgVectorIndexOptions {
  tableName?: string;
  dimensions: number;
  db: MindoryDatabase;
  idFactory?: () => string;
}

export class PgVectorChunkIndex implements VectorIndex {
  readonly provider = "pgvector";
  readonly tableName: string;
  readonly dimensions: number;
  private readonly db: MindoryDatabase;
  private readonly idFactory: () => string;

  constructor(options: PgVectorIndexOptions) {
    this.tableName = options.tableName ?? "chunk_vector_embeddings";
    this.dimensions = options.dimensions;
    this.db = options.db;
    this.idFactory = options.idFactory ?? (() => `emb_${randomUUID()}`);
  }

  async upsertDocumentChunks(input: UpsertVectorChunksInput): Promise<VectorIndexResult[]> {
    if (input.chunks.length === 0) {
      return [];
    }

    for (const chunk of input.chunks) {
      validateDimensions(chunk.embedding, this.dimensions);
    }

    const values = input.chunks.map((chunk) => {
      const embeddingId = this.idFactory();
      return sql`(
        ${embeddingId},
        ${chunk.projectId},
        ${chunk.documentId},
        ${chunk.chunkId},
        ${chunk.content},
        ${toPgVectorLiteral(chunk.embedding)}::vector,
        ${chunk.model},
        ${chunk.dimensions},
        ${JSON.stringify(chunk.metadata)}::jsonb,
        now()
      )`;
    });

    const result = await this.db.execute(sql`
      insert into ${sql.identifier(this.tableName)}
        (embedding_id, project_id, document_id, chunk_id, content, embedding, model, dimensions, metadata, updated_at)
      values ${sql.join(values, sql`, `)}
      on conflict (chunk_id) do update set
        content = excluded.content,
        embedding = excluded.embedding,
        model = excluded.model,
        dimensions = excluded.dimensions,
        metadata = excluded.metadata,
        updated_at = now()
      returning embedding_id, chunk_id
    `);

    return readRows(result).map((row) => ({
      embeddingId: String(row.embedding_id),
      chunkId: String(row.chunk_id)
    }));
  }

  async upsertArtifactVectors(input: UpsertVectorArtifactsInput): Promise<VectorArtifactIndexResult[]> {
    if (input.artifacts.length === 0) {
      return [];
    }

    for (const artifact of input.artifacts) {
      validateDimensions(artifact.embedding, this.dimensions);
    }

    const values = input.artifacts.map((artifact) => {
      const embeddingId = this.idFactory();
      return sql`(
        ${embeddingId},
        ${artifact.projectId},
        ${artifact.documentId},
        ${artifact.artifactId},
        ${artifact.content},
        ${toPgVectorLiteral(artifact.embedding)}::vector,
        ${artifact.model},
        ${artifact.dimensions},
        ${JSON.stringify({
          ...artifact.metadata,
          artifact_type: artifact.artifactType
        })}::jsonb,
        now()
      )`;
    });

    const result = await this.db.execute(sql`
      insert into document_artifact_vectors
        (embedding_id, project_id, document_id, artifact_id, content, embedding, model, dimensions, metadata, updated_at)
      values ${sql.join(values, sql`, `)}
      on conflict (artifact_id) do update set
        content = excluded.content,
        embedding = excluded.embedding,
        model = excluded.model,
        dimensions = excluded.dimensions,
        metadata = excluded.metadata,
        updated_at = now()
      returning embedding_id, artifact_id
    `);

    return readRows(result).map((row) => ({
      embeddingId: String(row.embedding_id),
      artifactId: String(row.artifact_id)
    }));
  }

  async deleteDocumentChunks(projectId: string, documentId: string): Promise<void> {
    await this.db.execute(sql`
      delete from ${sql.identifier(this.tableName)}
      where project_id = ${projectId} and document_id = ${documentId}
    `);
  }

  async deleteDocumentArtifactVectors(projectId: string, documentId: string): Promise<void> {
    await this.db.execute(sql`
      delete from document_artifact_vectors
      where project_id = ${projectId} and document_id = ${documentId}
    `);
  }

  async searchDocumentChunks(input: SearchVectorChunksInput): Promise<VectorSearchHit[]> {
    if (input.projectIds.length === 0) {
      return [];
    }
    validateDimensions(input.embedding, this.dimensions);

    const projectFilters = sql.join(input.projectIds.map((projectId) => sql`${projectId}`), sql`, `);
    const result = await this.db.execute(sql`
      select
        vectors.project_id,
        vectors.document_id,
        vectors.chunk_id,
        vectors.content,
        vectors.metadata,
        1 - (vectors.embedding <=> ${toPgVectorLiteral(input.embedding)}::vector) as score
      from ${sql.identifier(this.tableName)}
        as vectors
      where vectors.project_id in (${projectFilters})
        and ${documentMetadataFiltersSql(sql.raw("vectors.project_id"), sql.raw("vectors.document_id"), input.metadataFilters)}
      order by vectors.embedding <=> ${toPgVectorLiteral(input.embedding)}::vector
      limit ${input.limit}
    `);

    return readRows(result).map((row) => ({
      projectId: String(row.project_id),
      documentId: String(row.document_id),
      chunkId: String(row.chunk_id),
      content: String(row.content),
      score: Number(row.score),
      metadata: readMetadata(row.metadata)
    }));
  }

  async searchArtifactVectors(input: SearchVectorArtifactsInput): Promise<VectorArtifactSearchHit[]> {
    if (input.projectIds.length === 0) {
      return [];
    }
    validateDimensions(input.embedding, this.dimensions);

    const projectFilters = sql.join(input.projectIds.map((projectId) => sql`${projectId}`), sql`, `);
    const artifactTypeFilter = input.artifactTypes && input.artifactTypes.length > 0
      ? sql`and artifacts.artifact_type in (${sql.join(input.artifactTypes.map((type) => sql`${type}`), sql`, `)})`
      : sql``;
    const result = await this.db.execute(sql`
      select
        vectors.project_id,
        vectors.document_id,
        vectors.artifact_id,
        artifacts.artifact_type,
        vectors.content,
        vectors.metadata as vector_metadata,
        artifacts.source_refs,
        artifacts.source_position,
        artifacts.metadata as artifact_metadata,
        1 - (vectors.embedding <=> ${toPgVectorLiteral(input.embedding)}::vector) as score
      from document_artifact_vectors vectors
      inner join document_artifacts artifacts
        on artifacts.id = vectors.artifact_id
        and artifacts.project_id = vectors.project_id
        and artifacts.document_id = vectors.document_id
      inner join processing_runs runs
        on runs.id = artifacts.processing_run_id
        and runs.project_id = artifacts.project_id
        and runs.document_id = artifacts.document_id
      where vectors.project_id in (${projectFilters})
        and runs.status <> 'superseded'
        ${artifactTypeFilter}
        and ${documentMetadataFiltersSql(sql.raw("vectors.project_id"), sql.raw("vectors.document_id"), input.metadataFilters)}
      order by vectors.embedding <=> ${toPgVectorLiteral(input.embedding)}::vector
      limit ${input.limit}
    `);

    return readRows(result).map((row) => {
      const vectorMetadata = readMetadata(row.vector_metadata);
      const artifactMetadata = readMetadata(row.artifact_metadata);
      const sourceRefs = readSourceRefs(row.source_refs, [{ type: "artifact", id: String(row.artifact_id) }]);
      return {
        projectId: String(row.project_id),
        documentId: String(row.document_id),
        artifactId: String(row.artifact_id),
        artifactType: String(row.artifact_type) as DocumentArtifactType,
        content: String(row.content),
        score: Number(row.score),
        metadata: {
          ...artifactMetadata,
          ...vectorMetadata,
          source_refs: sourceRefs,
          source_position: readMetadata(row.source_position),
          search_backend: "document_artifact_vectors"
        }
      };
    });
  }

  createTableSql(): string {
    return [
      `create table if not exists ${this.tableName} (`,
      "  embedding_id text primary key,",
      "  project_id text not null,",
      "  document_id text not null,",
      "  chunk_id text not null,",
      "  content text not null,",
      `  embedding vector(${this.dimensions}) not null,`,
      "  model text not null,",
      "  dimensions integer not null,",
      "  metadata jsonb not null default '{}'::jsonb,",
      "  created_at timestamptz not null default now(),",
      "  updated_at timestamptz not null default now()",
      ");"
    ].join("\n");
  }
}

export interface PgVectorDocumentChunkSearchRepositoryOptions {
  embeddings: EmbeddingsProvider;
  vectorIndex: PgVectorChunkIndex;
}

export class PgVectorDocumentChunkSearchRepository implements DocumentChunkSearchRepository {
  private readonly embeddings: EmbeddingsProvider;
  private readonly vectorIndex: PgVectorChunkIndex;

  constructor(options: PgVectorDocumentChunkSearchRepositoryOptions) {
    this.embeddings = options.embeddings;
    this.vectorIndex = options.vectorIndex;
  }

  async searchDocumentChunks(input: DocumentChunkSearchInput): Promise<DocumentChunkSearchHit[]> {
    if (!input.query) {
      return [];
    }

    const [embedding] = await this.embeddings.embedTexts({
      texts: [input.query]
    });
    if (!embedding) {
      throw new ProcessingError("embedding_provider_error", "Embedding provider returned no query embedding.");
    }

    const searchInput: SearchVectorChunksInput = {
      projectIds: input.projectIds,
      embedding: embedding.embedding,
      limit: input.limit
    };
    if (input.metadataFilters !== undefined) {
      searchInput.metadataFilters = input.metadataFilters;
    }

    return (await this.vectorIndex.searchDocumentChunks(searchInput)).map((hit) => {
      const sourceRefs = readSourceRefs(hit.metadata.source_refs, [{ type: "chunk", id: hit.chunkId }]);
      return {
        projectId: hit.projectId,
        documentId: hit.documentId,
        chunkId: hit.chunkId,
        content: hit.content,
        score: hit.score,
        sourceRefs,
        metadata: {
          ...hit.metadata,
          search_backend: "chunk_vector_embeddings",
          source_refs: sourceRefs
        }
      };
    });
  }
}

export interface PgVectorArtifactSearchRepositoryOptions {
  embeddings: EmbeddingsProvider;
  vectorIndex: PgVectorChunkIndex;
}

export class PgVectorArtifactSearchRepository implements ArtifactVectorSearchRepository {
  private readonly embeddings: EmbeddingsProvider;
  private readonly vectorIndex: PgVectorChunkIndex;

  constructor(options: PgVectorArtifactSearchRepositoryOptions) {
    this.embeddings = options.embeddings;
    this.vectorIndex = options.vectorIndex;
  }

  async searchArtifactVectors(input: ArtifactVectorSearchInput): Promise<ArtifactVectorSearchHit[]> {
    if (!input.query) {
      return [];
    }
    const [embedding] = await this.embeddings.embedTexts({
      texts: [input.query]
    });
    if (!embedding) {
      throw new ProcessingError("embedding_provider_error", "Embedding provider returned no artifact query embedding.");
    }
    const hits = await this.vectorIndex.searchArtifactVectors({
      projectIds: input.projectIds,
      embedding: embedding.embedding,
      limit: input.limit,
      ...(input.artifactTypes === undefined ? {} : { artifactTypes: input.artifactTypes }),
      ...(input.metadataFilters === undefined ? {} : { metadataFilters: input.metadataFilters })
    });
    return hits.map((hit) => ({
      projectId: hit.projectId,
      documentId: hit.documentId,
      artifactId: hit.artifactId,
      artifactType: hit.artifactType,
      content: hit.content,
      score: hit.score,
      sourceRefs: readSourceRefs(hit.metadata.source_refs, [{ type: "artifact", id: hit.artifactId }]),
      sourcePosition: readMetadata(hit.metadata.source_position),
      metadata: {
        ...hit.metadata,
        search_backend: "document_artifact_vectors",
        search_target: "artifacts"
      }
    }));
  }
}

function validateDimensions(embedding: number[], dimensions: number): void {
  if (embedding.length !== dimensions) {
    throw new ProcessingError(
      "vector_index_error",
      `Expected embedding dimensions ${dimensions}, received ${embedding.length}.`
    );
  }
}

function toPgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

type Row = Record<string, unknown>;

function readRows(result: unknown): Row[] {
  if (Array.isArray(result)) {
    return result as Row[];
  }
  if (typeof result === "object" && result !== null && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as Row[];
  }
  return [];
}

function readMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readSourceRefs(value: unknown, fallback: SourceRef[]): SourceRef[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const sourceRefs = value.filter((item): item is SourceRef => (
    typeof item === "object"
    && item !== null
    && "type" in item
    && "id" in item
    && typeof item.type === "string"
    && typeof item.id === "string"
  ));
  return sourceRefs.length > 0 ? sourceRefs : fallback;
}

function documentMetadataFiltersSql(projectIdExpression: SQL, documentIdExpression: SQL, filters: DocumentMetadataFilter[] | undefined): SQL {
  if (!filters || filters.length === 0) {
    return sql`true`;
  }

  return sql.join(filters.map((filter) => sql`
    exists (
      select 1
      from document_metadata_index metadata_filter
      where metadata_filter.project_id = ${projectIdExpression}
        and metadata_filter.document_id = ${documentIdExpression}
        and metadata_filter.key = ${filter.key}
        ${filter.unit === undefined ? sql`` : sql`and metadata_filter.unit = ${filter.unit}`}
        and ${documentMetadataFilterValueSql(filter)}
    )
  `), sql` and `);
}

function documentMetadataFilterValueSql(filter: DocumentMetadataFilter): SQL {
  const operator = filter.operator ?? "eq";

  if (operator === "between") {
    return typeof filter.minNumber === "number" && typeof filter.maxNumber === "number"
      ? sql`metadata_filter.value_number between ${filter.minNumber} and ${filter.maxNumber}`
      : sql`false`;
  }
  if (operator === "lt" || operator === "lte" || operator === "gt" || operator === "gte") {
    if (typeof filter.valueNumber !== "number") {
      return sql`false`;
    }
    switch (operator) {
      case "lt":
        return sql`metadata_filter.value_number < ${filter.valueNumber}`;
      case "lte":
        return sql`metadata_filter.value_number <= ${filter.valueNumber}`;
      case "gt":
        return sql`metadata_filter.value_number > ${filter.valueNumber}`;
      case "gte":
        return sql`metadata_filter.value_number >= ${filter.valueNumber}`;
    }
  }

  if (typeof filter.valueNumber === "number") {
    return sql`metadata_filter.value_number = ${filter.valueNumber}`;
  }
  if (typeof filter.valueText === "string") {
    return sql`metadata_filter.value_text = ${filter.valueText}`;
  }
  if (typeof filter.valueBoolean === "boolean") {
    return sql`metadata_filter.value_boolean = ${filter.valueBoolean}`;
  }
  if (typeof filter.valueTimestamp === "string") {
    return sql`metadata_filter.value_timestamp = ${filter.valueTimestamp}::timestamptz`;
  }

  return sql`false`;
}
