import type { FastifyInstance } from "fastify";
import type { MindoryConfig } from "@mindory/config";

export async function registerHealthRoutes(app: FastifyInstance, config: MindoryConfig): Promise<void> {
  app.get("/health", async (request) => ({
    status: "ok",
    service: "mindory-api",
    request_id: request.id
  }));

  app.get("/ready", async (request) => ({
    status: "ready",
    service: "mindory-api",
    request_id: request.id,
    checks: {
      config: "ok",
      database: "not_checked",
      redis: "not_checked"
    },
    dependencies: {
      database_url_configured: Boolean(config.database.url),
      redis_url_configured: Boolean(config.redis.url)
    }
  }));
}
