import { and, desc, eq, sql } from "drizzle-orm";
import type {
  CreateProcessingJobInput,
  ListProcessingJobsInput,
  ProcessingJobRecord,
  ProcessingJobStore
} from "@mindory/core/queue";
import { processingJobs } from "../schema.js";
import { firstOrThrow, type MindoryDatabase } from "./types.js";

export class DbProcessingJobStore implements ProcessingJobStore {
  readonly db: MindoryDatabase;
  private readonly idFactory: () => string;

  constructor(db: MindoryDatabase, idFactory: () => string) {
    this.db = db;
    this.idFactory = idFactory;
  }

  async createPendingJob(input: CreateProcessingJobInput): Promise<ProcessingJobRecord> {
    const [row] = await this.db.insert(processingJobs).values({
      id: this.idFactory(),
      projectId: input.projectId,
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      status: "pending",
      idempotencyKey: input.idempotencyKey,
      processorVersion: input.processorVersion,
      maxAttempts: input.maxAttempts ?? 5,
      metadata: input.metadata ?? {}
    }).onConflictDoUpdate({
      target: processingJobs.idempotencyKey,
      set: {
        updatedAt: new Date()
      }
    }).returning();

    return mapJob(firstOrThrow(row ? [row] : [], `Processing job ${input.idempotencyKey} was not created.`));
  }

  async getJob(projectId: string, jobId: string): Promise<ProcessingJobRecord> {
    const rows = await this.db.select().from(processingJobs).where(and(
      eq(processingJobs.projectId, projectId),
      eq(processingJobs.id, jobId)
    )).limit(1);
    return mapJob(firstOrThrow(rows, `Processing job ${jobId} was not found.`));
  }

  async listJobs(input: ListProcessingJobsInput): Promise<ProcessingJobRecord[]> {
    const filters = [eq(processingJobs.projectId, input.projectId)];
    if (input.status !== undefined) {
      filters.push(eq(processingJobs.status, input.status));
    }
    if (input.type !== undefined) {
      filters.push(eq(processingJobs.type, input.type));
    }

    const rows = await this.db.select().from(processingJobs).where(and(...filters)).orderBy(desc(processingJobs.updatedAt)).limit(input.limit);
    return rows.map(mapJob);
  }

  async resetJobForRetry(projectId: string, jobId: string): Promise<ProcessingJobRecord> {
    const [row] = await this.db.update(processingJobs).set({
      status: "pending",
      lastError: null,
      updatedAt: new Date(),
      startedAt: null,
      finishedAt: null
    }).where(and(
      eq(processingJobs.projectId, projectId),
      eq(processingJobs.id, jobId)
    )).returning();

    return mapJob(firstOrThrow(row ? [row] : [], `Processing job ${jobId} was not found.`));
  }

  async markJobRunning(jobId: string): Promise<ProcessingJobRecord> {
    const [row] = await this.db.update(processingJobs).set({
      status: "running",
      attempts: sql`${processingJobs.attempts} + 1`,
      updatedAt: new Date(),
      startedAt: new Date()
    }).where(eq(processingJobs.id, jobId)).returning();
    return mapJob(firstOrThrow(row ? [row] : [], `Processing job ${jobId} was not found.`));
  }

  async markJobSucceeded(jobId: string): Promise<ProcessingJobRecord> {
    const [row] = await this.db.update(processingJobs).set({
      status: "succeeded",
      lastError: null,
      updatedAt: new Date(),
      finishedAt: new Date()
    }).where(eq(processingJobs.id, jobId)).returning();
    return mapJob(firstOrThrow(row ? [row] : [], `Processing job ${jobId} was not found.`));
  }

  async markJobFailed(jobId: string, error: Error): Promise<ProcessingJobRecord> {
    const [row] = await this.db.update(processingJobs).set({
      status: "failed",
      lastError: error.message,
      updatedAt: new Date(),
      finishedAt: new Date()
    }).where(and(eq(processingJobs.id, jobId))).returning();
    return mapJob(firstOrThrow(row ? [row] : [], `Processing job ${jobId} was not found.`));
  }
}

function mapJob(row: typeof processingJobs.$inferSelect): ProcessingJobRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    targetType: row.targetType,
    targetId: row.targetId,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    processorVersion: row.processorVersion,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  };
}
