export type ProcessingJobType =
  | "document.scan"
  | "document.extract"
  | "document.chunk"
  | "document.embed"
  | "document.index"
  | "memory.derive"
  | "session.summarize";

export type ProcessingJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "dead";

export interface ProcessingJobRecord {
  id: string;
  projectId: string;
  type: ProcessingJobType;
  targetType: string;
  targetId: string;
  status: ProcessingJobStatus;
  idempotencyKey: string;
  processorVersion: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface CreateProcessingJobInput {
  projectId: string;
  type: ProcessingJobType;
  targetType: string;
  targetId: string;
  idempotencyKey: string;
  processorVersion: string;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
}

export interface ListProcessingJobsInput {
  projectId: string;
  status?: ProcessingJobStatus;
  type?: ProcessingJobType;
  limit: number;
}

export interface ProcessingJobQueuePayload {
  jobId: string;
  projectId: string;
  type: ProcessingJobType;
  targetType: string;
  targetId: string;
  idempotencyKey: string;
  processorVersion: string;
  maxAttempts: number;
  metadata: Record<string, unknown>;
}

export interface EnqueuedProcessingJob {
  queueName: string;
  queueJobId: string;
  processingJobId: string;
  payload: ProcessingJobQueuePayload;
}

export interface ProcessingJobQueue {
  enqueueProcessingJob(payload: ProcessingJobQueuePayload): Promise<EnqueuedProcessingJob>;
  close(): Promise<void>;
}

export interface ProcessingJobWorker {
  start(handler: ProcessingJobQueueHandler): Promise<void>;
  close(): Promise<void>;
}

export type ProcessingJobQueueHandler = (payload: ProcessingJobQueuePayload) => Promise<void>;

export interface ProcessingJobStore {
  createPendingJob(input: CreateProcessingJobInput): Promise<ProcessingJobRecord>;
  getJob(projectId: string, jobId: string): Promise<ProcessingJobRecord>;
  listJobs(input: ListProcessingJobsInput): Promise<ProcessingJobRecord[]>;
  resetJobForRetry(projectId: string, jobId: string): Promise<ProcessingJobRecord>;
  markJobRunning(jobId: string): Promise<ProcessingJobRecord>;
  markJobSucceeded(jobId: string): Promise<ProcessingJobRecord>;
  markJobFailed(jobId: string, error: Error): Promise<ProcessingJobRecord>;
}

export interface ProcessingJobProcessorContext {
  job: ProcessingJobRecord;
  payload: ProcessingJobQueuePayload;
}

export interface ProcessingJobProcessor {
  readonly type: ProcessingJobType;
  readonly processorVersion: string;
  process(context: ProcessingJobProcessorContext): Promise<void>;
}

export interface ProcessingJobProcessorRegistry {
  getProcessor(type: ProcessingJobType): ProcessingJobProcessor | undefined;
}

export interface ProcessingJobDispatcherOptions {
  store: ProcessingJobStore;
  queue: ProcessingJobQueue;
}

export class ProcessingJobDispatcher {
  readonly store: ProcessingJobStore;
  readonly queue: ProcessingJobQueue;

  constructor(options: ProcessingJobDispatcherOptions) {
    this.store = options.store;
    this.queue = options.queue;
  }

  async createAndEnqueue(input: CreateProcessingJobInput): Promise<EnqueuedProcessingJob> {
    const job = await this.store.createPendingJob(input);
    return this.queue.enqueueProcessingJob(toQueuePayload(job));
  }

  async retry(projectId: string, jobId: string): Promise<EnqueuedProcessingJob> {
    const job = await this.store.resetJobForRetry(projectId, jobId);
    return this.queue.enqueueProcessingJob(toQueuePayload(job));
  }
}

export interface ProcessingJobRunnerOptions {
  store: ProcessingJobStore;
  processors: ProcessingJobProcessorRegistry;
}

export class ProcessingJobRunner {
  readonly store: ProcessingJobStore;
  readonly processors: ProcessingJobProcessorRegistry;

  constructor(options: ProcessingJobRunnerOptions) {
    this.store = options.store;
    this.processors = options.processors;
  }

  async run(payload: ProcessingJobQueuePayload): Promise<void> {
    const processor = this.processors.getProcessor(payload.type);
    if (!processor) {
      throw new QueueError("processor_not_found", `No processor registered for ${payload.type}.`);
    }

    const runningJob = await this.store.markJobRunning(payload.jobId);

    try {
      await processor.process({
        job: runningJob,
        payload
      });
      await this.store.markJobSucceeded(payload.jobId);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      await this.store.markJobFailed(payload.jobId, normalizedError);
      throw normalizedError;
    }
  }
}

export type QueueErrorCode =
  | "processor_not_found"
  | "queue_not_implemented"
  | "queue_operation_failed";

export class QueueError extends Error {
  readonly code: QueueErrorCode;
  readonly cause?: unknown;

  constructor(code: QueueErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "QueueError";
    this.code = code;
    this.cause = cause;
  }
}

export function toQueuePayload(job: ProcessingJobRecord): ProcessingJobQueuePayload {
  return {
    jobId: job.id,
    projectId: job.projectId,
    type: job.type,
    targetType: job.targetType,
    targetId: job.targetId,
    idempotencyKey: job.idempotencyKey,
    processorVersion: job.processorVersion,
    maxAttempts: job.maxAttempts,
    metadata: job.metadata
  };
}
