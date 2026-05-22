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
const apiPackage = readJson("apps/api/package.json");
const apiTsconfig = readJson("apps/api/tsconfig.json");
const observabilityPackage = readJson("packages/observability/package.json");
const source = read("packages/observability/src/index.ts");
const healthRoute = read("apps/api/src/routes/health.ts");
const docs = read("docs/OBSERVABILITY.md");
const production = read("docs/PRODUCTION_HARDENING.md");

assert(rootPackage.scripts?.["observability:validate"]?.includes("scripts/validate-observability.js"), "Root package must expose observability:validate.");
assert(observabilityPackage.name === "@mindory/observability", "Observability package must be named @mindory/observability.");
assert(apiPackage.dependencies?.["@mindory/observability"] === "workspace:*", "API must depend on @mindory/observability for health snapshots.");
assert(apiTsconfig.references?.some((reference) => reference.path === "../../packages/observability"), "API tsconfig must reference @mindory/observability.");

for (const symbol of [
  "createStructuredLogEvent",
  "createModelOperationLogEvent",
  "InMemoryModelOperationAuditStore",
  "queryModelOperationAudits",
  "summarizeModelOperationAudits",
  "JobStageMetrics",
  "summarizeJobStageMetrics",
  "createHealthSnapshot",
  "BASIC_RATE_LIMIT_STRATEGY",
  "redactSecrets"
]) {
  assertIncludes(source, symbol, "packages/observability/src/index.ts");
}
for (const token of ["structured_logs", "audit_helpers", "metrics"]) {
  assertIncludes(source, token, "packages/observability/src/index.ts");
}

for (const token of ["request_id", "timestamp", "uptime_ms", "rate_limit", "BASIC_RATE_LIMIT_STRATEGY", "createHealthSnapshot"]) {
  assertIncludes(healthRoute, token, "apps/api/src/routes/health.ts");
}

for (const token of [
  "Structured Logs",
  "Model Operation Audit",
  "Job Stage Metrics",
  "Health Endpoints",
  "Rate Limit Strategy",
  "Prometheus",
  "OpenTelemetry",
  "future"
]) {
  assertIncludes(docs, token, "docs/OBSERVABILITY.md");
}
assertIncludes(production, "docs/OBSERVABILITY.md", "docs/PRODUCTION_HARDENING.md");

const observability = await import("../packages/observability/dist/index.js");

const logEvent = observability.createStructuredLogEvent({
  service: "validator",
  event: "request",
  message: "validated",
  refs: {
    requestId: "req_1",
    projectId: "project_1"
  },
  fields: {
    authorization: "Bearer secret",
    nested: {
      api_key: "secret"
    }
  },
  now: new Date("2026-05-22T00:00:00.000Z")
});
assert(logEvent.timestamp === "2026-05-22T00:00:00.000Z", "Structured log event must preserve timestamp.");
assert(logEvent.refs.requestId === "req_1", "Structured log event must preserve request refs.");
assert(logEvent.fields.authorization === "<redacted>", "Structured log event must redact authorization.");
assert(logEvent.fields.nested.api_key === "<redacted>", "Structured log event must redact nested secrets.");

const auditStore = new observability.InMemoryModelOperationAuditStore();
auditStore.record({
  role: "text-embedding",
  provider: "local-http",
  model: "validator",
  status: "success",
  durationMs: 42,
  usage: {
    totalTokens: 12,
    embeddingDimensions: 1536
  },
  refs: {
    projectId: "project_1",
    documentId: "doc_1",
    jobId: "job_1"
  }
});
auditStore.record({
  role: "ocr",
  provider: "disabled",
  model: "",
  status: "disabled",
  durationMs: 0,
  usage: {},
  refs: {
    projectId: "project_2"
  }
});
assert(auditStore.query({ role: "text-embedding", projectId: "project_1" }).length === 1, "Audit store must filter by role and project.");
assert(auditStore.query({ status: "disabled" }).length === 1, "Audit store must filter disabled model operations.");
assert(auditStore.summary({ projectId: "project_1" }).totalTokens === 12, "Audit summary must aggregate token usage.");

const metricStore = new observability.JobStageMetrics();
metricStore.record({ jobType: "document.process", stage: "embed", status: "success", durationMs: 10 });
metricStore.record({ jobType: "document.process", stage: "embed", status: "success", durationMs: 30 });
const metric = metricStore.snapshot().find((bucket) => bucket.key === "document.process:embed:success");
assert(metric?.count === 2, "Job stage metrics must count grouped stages.");
assert(metric.averageDurationMs === 20, "Job stage metrics must compute average duration.");

const health = observability.createHealthSnapshot({
  service: "validator",
  startedAt: new Date("2026-05-22T00:00:00.000Z").getTime(),
  requestId: "req_health",
  checks: {
    config: "ok",
    database: "not_checked"
  },
  now: new Date("2026-05-22T00:00:01.000Z")
});
assert(health.request_id === "req_health", "Health snapshot must preserve request id.");
assert(health.uptime_ms === 1000, "Health snapshot must include uptime.");
assert(health.observability.metrics === "in_process", "Health snapshot must describe metrics scope.");
assert(observability.BASIC_RATE_LIMIT_STRATEGY.distributed === false, "Rate-limit strategy must be documented as in-process.");

console.log("Observability baseline validated.");
