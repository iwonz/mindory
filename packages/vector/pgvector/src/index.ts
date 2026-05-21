import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  ProcessingError,
  type EmbeddingsProvider,
  type SearchVectorChunksInput,
  type UpsertVectorChunksInput,
  type VectorIndex,
  type VectorIndexResult,
  type VectorSearchHit
} from "@mindory/core/processing";
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

  async deleteDocumentChunks(projectId: string, documentId: string): Promise<void> {
    await this.db.execute(sql`
      delete from ${sql.identifier(this.tableName)}
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
        project_id,
        document_id,
        chunk_id,
        content,
        metadata,
        1 - (embedding <=> ${toPgVectorLiteral(input.embedding)}::vector) as score
      from ${sql.identifier(this.tableName)}
      where project_id in (${projectFilters})
      order by embedding <=> ${toPgVectorLiteral(input.embedding)}::vector
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

    return (await this.vectorIndex.searchDocumentChunks({
      projectIds: input.projectIds,
      embedding: embedding.embedding,
      limit: input.limit
    })).map((hit) => {
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
