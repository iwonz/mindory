import { loadMindoryConfig, type MindoryConfig } from "@mindory/config";
import {
  ProcessingJobRunner,
  type ProcessingJobQueuePayload,
  type ProcessingJobProcessorRegistry,
  type ProcessingJobStore,
  stageNameForJobType
} from "@mindory/core/queue";
import type { PrometheusMetricsRegistry } from "@mindory/observability";
import { BullMqProcessingJobWorker, DEFAULT_PROCESSING_QUEUE_NAME } from "@mindory/queue-bullmq";

export interface BuildWorkerBaseRunnerOptions {
  config?: MindoryConfig;
  store: ProcessingJobStore;
  processors: ProcessingJobProcessorRegistry;
  queueName?: string;
  metrics?: PrometheusMetricsRegistry;
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
    start: () => worker.start((payload) => runWithMetrics(payload, runner, options.metrics)),
    close: () => worker.close()
  };
}

async function runWithMetrics(
  payload: ProcessingJobQueuePayload,
  runner: ProcessingJobRunner,
  metrics: PrometheusMetricsRegistry | undefined
): Promise<void> {
  const startedAt = performance.now();
  try {
    await runner.run(payload);
    recordJobMetrics(metrics, payload, "succeeded", performance.now() - startedAt);
  } catch (error) {
    recordJobMetrics(metrics, payload, "failed", performance.now() - startedAt);
    throw error;
  }
}

function recordJobMetrics(
  metrics: PrometheusMetricsRegistry | undefined,
  payload: ProcessingJobQueuePayload,
  status: "succeeded" | "failed",
  durationMs: number
): void {
  if (metrics === undefined) {
    return;
  }
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
