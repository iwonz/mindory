import type { FastifyInstance } from "fastify";
import type { MindoryConfig } from "@mindory/config";
import { BASIC_RATE_LIMIT_STRATEGY, createHealthSnapshot } from "@mindory/observability";

export async function registerHealthRoutes(app: FastifyInstance, config: MindoryConfig): Promise<void> {
  const startedAt = Date.now();

  app.get("/health", async (request) => {
    const snapshot = createHealthSnapshot({
      service: "mindory-api",
      startedAt,
      requestId: request.id,
      checks: {
        api: "ok"
      },
      fields: {
        endpoint: "/health"
      }
    });
    return {
      ...snapshot,
      status: "ok",
      service: "mindory-api",
      request_id: request.id,
      timestamp: snapshot.timestamp,
      uptime_ms: snapshot.uptime_ms
    };
  });

  app.get("/ready", async (request) => {
    const checks = {
      config: "ok",
      database: "not_checked",
      redis: "not_checked"
    } as const;
    const snapshot = createHealthSnapshot({
      service: "mindory-api",
      startedAt,
      requestId: request.id,
      checks,
      fields: {
        endpoint: "/ready",
        rate_limit: {
          enabled: config.api.rateLimit.enabled,
          window_ms: config.api.rateLimit.windowMs,
          max_requests: config.api.rateLimit.maxRequests,
          strategy: BASIC_RATE_LIMIT_STRATEGY
        },
        logging: {
          structured: true,
          level: config.log.level,
          redacts_authorization: true
        }
      }
    });
    return {
      ...snapshot,
      status: "ready",
      service: "mindory-api",
      request_id: request.id,
      timestamp: snapshot.timestamp,
      uptime_ms: snapshot.uptime_ms,
      checks,
      dependencies: {
        database_url_configured: Boolean(config.database.url),
        redis_url_configured: Boolean(config.redis.url)
      }
    };
  });
}
