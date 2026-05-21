import { loadMindoryConfig, type MindoryConfig } from "@mindory/config";
import {
  ProcessingJobRunner,
  type ProcessingJobProcessorRegistry,
  type ProcessingJobStore
} from "@mindory/core/queue";
import { BullMqProcessingJobWorker, DEFAULT_PROCESSING_QUEUE_NAME } from "@mindory/queue-bullmq";

export interface BuildWorkerBaseRunnerOptions {
  config?: MindoryConfig;
  store: ProcessingJobStore;
  processors: ProcessingJobProcessorRegistry;
  queueName?: string;
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
    start: () => worker.start((payload) => runner.run(payload)),
    close: () => worker.close()
  };
}
