import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { SourceRef } from "@mindory/core/memory";
import type { CreateDocumentInput, DocumentRecord, DocumentRepository, ListDocumentsInput, UpdateDocumentStatusInput } from "@mindory/core/documents";
import type { DocumentChunkSearchInput, DocumentChunkSearchHit, DocumentChunkSearchRepository } from "@mindory/core/memory";
import type { DocumentChunkRecord, DocumentChunkRepository, ReplaceDocumentChunksInput } from "@mindory/core/processing";
import { chunks, documents } from "../schema.js";
import { firstOrThrow, type MindoryDatabase } from "./types.js";

export class DbDocumentRepository implements DocumentRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
    const [row] = await this.db.insert(documents).values({
      id: input.id,
      projectId: input.projectId,
      title: input.title ?? null,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
      status: input.status,
      source: input.source,
      metadata: input.metadata ?? {}
    }).returning();

    return mapDocument(firstOrThrow(row ? [row] : [], `Document ${input.id} was not created.`));
  }

  async getDocument(projectId: string, documentId: string): Promise<DocumentRecord> {
    const rows = await this.db.select().from(documents).where(and(eq(documents.projectId, projectId), eq(documents.id, documentId))).limit(1);
    return mapDocument(firstOrThrow(rows, `Document ${documentId} was not found.`));
  }

  async listDocuments(input: ListDocumentsInput): Promise<DocumentRecord[]> {
    const filters = [eq(documents.projectId, input.projectId)];
    if (input.status) {
      filters.push(eq(documents.status, input.status));
    }

    const rows = await this.db.select().from(documents).where(and(...filters)).orderBy(desc(documents.updatedAt)).limit(input.limit);
    return rows.map(mapDocument);
  }

  async updateDocumentStatus(input: UpdateDocumentStatusInput): Promise<DocumentRecord> {
    const [row] = await this.db.update(documents).set({
      status: input.status,
      metadata: input.metadata ?? {},
      updatedAt: new Date()
    }).where(and(eq(documents.projectId, input.projectId), eq(documents.id, input.documentId))).returning();

    return mapDocument(firstOrThrow(row ? [row] : [], `Document ${input.documentId} was not updated.`));
  }
}

export class DbDocumentChunkSearchRepository implements DocumentChunkSearchRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async searchDocumentChunks(input: DocumentChunkSearchInput): Promise<DocumentChunkSearchHit[]> {
    const artifactHits = await this.searchArtifactTextSpans(input);
    if (artifactHits.length > 0) {
      return artifactHits;
    }

    const rows = await this.db.select().from(chunks).where(and(
      inArray(chunks.projectId, input.projectIds),
      ilike(chunks.content, `%${input.query}%`)
    )).limit(input.limit);

    return rows.map((row) => ({
      projectId: row.projectId,
      documentId: row.documentId,
      chunkId: row.id,
      content: row.content,
      score: 1,
      sourceRefs: [{ type: "chunk", id: row.id }],
      metadata: row.metadata
    }));
  }

  private async searchArtifactTextSpans(input: DocumentChunkSearchInput): Promise<DocumentChunkSearchHit[]> {
    if (!input.query || input.projectIds.length === 0) {
      return [];
    }

    const projectFilters = sql.join(input.projectIds.map((projectId) => sql`${projectId}`), sql`, `);
    const result = await this.db.execute(sql`
      select
        spans.project_id,
        spans.document_id,
        spans.id as span_id,
        spans.artifact_id,
        spans.content,
        spans.metadata,
        artifacts.processing_run_id,
        ts_rank_cd(to_tsvector('simple', spans.content), plainto_tsquery('simple', ${input.query})) as score
      from document_artifact_text_spans spans
      inner join document_artifacts artifacts on artifacts.id = spans.artifact_id
      inner join processing_runs runs on runs.id = artifacts.processing_run_id
      where spans.project_id in (${projectFilters})
        and spans.span_type = 'text_chunk'
        and runs.status <> 'superseded'
        and to_tsvector('simple', spans.content) @@ plainto_tsquery('simple', ${input.query})
      order by score desc, spans.created_at desc
      limit ${input.limit}
    `);

    return readRows(result).map((row) => {
      const metadata = readMetadata(row.metadata);
      const chunkId = readMetadataString(metadata, "chunk_id") ?? String(row.artifact_id);
      const sourceRefs = readSourceRefs(metadata.source_refs, [
        { type: "artifact", id: String(row.artifact_id) },
        { type: "processing_run", id: String(row.processing_run_id) },
        { type: "chunk", id: chunkId }
      ]);
      return {
        projectId: String(row.project_id),
        documentId: String(row.document_id),
        chunkId,
        content: String(row.content),
        score: Number(row.score),
        sourceRefs,
        metadata: {
          ...metadata,
          artifact_id: String(row.artifact_id),
          text_span_id: String(row.span_id),
          processing_run_id: String(row.processing_run_id),
          search_backend: "artifact_text_spans_full_text"
        }
      };
    });
  }
}

export class DbDocumentChunkRepository implements DocumentChunkRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async replaceDocumentChunks(input: ReplaceDocumentChunksInput): Promise<DocumentChunkRecord[]> {
    await this.db.delete(chunks).where(and(
      eq(chunks.projectId, input.projectId),
      eq(chunks.documentId, input.documentId)
    ));

    if (input.chunks.length === 0) {
      return [];
    }

    const rows = await this.db.insert(chunks).values(input.chunks.map((chunk) => ({
      id: chunk.id,
      projectId: chunk.projectId,
      documentId: chunk.documentId,
      chunkIndex: chunk.index,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      metadata: chunk.metadata
    }))).returning();

    return rows.map(mapChunk);
  }

  async listDocumentChunks(projectId: string, documentId: string): Promise<DocumentChunkRecord[]> {
    const rows = await this.db.select().from(chunks).where(and(
      eq(chunks.projectId, projectId),
      eq(chunks.documentId, documentId)
    )).orderBy(asc(chunks.chunkIndex));

    return rows.map(mapChunk);
  }

  async updateChunkEmbeddingIds(input: Array<{ chunkId: string; embeddingId: string }>): Promise<void> {
    for (const item of input) {
      await this.db.update(chunks).set({
        embeddingId: item.embeddingId
      }).where(eq(chunks.id, item.chunkId));
    }
  }
}

function mapDocument(row: typeof documents.$inferSelect): DocumentRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    status: row.status,
    source: row.source,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapChunk(row: typeof chunks.$inferSelect): DocumentChunkRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    index: row.chunkIndex,
    content: row.content,
    tokenCount: row.tokenCount ?? 0,
    embeddingId: row.embeddingId,
    metadata: {
      ...row.metadata,
      start_offset: typeof row.metadata.start_offset === "number" ? row.metadata.start_offset : 0,
      end_offset: typeof row.metadata.end_offset === "number" ? row.metadata.end_offset : 0
    },
    createdAt: row.createdAt
  };
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

function readMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
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
