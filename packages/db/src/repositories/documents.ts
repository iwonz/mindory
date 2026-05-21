import { and, asc, desc, eq, ilike, inArray } from "drizzle-orm";
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
