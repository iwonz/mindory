import fs from "node:fs";
import net from "node:net";
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
const workerPackage = readJson("apps/worker/package.json");
const workerTsconfig = readJson("apps/worker/tsconfig.json");
const observabilityPackage = readJson("packages/observability/package.json");
const source = read("packages/observability/src/index.ts");
const healthRoute = read("apps/api/src/routes/health.ts");
const apiApp = read("apps/api/src/app.ts");
const apiMetricsRoute = read("apps/api/src/routes/metrics.ts");
const apiRuntime = read("apps/api/src/runtime.ts");
const workerRuntime = read("apps/worker/src/runtime.ts");
const workerRunner = read("apps/worker/src/runner.ts");
const workerMetricsServer = read("apps/worker/src/metrics-server.ts");
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");
const docs = read("docs/OBSERVABILITY.md");
const production = read("docs/PRODUCTION_HARDENING.md");

assert(rootPackage.scripts?.["observability:validate"]?.includes("scripts/validate-observability.js"), "Root package must expose observability:validate.");
assert(observabilityPackage.name === "@mindory/observability", "Observability package must be named @mindory/observability.");
assert(apiPackage.dependencies?.["@mindory/observability"] === "workspace:*", "API must depend on @mindory/observability for health snapshots.");
assert(apiTsconfig.references?.some((reference) => reference.path === "../../packages/observability"), "API tsconfig must reference @mindory/observability.");
assert(workerPackage.dependencies?.["@mindory/observability"] === "workspace:*", "Worker must depend on @mindory/observability for production metrics.");
assert(workerTsconfig.references?.some((reference) => reference.path === "../../packages/observability"), "Worker tsconfig must reference @mindory/observability.");

for (const symbol of [
  "createStructuredLogEvent",
  "createModelOperationLogEvent",
  "InMemoryModelOperationAuditStore",
  "queryModelOperationAudits",
  "summarizeModelOperationAudits",
  "JobStageMetrics",
  "summarizeJobStageMetrics",
  "PrometheusMetricsRegistry",
  "createPrometheusMetricsHttpServer",
  "recordApiRequest",
  "recordJobStage",
  "recordQueueDepth",
  "recordModelOperation",
  "recordStorageOperation",
  "recordVectorOperation",
  "renderPrometheus",
  "isMetricsRequestAuthorized",
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
for (const token of ["registerMetricsRoutes", "onResponse", "isMetricsRequestAuthorized", "renderPrometheus", "collectQueueDepth"]) {
  assertIncludes(apiMetricsRoute, token, "apps/api/src/routes/metrics.ts");
}
for (const token of ["registerMetricsRoutes(app, config, metrics)", "createApiMetricsDependencies"]) {
  assertIncludes(apiApp, token, "apps/api/src/app.ts");
}
for (const token of ["PrometheusMetricsRegistry", "auditSink: (audit) => metrics.recordModelOperation(audit)", "instrumentObjectStorage", "instrumentVectorIndex", "queues: [queue]"]) {
  assertIncludes(apiRuntime, token, "apps/api/src/runtime.ts");
  assertIncludes(workerRuntime, token === "queues: [queue]" ? "createWorkerMetricsServer" : token, "apps/worker/src/runtime.ts");
}
for (const token of ["runWithMetrics", "recordJobMetrics", "recordJobStage"]) {
  assertIncludes(workerRunner, token, "apps/worker/src/runner.ts");
}
for (const token of ["createWorkerMetricsServer", "createPrometheusMetricsHttpServer", "recordQueueDepth"]) {
  assertIncludes(workerMetricsServer, token, "apps/worker/src/metrics-server.ts");
}
for (const token of ["MINDORY_METRICS_ENABLED", "MINDORY_METRICS_PATH", "MINDORY_METRICS_BEARER_TOKEN", "MINDORY_METRICS_WORKER_PORT"]) {
  assertIncludes(config, token, "packages/config/src/index.ts");
  assertIncludes(envExample, token, ".env.example");
  assertIncludes(compose, token, "docker-compose.yml");
}

for (const token of [
  "Structured Logs",
  "Model Operation Audit",
  "Job Stage Metrics",
  "Prometheus Metrics",
  "Prometheus scrape_config",
  "Health Endpoints",
  "Rate Limit Strategy",
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

const prometheus = new observability.PrometheusMetricsRegistry();
prometheus.recordApiRequest({ method: "GET", route: "/v1/documents/:id", statusCode: 200, durationMs: 25 });
prometheus.recordJob({ jobType: "document.extract", status: "succeeded", durationMs: 50 });
prometheus.recordJobStage({ jobType: "document.extract", stage: "extract", status: "success", durationMs: 50 });
prometheus.recordQueueDepth({ queueName: "processing", counts: { waiting: 2, failed: 1 } });
prometheus.recordModelOperation({
  role: "text-embedding",
  provider: "local-http",
  model: "validator",
  status: "success",
  durationMs: 40,
  usage: { totalTokens: 7 },
  refs: { projectId: "secret-project-id" }
});
prometheus.recordStorageOperation({ provider: "local-fs", operation: "put_object", status: "success", durationMs: 5 });
prometheus.recordVectorOperation({ provider: "pgvector", operation: "search_document_chunks", status: "failed", durationMs: 6 });
const renderedMetrics = prometheus.renderPrometheus();
for (const token of [
  "# TYPE mindory_api_requests_total counter",
  "mindory_api_request_duration_seconds_count",
  "mindory_processing_jobs_total",
  "mindory_processing_job_stage_duration_seconds_sum",
  "mindory_processing_queue_depth",
  "mindory_model_operations_total",
  "mindory_model_operation_tokens_total",
  "mindory_storage_operations_total",
  "mindory_vector_operations_total"
]) {
  assertIncludes(renderedMetrics, token, "rendered Prometheus metrics");
}
assert(!renderedMetrics.includes("secret-project-id"), "Prometheus metrics must not expose high-cardinality project refs.");

const metricsPort = await getFreePort();
const metricsServer = observability.createPrometheusMetricsHttpServer({
  enabled: true,
  host: "127.0.0.1",
  port: metricsPort,
  path: "/metrics",
  bearerToken: "metrics-secret",
  registry: prometheus,
  collect: async () => prometheus.recordQueueDepth({ queueName: "processing", counts: { waiting: 3 } })
});
await metricsServer.start();
try {
  const unauthorized = await fetch(`http://127.0.0.1:${metricsPort}/metrics`);
  assert(unauthorized.status === 401, "Prometheus metrics HTTP server must reject missing bearer token.");
  const metricsResponse = await fetch(`http://127.0.0.1:${metricsPort}/metrics`, {
    headers: { authorization: "Bearer metrics-secret" }
  });
  const body = await metricsResponse.text();
  assert(metricsResponse.ok, "Prometheus metrics HTTP server must return 200 for authorized scrape.");
  assertIncludes(body, "mindory_processing_queue_depth{queue=\"processing\",status=\"waiting\"} 3", "authorized metrics HTTP response");
} finally {
  await metricsServer.close();
}

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : null;
      server.close(() => {
        if (port === null) {
          reject(new Error("Could not allocate a free port."));
          return;
        }
        resolve(port);
      });
    });
  });
}
