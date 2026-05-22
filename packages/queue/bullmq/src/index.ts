import { createHash } from "node:crypto";
import { Job, Queue, Worker, type JobsOptions, type WorkerOptions } from "bullmq";
import {
  QueueError,
  type EnqueuedProcessingJob,
  type ProcessingJobQueue,
  type ProcessingJobQueueHandler,
  type ProcessingJobQueuePayload,
  type ProcessingJobWorker
} from "@mindory/core/queue";

export interface BullMqConnectionOptions {
  redisUrl: string;
  queuePrefix: string;
  queueName?: string;
}

export interface BullMqProcessingJobQueueOptions extends BullMqConnectionOptions {
  defaultAttempts?: number;
  backoffDelayMs?: number;
}

export interface BullMqProcessingJobWorkerOptions extends BullMqConnectionOptions {
  concurrency: number;
}

export const DEFAULT_PROCESSING_QUEUE_NAME = "processing";

export class BullMqProcessingJobQueue implements ProcessingJobQueue {
  readonly queueName: string;
  readonly queue: Queue<ProcessingJobQueuePayload>;
  private readonly defaultAttempts: number;
  private readonly backoffDelayMs: number;

  constructor(options: BullMqProcessingJobQueueOptions) {
    this.queueName = options.queueName ?? DEFAULT_PROCESSING_QUEUE_NAME;
    this.defaultAttempts = options.defaultAttempts ?? 5;
    this.backoffDelayMs = options.backoffDelayMs ?? 1_000;
    this.queue = new Queue<ProcessingJobQueuePayload>(this.queueName, {
      connection: parseRedisUrl(options.redisUrl),
      prefix: options.queuePrefix
    });
  }

  async enqueueProcessingJob(payload: ProcessingJobQueuePayload): Promise<EnqueuedProcessingJob> {
    try {
      const job = await this.queue.add(payload.type, payload, this.jobOptions(payload));
      return {
        queueName: this.queueName,
        queueJobId: String(job.id),
        processingJobId: payload.jobId,
        payload
      };
    } catch (error) {
      throw new QueueError("queue_operation_failed", `Could not enqueue processing job ${payload.jobId}.`, error);
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  async getJobCounts(): Promise<Record<string, number>> {
    const counts = await this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused");
    return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
  }

  private jobOptions(payload: ProcessingJobQueuePayload): JobsOptions {
    return {
      jobId: toBullMqJobId(payload.idempotencyKey),
      attempts: payload.maxAttempts || this.defaultAttempts,
      backoff: {
        type: "exponential",
        delay: this.backoffDelayMs
      },
      removeOnComplete: {
        age: 86_400,
        count: 1_000
      },
      removeOnFail: false
    };
  }
}

export function toBullMqJobId(idempotencyKey: string): string {
  return `mindory-${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

export class BullMqProcessingJobWorker implements ProcessingJobWorker {
  readonly queueName: string;
  private readonly options: BullMqProcessingJobWorkerOptions;
  private worker: Worker<ProcessingJobQueuePayload> | null = null;

  constructor(options: BullMqProcessingJobWorkerOptions) {
    this.queueName = options.queueName ?? DEFAULT_PROCESSING_QUEUE_NAME;
    this.options = options;
  }

  async start(handler: ProcessingJobQueueHandler): Promise<void> {
    if (this.worker) {
      return;
    }

    const workerOptions: WorkerOptions = {
      connection: parseRedisUrl(this.options.redisUrl),
      prefix: this.options.queuePrefix,
      concurrency: this.options.concurrency
    };

    this.worker = new Worker<ProcessingJobQueuePayload>(
      this.queueName,
      async (job: Job<ProcessingJobQueuePayload>) => handler(job.data),
      workerOptions
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}

export interface ParsedRedisConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

export function parseRedisUrl(redisUrl: string): ParsedRedisConnection {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new QueueError("queue_operation_failed", "Redis URL must use redis:// or rediss://.");
  }

  const db = url.pathname && url.pathname !== "/" ? Number.parseInt(url.pathname.slice(1), 10) : undefined;
  if (db !== undefined && Number.isNaN(db)) {
    throw new QueueError("queue_operation_failed", "Redis URL database must be numeric.");
  }

  const connection: ParsedRedisConnection = {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379
  };

  if (url.username) {
    connection.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    connection.password = decodeURIComponent(url.password);
  }
  if (db !== undefined) {
    connection.db = db;
  }
  if (url.protocol === "rediss:") {
    connection.tls = {};
  }

  return connection;
}
