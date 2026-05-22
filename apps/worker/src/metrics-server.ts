import type { MindoryConfig } from "@mindory/config";
import {
  createPrometheusMetricsHttpServer,
  type PrometheusMetricsHttpServer,
  type PrometheusMetricsRegistry,
  type QueueDepthMetricInput
} from "@mindory/observability";

export interface WorkerQueueMetricsSource {
  readonly queueName: string;
  getJobCounts(): Promise<Record<string, number>>;
}

export function createWorkerMetricsServer(
  config: MindoryConfig,
  registry: PrometheusMetricsRegistry,
  queue: WorkerQueueMetricsSource
): PrometheusMetricsHttpServer {
  return createPrometheusMetricsHttpServer({
    enabled: config.metrics.enabled,
    host: config.metrics.workerHost,
    port: config.metrics.workerPort,
    path: config.metrics.path,
    bearerToken: config.metrics.bearerToken,
    registry,
    collect: async () => {
      const input: QueueDepthMetricInput = {
        queueName: queue.queueName,
        counts: await queue.getJobCounts()
      };
      registry.recordQueueDepth(input);
    }
  });
}
