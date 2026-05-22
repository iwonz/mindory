import { loadMindoryConfig, type MindoryConfig } from "@mindory/config";
import {
  ProcessingJobRunner,
  type ProcessingJobQueuePayload,
  type ProcessingJobProcessorRegistry,
  type ProcessingJobStore,
  stageNameForJobType
} from "@mindory/core/queue";
import type { MindoryTracer, PrometheusMetricsRegistry } from "@mindory/observability";
import { BullMqProcessingJobWorker, DEFAULT_PROCESSING_QUEUE_NAME } from "@mindory/queue-bullmq";

export interface BuildWorkerBaseRunnerOptions {
  config?: MindoryConfig;
  store: ProcessingJobStore;
  processors: ProcessingJobProcessorRegistry;
  queueName?: string;
  metrics?: PrometheusMetricsRegistry;
  tracing?: MindoryTracer;
}

export interface WorkerBaseRunner {
  runner: ProcessingJobRunner;
  worker: BullMqProcessingJobWorker;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function buildWorkerBaseRunner(options: BuildWorkerBaseRunnerOptions): WorkerBaseRunner {
  const config = options.config ?? loadMindoryConfig();
  const runner = new ProcessingJobRunner({
    store: options.store,
    processors: options.processors
  });
  const worker = new BullMqProcessingJobWorker({
    redisUrl: config.redis.url,
    queuePrefix: config.redis.queuePrefix,
    queueName: options.queueName ?? DEFAULT_PROCESSING_QUEUE_NAME,
    concurrency: config.workers.concurrency
  });

  return {
    runner,
    worker,
    start: () => worker.start((payload) => runWithMetrics(payload, runner, options.metrics, options.tracing)),
    close: () => worker.close()
  };
}

async function runWithMetrics(
  payload: ProcessingJobQueuePayload,
  runner: ProcessingJobRunner,
  metrics: PrometheusMetricsRegistry | undefined,
  tracing: MindoryTracer | undefined
): Promise<void> {
  const startedAt = performance.now();
  const run = () => runner.run(payload);
  try {
    await runWorkerJobWithTracing(payload, tracing, run);
    recordJobMetrics(metrics, tracing, payload, "succeeded", performance.now() - startedAt);
  } catch (error) {
    recordJobMetrics(metrics, tracing, payload, "failed", performance.now() - startedAt);
    throw error;
  }
}

async function runWorkerJobWithTracing(
  payload: ProcessingJobQueuePayload,
  tracing: MindoryTracer | undefined,
  run: () => Promise<void>
): Promise<void> {
  if (tracing === undefined || !tracing.enabled) {
    await run();
    return;
  }
  const parentTraceparent = tracing.extractTraceparent(payload.metadata);
  await tracing.startActiveSpan("worker.job", {
    kind: "consumer",
    refs: jobTraceRefs(payload),
    attributes: {
      "mindory.job_type": payload.type,
      "mindory.target_type": payload.targetType,
      "messaging.system": "bullmq",
      "messaging.operation": "process"
    },
    ...(parentTraceparent === undefined ? {} : { parentTraceparent })
  }, async () => {
    await run();
  });
}

function recordJobMetrics(
  metrics: PrometheusMetricsRegistry | undefined,
  tracing: MindoryTracer | undefined,
  payload: ProcessingJobQueuePayload,
  status: "succeeded" | "failed",
  durationMs: number
): void {
  if (metrics !== undefined) {
    metrics.recordJob({
      jobType: payload.type,
      status,
      durationMs
    });
    metrics.recordJobStage({
      jobType: payload.type,
      stage: stageNameForJobType(payload.type),
      status: status === "succeeded" ? "success" : "failed",
      durationMs,
      refs: {
        projectId: payload.projectId,
        jobId: payload.jobId
      }
    });
  }
  tracing?.recordOperation({
    name: `worker.stage.${stageNameForJobType(payload.type)}`,
    kind: "internal",
    operation: stageNameForJobType(payload.type),
    provider: "worker",
    status: status === "succeeded" ? "success" : "failed",
    durationMs,
    refs: jobTraceRefs(payload),
    attributes: {
      "mindory.job_type": payload.type,
      "mindory.target_type": payload.targetType
    }
  });
}

function jobTraceRefs(payload: ProcessingJobQueuePayload): { projectId: string; documentId?: string; jobId: string } {
  return {
    projectId: payload.projectId,
    jobId: payload.jobId,
    ...(payload.targetType === "document" ? { documentId: payload.targetId } : {})
  };
}
