import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MindoryConfig } from "@mindory/config";
import { ApiError } from "./errors.js";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitKey {
  key: string;
  type: "ip" | "token";
}

const RATE_LIMIT_EXEMPT_PATHS = new Set(["/health", "/ready"]);

export function registerRequestGuards(app: FastifyInstance, config: MindoryConfig): void {
  if (!config.api.rateLimit.enabled) {
    return;
  }

  const buckets = new Map<string, RateLimitBucket>();
  let lastPrunedAt = 0;

  app.addHook("onRequest", async (request, reply) => {
    if (RATE_LIMIT_EXEMPT_PATHS.has(requestPath(request))) {
      return;
    }

    const now = Date.now();
    if (now - lastPrunedAt >= config.api.rateLimit.windowMs) {
      pruneExpiredBuckets(buckets, now);
      lastPrunedAt = now;
    }

    const rateLimitKey = buildRateLimitKey(request);
    const bucket = resolveBucket(buckets, rateLimitKey.key, now, config.api.rateLimit.windowMs);
    const limit = config.api.rateLimit.maxRequests;

    if (bucket.count >= limit) {
      setRateLimitHeaders(reply, limit, 0, bucket.resetAt);
      request.log.warn(
        {
          request_id: request.id,
          rate_limit_key_type: rateLimitKey.type,
          rate_limit_reset_at: new Date(bucket.resetAt).toISOString()
        },
        "Request rejected by rate limit guard."
      );
      throw new ApiError(429, "rate_limited", "Too many requests. Retry after the current rate limit window.");
    }

    bucket.count += 1;
    setRateLimitHeaders(reply, limit, limit - bucket.count, bucket.resetAt);
  });
}

function requestPath(request: FastifyRequest): string {
  const [path] = request.url.split("?", 1);
  return path ?? request.url;
}

function buildRateLimitKey(request: FastifyRequest): RateLimitKey {
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;

  if (authorization !== undefined && authorization.trim() !== "") {
    const tokenHash = createHash("sha256").update(authorization).digest("hex").slice(0, 24);
    return {
      key: `token:${tokenHash}`,
      type: "token"
    };
  }

  return {
    key: `ip:${request.ip}`,
    type: "ip"
  };
}

function resolveBucket(buckets: Map<string, RateLimitBucket>, key: string, now: number, windowMs: number): RateLimitBucket {
  const existing = buckets.get(key);
  if (existing !== undefined && now < existing.resetAt) {
    return existing;
  }

  const bucket = {
    count: 0,
    resetAt: now + windowMs
  };
  buckets.set(key, bucket);
  return bucket;
}

function setRateLimitHeaders(reply: { header: (name: string, value: string) => unknown }, limit: number, remaining: number, resetAt: number): void {
  reply.header("x-ratelimit-limit", String(limit));
  reply.header("x-ratelimit-remaining", String(Math.max(0, remaining)));
  reply.header("x-ratelimit-reset", String(Math.ceil(resetAt / 1000)));
}

function pruneExpiredBuckets(buckets: Map<string, RateLimitBucket>, now: number): void {
  for (const [key, bucket] of buckets.entries()) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}
