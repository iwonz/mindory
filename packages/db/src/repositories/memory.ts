import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import type {
  CreateMemoryClaimInput,
  MemoryClaimRecord,
  MemoryRepository,
  MemorySearchHit,
  SearchMemoryClaimsInput,
  UpdateMemoryClaimStatusInput
} from "@mindory/core/memory";
import { memoryClaims } from "../schema.js";
import { firstOrThrow, type MindoryDatabase } from "./types.js";

export class DbMemoryRepository implements MemoryRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async createMemoryClaim(input: CreateMemoryClaimInput): Promise<MemoryClaimRecord> {
    const [row] = await this.db.insert(memoryClaims).values({
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      text: input.text,
      status: input.status,
      importance: input.importance,
      confidence: input.confidence,
      sourceRefs: input.sourceRefs,
      createdSource: input.createdSource,
      createdByPeerId: input.createdByPeerId,
      metadata: input.metadata
    }).onConflictDoUpdate({
      target: memoryClaims.id,
      set: {
        updatedAt: new Date()
      }
    }).returning();

    return mapMemory(firstOrThrow(row ? [row] : [], `Memory ${input.id} was not created.`));
  }

  async getMemoryClaim(projectId: string, memoryId: string): Promise<MemoryClaimRecord> {
    const rows = await this.db.select().from(memoryClaims).where(
      and(eq(memoryClaims.projectId, projectId), eq(memoryClaims.id, memoryId))
    ).limit(1);
    return mapMemory(firstOrThrow(rows, `Memory ${memoryId} was not found.`));
  }

  async searchMemoryClaims(input: SearchMemoryClaimsInput): Promise<MemorySearchHit[]> {
    const filters = [
      inArray(memoryClaims.projectId, input.projectIds)
    ];
    if (input.statuses && input.statuses.length > 0) {
      filters.push(inArray(memoryClaims.status, input.statuses));
    }
    if (input.types && input.types.length > 0) {
      filters.push(inArray(memoryClaims.type, input.types));
    }
    if (input.query && input.query.trim().length > 0) {
      filters.push(ilike(memoryClaims.text, `%${input.query}%`));
    }

    const rows = await this.db.select().from(memoryClaims).where(and(...filters)).orderBy(
      desc(memoryClaims.importance),
      desc(memoryClaims.confidence),
      desc(memoryClaims.updatedAt)
    ).limit(input.limit);

    return rows.map((row) => ({
      memory: mapMemory(row),
      score: Math.max(row.importance, row.confidence),
      matchReason: input.query ? "text_match" : null
    }));
  }

  async updateMemoryClaimStatus(input: UpdateMemoryClaimStatusInput): Promise<MemoryClaimRecord> {
    const [row] = await this.db.update(memoryClaims).set({
      status: input.status,
      metadata: input.metadata ?? {},
      updatedAt: new Date()
    }).where(and(eq(memoryClaims.projectId, input.projectId), eq(memoryClaims.id, input.memoryId))).returning();

    return mapMemory(firstOrThrow(row ? [row] : [], `Memory ${input.memoryId} was not updated.`));
  }
}

function mapMemory(row: typeof memoryClaims.$inferSelect): MemoryClaimRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    text: row.text,
    status: row.status,
    importance: row.importance,
    confidence: row.confidence,
    sourceRefs: row.sourceRefs,
    createdSource: row.createdSource,
    createdByPeerId: row.createdByPeerId,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
