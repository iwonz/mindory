import type { FastifyInstance } from "fastify";
import type { MindoryConfig } from "@mindory/config";
import {
  isMetricsRequestAuthorized,
  PrometheusMetricsRegistry,
  type QueueDepthMetricInput
} from "@mindory/observability";

export interface QueueMetricsSource {
  readonly queueName: string;
  getJobCounts(): Promise<Record<string, number>>;
}

export interface ApiMetricsDependencies {
  registry: PrometheusMetricsRegistry;
  queues?: QueueMetricsSource[];
}

export function createApiMetricsDependencies(): ApiMetricsDependencies {
  return {
    registry: new PrometheusMetricsRegistry(),
    queues: []
  };
}

export async function registerMetricsRoutes(
  app: FastifyInstance,
  config: MindoryConfig,
  dependencies: ApiMetricsDependencies
): Promise<void> {
  app.addHook("onRequest", async (request) => {
    request.mindoryMetricsStartedAt = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = request.mindoryMetricsStartedAt;
    const durationMs = startedAt === undefined
      ? 0
      : Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    dependencies.registry.recordApiRequest({
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      statusCode: reply.statusCode,
      durationMs
    });
  });

  app.get(config.metrics.path, async (request, reply) => {
    if (!config.metrics.enabled) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (!isMetricsRequestAuthorized(request.headers.authorization, config.metrics.bearerToken)) {
      return reply
        .code(401)
        .header("www-authenticate", "Bearer")
        .send({ error: "unauthorized" });
    }
    await collectQueueDepth(dependencies);
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(dependencies.registry.renderPrometheus());
  });
}

async function collectQueueDepth(dependencies: ApiMetricsDependencies): Promise<void> {
  for (const queue of dependencies.queues ?? []) {
    const input: QueueDepthMetricInput = {
      queueName: queue.queueName,
      counts: await queue.getJobCounts()
    };
    dependencies.registry.recordQueueDepth(input);
  }
}

declare module "fastify" {
  interface FastifyRequest {
    mindoryMetricsStartedAt?: bigint;
  }
}
