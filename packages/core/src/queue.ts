export type ProcessingJobType =
  | "document.scan"
  | "document.route"
  | "document.extract"
  | "document.chunk"
  | "document.embed"
  | "document.index"
  | "document.recompute"
  | "memory.derive"
  | "session.summarize";

export type ProcessingJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "dead";

export type ProcessingJobStageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "skipped"
  | "disabled"
  | "blocked_by_scan"
  | "partial_failed"
  | "failed"
  | "retrying";

export interface ProcessingJobProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface ProcessingJobErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
  attempts: number;
  maxAttempts: number;
}

export interface ProcessingJobStageDetail {
  stage: string;
  status: ProcessingJobStageStatus;
  reason?: string;
  required?: boolean;
  jobId?: string;
  queueJobId?: string;
  progress?: ProcessingJobProgress;
  error?: ProcessingJobErrorDetail;
  metadata?: Record<string, unknown>;
}

export interface ProcessingJobResult {
  statusDetail?: ProcessingJobStageStatus;
  stageGraph?: ProcessingJobStageDetail[];
  progress?: ProcessingJobProgress;
  metadata?: Record<string, unknown>;
}

export interface ProcessingJobDetails {
  status: ProcessingJobStageStatus;
  stage: string;
  progress: ProcessingJobProgress;
  stages: ProcessingJobStageDetail[];
  error: ProcessingJobErrorDetail | null;
}

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
  markJobRunning(jobId: string, metadata?: Record<string, unknown>): Promise<ProcessingJobRecord>;
  markJobSucceeded(jobId: string, metadata?: Record<string, unknown>): Promise<ProcessingJobRecord>;
  markJobFailed(jobId: string, error: Error, metadata?: Record<string, unknown>): Promise<ProcessingJobRecord>;
}

export interface ProcessingJobProcessorContext {
  job: ProcessingJobRecord;
  payload: ProcessingJobQueuePayload;
}

export interface ProcessingJobProcessor {
  readonly type: ProcessingJobType;
  readonly processorVersion: string;
  process(context: ProcessingJobProcessorContext): Promise<ProcessingJobResult | void>;
}

export interface ProcessingJobProcessorRegistry {
  getProcessor(type: ProcessingJobType): ProcessingJobProcessor | undefined;
}

export interface ProcessingJobDispatcherOptions {
  store: ProcessingJobStore;
  queue: ProcessingJobQueue;
  metadataFactory?: () => Record<string, unknown>;
}

export class ProcessingJobDispatcher {
  readonly store: ProcessingJobStore;
  readonly queue: ProcessingJobQueue;
  private readonly metadataFactory: (() => Record<string, unknown>) | undefined;

  constructor(options: ProcessingJobDispatcherOptions) {
    this.store = options.store;
    this.queue = options.queue;
    this.metadataFactory = options.metadataFactory;
  }

  async createAndEnqueue(input: CreateProcessingJobInput): Promise<EnqueuedProcessingJob> {
    const job = await this.store.createPendingJob(this.withRuntimeMetadata(input));
    return this.queue.enqueueProcessingJob(toQueuePayload(job));
  }

  async retry(projectId: string, jobId: string): Promise<EnqueuedProcessingJob> {
    const job = await this.store.resetJobForRetry(projectId, jobId);
    return this.queue.enqueueProcessingJob(toQueuePayload(job));
  }

  private withRuntimeMetadata(input: CreateProcessingJobInput): CreateProcessingJobInput {
    const runtimeMetadata = this.metadataFactory?.() ?? {};
    const inputMetadata = input.metadata ?? {};
    const metadata = {
      ...runtimeMetadata,
      ...inputMetadata
    };
    if (Object.keys(metadata).length === 0) {
      return input;
    }
    return {
      ...input,
      metadata
    };
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

    const runningJob = await this.store.markJobRunning(payload.jobId, buildProcessingJobResultMetadata(payload, {
      statusDetail: "running",
      stageGraph: [{
        stage: stageNameForJobType(payload.type),
        status: "running",
        metadata: {
          processor_version: payload.processorVersion
        }
      }],
      progress: {
        completed: 0,
        total: 1,
        percent: 0
      }
    }));

    try {
      const result = await processor.process({
        job: runningJob,
        payload
      });
      await this.store.markJobSucceeded(payload.jobId, buildProcessingJobResultMetadata(payload, normalizeProcessingJobResult(result)));
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      await this.store.markJobFailed(payload.jobId, normalizedError, buildProcessingJobFailureMetadata(payload, runningJob, normalizedError));
      throw normalizedError;
    }
  }
}

export type QueueErrorCode =
  | "processor_not_found"
  | "queue_adapter_missing"
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

export function buildProcessingJobDetails(job: ProcessingJobRecord): ProcessingJobDetails {
  const stage = stageNameForJobType(job.type);
  const stages = readStageGraph(job.metadata.stage_graph) ?? [{
    stage,
    status: statusDetailForJobStatus(job.status),
    ...(job.lastError ? { error: errorDetailFromJob(job, job.lastError) } : {})
  }];
  const progress = readProgress(job.metadata.progress) ?? progressFromStageGraph(stages);
  const error = readErrorDetail(job.metadata.job_error) ?? (job.lastError ? errorDetailFromJob(job, job.lastError) : null);
  return {
    status: readStageStatus(job.metadata.job_status_detail) ?? statusDetailForJobStatus(job.status),
    stage,
    progress,
    stages,
    error
  };
}

export function buildProcessingJobResultMetadata(payload: ProcessingJobQueuePayload, result: ProcessingJobResult): Record<string, unknown> {
  const statusDetail = result.statusDetail ?? "succeeded";
  const stageGraph = result.stageGraph ?? [{
    stage: stageNameForJobType(payload.type),
    status: statusDetail
  }];
  return {
    ...(result.metadata ?? {}),
    job_status_detail: statusDetail,
    stage_graph: stageGraph,
    progress: result.progress ?? progressFromStageGraph(stageGraph),
    job_error: null
  };
}

function buildProcessingJobFailureMetadata(payload: ProcessingJobQueuePayload, job: ProcessingJobRecord, error: Error): Record<string, unknown> {
  const errorDetail = errorDetailFromJob(job, error.message, error);
  const statusDetail: ProcessingJobStageStatus = errorDetail.code === "blocked_by_scan" ? "blocked_by_scan" : "failed";
  return {
    job_status_detail: statusDetail,
    stage_graph: [{
      stage: stageNameForJobType(payload.type),
      status: statusDetail,
      error: errorDetail
    }],
    progress: {
      completed: 0,
      total: 1,
      percent: 0
    },
    job_error: errorDetail
  };
}

function normalizeProcessingJobResult(result: ProcessingJobResult | void): ProcessingJobResult {
  return result ?? {
    statusDetail: "succeeded"
  };
}

function statusDetailForJobStatus(status: ProcessingJobStatus): ProcessingJobStageStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
    case "dead":
      return "failed";
  }
}

export function stageNameForJobType(type: ProcessingJobType): string {
  switch (type) {
    case "document.scan":
      return "scan";
    case "document.route":
      return "route";
    case "document.extract":
      return "extract";
    case "document.chunk":
      return "chunk";
    case "document.embed":
      return "embed";
    case "document.index":
      return "index";
    case "document.recompute":
      return "recompute";
    case "memory.derive":
      return "memory_derive";
    case "session.summarize":
      return "session_summarize";
  }
}

function progressFromStageGraph(stages: ProcessingJobStageDetail[]): ProcessingJobProgress {
  const total = Math.max(stages.length, 1);
  const completed = stages.filter((stage) => ["succeeded", "skipped", "disabled", "partial_failed"].includes(stage.status)).length;
  return {
    completed,
    total,
    percent: Math.round((completed / total) * 100)
  };
}

function errorDetailFromJob(job: ProcessingJobRecord, message: string, error?: Error): ProcessingJobErrorDetail {
  const code = readErrorCode(error) ?? "processing_job_failed";
  return {
    code,
    message,
    retryable: job.attempts < job.maxAttempts,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts
  };
}

function readErrorCode(error: Error | undefined): string | null {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

function readStageGraph(value: unknown): ProcessingJobStageDetail[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const stages = value.filter((item): item is ProcessingJobStageDetail => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const record = item as Record<string, unknown>;
    return typeof record.stage === "string" && readStageStatus(record.status) !== null;
  });
  return stages.length > 0 ? stages : null;
}

function readProgress(value: unknown): ProcessingJobProgress | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.completed === "number" && typeof record.total === "number" && typeof record.percent === "number"
    ? {
      completed: record.completed,
      total: record.total,
      percent: record.percent
    }
    : null;
}

function readErrorDetail(value: unknown): ProcessingJobErrorDetail | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.code === "string"
    && typeof record.message === "string"
    && typeof record.retryable === "boolean"
    && typeof record.attempts === "number"
    && typeof record.maxAttempts === "number"
    ? {
      code: record.code,
      message: record.message,
      retryable: record.retryable,
      attempts: record.attempts,
      maxAttempts: record.maxAttempts
    }
    : null;
}

function readStageStatus(value: unknown): ProcessingJobStageStatus | null {
  return typeof value === "string" && [
    "pending",
    "running",
    "succeeded",
    "skipped",
    "disabled",
    "blocked_by_scan",
    "partial_failed",
    "failed",
    "retrying"
  ].includes(value)
    ? value as ProcessingJobStageStatus
    : null;
}
