import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assertIncludes(content, token, label) {
  assert(content.includes(token), `${label} must include ${token}.`);
}

const rootPackage = readJson("package.json");
const ci = read(".github/workflows/ci.yml");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");
const app = read("apps/api/src/app.ts");
const config = read("packages/config/src/index.ts");
const requestGuard = read("apps/api/src/request-guard.ts");
const healthRoute = read("apps/api/src/routes/health.ts");
const observability = read("packages/observability/src/index.ts");
const productionHardening = read("docs/PRODUCTION_HARDENING.md");
const productionHardeningLower = productionHardening.toLowerCase();
const deployment = read("docs/DEPLOYMENT.md");
const security = read("docs/SECURITY.md");
const configuration = read("docs/CONFIGURATION.md");

assert(rootPackage.scripts?.["production:validate"] === "node scripts/validate-production-hardening.js", "Root package must expose production:validate.");

for (const token of ["pull_request:", "push:", "node-version: 24", "pnpm install --frozen-lockfile", "docker compose version", "pnpm check"]) {
  assertIncludes(ci, token, ".github/workflows/ci.yml");
}

for (const token of ["MINDORY_API_RATE_LIMIT_ENABLED", "MINDORY_API_RATE_LIMIT_WINDOW_MS", "MINDORY_API_RATE_LIMIT_MAX", "MINDORY_METRICS_ENABLED", "MINDORY_METRICS_BEARER_TOKEN", "MINDORY_OTEL_TRACES_ENABLED", "MINDORY_OTEL_LOG_EXPORT_ENABLED"]) {
  assertIncludes(envExample, token, ".env.example");
  assertIncludes(compose, token, "docker-compose.yml");
  assertIncludes(config, token, "packages/config/src/index.ts");
  assertIncludes(configuration, token, "docs/CONFIGURATION.md");
}
for (const token of ["MINDORY_BACKUP_SCHEDULE_ENABLED", "MINDORY_BACKUP_SCHEDULE_INTERVAL_MINUTES", "MINDORY_BACKUP_RETENTION_COUNT", "MINDORY_BACKUP_RETENTION_DAYS", "MINDORY_POSTGRES_WAL_ARCHIVE_ENABLED", "MINDORY_POSTGRES_WAL_ARCHIVE_TIMEOUT_SECONDS"]) {
  assertIncludes(envExample, token, ".env.example");
  assertIncludes(compose, token, "docker-compose.yml");
  assertIncludes(config, token, "packages/config/src/index.ts");
  assertIncludes(configuration, token, "docs/CONFIGURATION.md");
  assertIncludes(productionHardening, token, "docs/PRODUCTION_HARDENING.md");
}
for (const token of ["MINDORY_REMOTE_BACKUP_ENABLED", "MINDORY_BACKUP_ENCRYPTION_KEY_ID", "MINDORY_BACKUP_ENCRYPTION_KEY", "MINDORY_REMOTE_BACKUP_S3_ENDPOINT", "MINDORY_REMOTE_BACKUP_S3_BUCKET", "MINDORY_REMOTE_BACKUP_S3_ACCESS_KEY_ID", "MINDORY_REMOTE_BACKUP_S3_SECRET_ACCESS_KEY", "MINDORY_REMOTE_BACKUP_S3_PREFIX"]) {
  assertIncludes(envExample, token, ".env.example");
  assertIncludes(compose, token, "docker-compose.yml");
  assertIncludes(config, token, "packages/config/src/index.ts");
  assertIncludes(configuration, token, "docs/CONFIGURATION.md");
  assertIncludes(productionHardening, token, "docs/PRODUCTION_HARDENING.md");
}

for (const token of ["registerRequestGuards", "rateLimit", "ApiError(429", "x-ratelimit-limit", "createHash"]) {
  assertIncludes(requestGuard, token, "apps/api/src/request-guard.ts");
}
assertIncludes(app, "registerRequestGuards(app, config)", "apps/api/src/app.ts");

for (const token of ["createHealthSnapshot", "uptime_ms", "BASIC_RATE_LIMIT_STRATEGY"]) {
  assertIncludes(healthRoute, token, "apps/api/src/routes/health.ts");
}
for (const token of ["createStructuredLogEvent", "InMemoryModelOperationAuditStore", "JobStageMetrics", "PrometheusMetricsRegistry", "createMindoryTracer", "createOtlpStructuredLogExporter", "recordApiRequest", "recordQueueDepth", "redactSecrets", "structured_logs", "audit_helpers"]) {
  assertIncludes(observability, token, "packages/observability/src/index.ts");
}

for (const token of [
  "docker build",
  "pnpm check",
  "backup",
  "backup-archive",
  "backup-upload",
  "backup-download",
  "backup-restore-archive",
  "pitr-backup",
  "pitr-restore",
  "recovery_target_time",
  "rollback",
  "secret manager",
  "rate limit",
  "distributed rate limiting",
  "deferred",
  "structured logs",
  "model operation audit",
  "job stage metrics",
  "prometheus metrics",
  "opentelemetry",
  "otlp",
  "request_id",
  "job_id",
  "docs/observability.md"
]) {
  assertIncludes(productionHardeningLower, token, "docs/PRODUCTION_HARDENING.md");
}

assertIncludes(deployment, "docs/PRODUCTION_HARDENING.md", "docs/DEPLOYMENT.md");
assertIncludes(security, "Rate Limits", "docs/SECURITY.md");
assertIncludes(security, "Production Secret Handling", "docs/SECURITY.md");
assertIncludes(configuration, "API Request Guards", "docs/CONFIGURATION.md");

console.log("Production hardening baseline validated.");
