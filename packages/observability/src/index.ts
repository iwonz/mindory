import { createServer, type Server } from "node:http";

export type ObservabilityLevel = "debug" | "info" | "warn" | "error";
export type HealthStatus = "ok" | "degraded" | "failed";
export type MetricStatus = "success" | "failed" | "skipped" | "disabled" | "partial_failed";
export type PrometheusMetricStatus = MetricStatus | "success" | "failed";

export interface ObservabilityRefs {
  requestId?: string;
  projectId?: string;
  documentId?: string;
  jobId?: string;
  sessionId?: string;
  memoryId?: string;
  processingRunId?: string;
}

export interface StructuredLogEvent {
  timestamp: string;
  level: ObservabilityLevel;
  service: string;
  event: string;
  message: string;
  refs: ObservabilityRefs;
  fields: Record<string, unknown>;
}

export interface StructuredLogInput {
  level?: ObservabilityLevel;
  service: string;
  event: string;
  message: string;
  refs?: ObservabilityRefs;
  fields?: Record<string, unknown>;
  now?: Date;
}

export interface ModelOperationUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  embeddingDimensions?: number;
  imageCount?: number;
  audioSeconds?: number;
  durationMs?: number;
}

export interface ModelOperationAuditRecord {
  role: string;
  provider: string;
  model: string;
  status: "success" | "disabled" | "failed";
  durationMs: number;
  usage: ModelOperationUsage;
  refs: ObservabilityRefs;
  errorCode?: string;
  errorMessage?: string;
  timestamp?: string;
}

export interface ModelOperationAuditQuery {
  role?: string;
  provider?: string;
  status?: ModelOperationAuditRecord["status"];
  projectId?: string;
  documentId?: string;
  jobId?: string;
  sessionId?: string;
  limit?: number;
}

export interface ModelOperationAuditSummary {
  total: number;
  byStatus: Record<string, number>;
  totalDurationMs: number;
  totalTokens: number;
}

export interface JobStageMetricInput {
  jobType: string;
  stage: string;
  status: MetricStatus;
  durationMs: number;
  refs?: ObservabilityRefs;
  now?: Date;
}

export interface JobStageMetricRecord extends JobStageMetricInput {
  timestamp: string;
}

export interface JobStageMetricBucket {
  key: string;
  jobType: string;
  stage: string;
  status: MetricStatus;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  averageDurationMs: number;
}

export interface HealthCheckInput {
  service: string;
  startedAt: number;
  checks?: Record<string, HealthStatus | "not_checked">;
  requestId?: string;
  now?: Date;
  fields?: Record<string, unknown>;
}

export interface HealthSnapshot {
  status: HealthStatus;
  service: string;
  request_id?: string;
  timestamp: string;
  uptime_ms: number;
  checks: Record<string, HealthStatus | "not_checked">;
  observability: {
    structured_logs: "enabled";
    audit_helpers: "enabled";
    metrics: "in_process";
  };
  fields: Record<string, unknown>;
}

export interface MetricsConfig {
  enabled: boolean;
  path: string;
  bearerToken: string;
  workerHost: string;
  workerPort: number;
}

export interface ApiRequestMetricInput {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface JobMetricInput {
  jobType: string;
  status: "succeeded" | "failed";
  durationMs: number;
}

export interface QueueDepthMetricInput {
  queueName: string;
  counts: Record<string, number>;
}

export interface OperationMetricInput {
  provider: string;
  operation: string;
  status: PrometheusMetricStatus;
  durationMs: number;
}

export interface PrometheusMetricsHttpServerOptions {
  enabled: boolean;
  host: string;
  port: number;
  path: string;
  bearerToken?: string;
  registry: PrometheusMetricsRegistry;
  collect?: () => Promise<void>;
}

export interface PrometheusMetricsHttpServer {
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface RateLimitStrategy {
  scope: "in-process";
  keying: Array<"authorization_sha256" | "client_ip">;
  exemptPaths: string[];
  headers: string[];
  distributed: false;
}

export const BASIC_RATE_LIMIT_STRATEGY: RateLimitStrategy = {
  scope: "in-process",
  keying: ["authorization_sha256", "client_ip"],
  exemptPaths: ["/health", "/ready"],
  headers: ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"],
  distributed: false
};

export class InMemoryModelOperationAuditStore {
  private readonly records: ModelOperationAuditRecord[] = [];

  record(input: ModelOperationAuditRecord): ModelOperationAuditRecord {
    const record = withAuditTimestamp(input);
    this.records.push(record);
    return record;
  }

  query(query: ModelOperationAuditQuery = {}): ModelOperationAuditRecord[] {
    const filtered = queryModelOperationAudits(this.records, query);
    return filtered.map((record) => cloneAuditRecord(record));
  }

  summary(query: ModelOperationAuditQuery = {}): ModelOperationAuditSummary {
    return summarizeModelOperationAudits(this.query(query));
  }

  clear(): void {
    this.records.length = 0;
  }
}

export class JobStageMetrics {
  private readonly records: JobStageMetricRecord[] = [];

  record(input: JobStageMetricInput): JobStageMetricRecord {
    const record: JobStageMetricRecord = {
      ...input,
      timestamp: (input.now ?? new Date()).toISOString()
    };
    this.records.push(record);
    return { ...record };
  }

  snapshot(): JobStageMetricBucket[] {
    return summarizeJobStageMetrics(this.records);
  }

  clear(): void {
    this.records.length = 0;
  }
}

type PrometheusLabels = Record<string, string | number | boolean>;
type PrometheusMetricKind = "counter" | "gauge" | "summary";

interface PrometheusMetricSample {
  name: string;
  help: string;
  type: PrometheusMetricKind;
  labels: Record<string, string>;
  value: number;
}

export class PrometheusMetricsRegistry {
  private readonly counters = new Map<string, PrometheusMetricSample>();
  private readonly gauges = new Map<string, PrometheusMetricSample>();
  private readonly summaries = new Map<string, { name: string; help: string; labels: Record<string, string>; count: number; sum: number }>();

  incrementCounter(name: string, help: string, labels: PrometheusLabels = {}, value = 1): void {
    const sample = this.getCounter(name, help, labels);
    sample.value += value;
  }

  setGauge(name: string, help: string, labels: PrometheusLabels, value: number): void {
    const normalized = normalizeLabels(labels);
    this.gauges.set(metricKey(name, normalized), {
      name: normalizeMetricName(name),
      help,
      type: "gauge",
      labels: normalized,
      value
    });
  }

  observeSummary(name: string, help: string, labels: PrometheusLabels, value: number): void {
    const normalized = normalizeLabels(labels);
    const key = metricKey(name, normalized);
    const existing = this.summaries.get(key);
    if (existing === undefined) {
      this.summaries.set(key, {
        name: normalizeMetricName(name),
        help,
        labels: normalized,
        count: 1,
        sum: value
      });
      return;
    }
    existing.count += 1;
    existing.sum += value;
  }

  recordApiRequest(input: ApiRequestMetricInput): void {
    const labels = {
      method: input.method.toUpperCase(),
      route: sanitizeRouteLabel(input.route),
      status: String(input.statusCode)
    };
    this.incrementCounter("mindory_api_requests_total", "Total API HTTP requests.", labels);
    this.observeSummary("mindory_api_request_duration_seconds", "API HTTP request duration in seconds.", labels, millisecondsToSeconds(input.durationMs));
  }

  recordJob(input: JobMetricInput): void {
    const labels = {
      job_type: sanitizeLabelValue(input.jobType),
      status: input.status
    };
    this.incrementCounter("mindory_processing_jobs_total", "Total processing jobs handled by workers.", labels);
    this.observeSummary("mindory_processing_job_duration_seconds", "Processing job duration in seconds.", labels, millisecondsToSeconds(input.durationMs));
  }

  recordJobStage(input: JobStageMetricInput): void {
    const labels = {
      job_type: sanitizeLabelValue(input.jobType),
      stage: sanitizeLabelValue(input.stage),
      status: input.status
    };
    this.incrementCounter("mindory_processing_job_stages_total", "Total processing job stages.", labels);
    this.observeSummary("mindory_processing_job_stage_duration_seconds", "Processing job stage duration in seconds.", labels, millisecondsToSeconds(input.durationMs));
  }

  recordQueueDepth(input: QueueDepthMetricInput): void {
    for (const [status, count] of Object.entries(input.counts)) {
      this.setGauge("mindory_processing_queue_depth", "Processing queue depth by queue and status.", {
        queue: sanitizeLabelValue(input.queueName),
        status: sanitizeLabelValue(status)
      }, count);
    }
  }

  recordModelOperation(input: ModelOperationAuditRecord): void {
    const labels = {
      role: sanitizeLabelValue(input.role),
      provider: sanitizeLabelValue(input.provider),
      model: sanitizeLabelValue(input.model || "unset"),
      status: input.status
    };
    this.incrementCounter("mindory_model_operations_total", "Total model operations.", labels);
    this.observeSummary("mindory_model_operation_duration_seconds", "Model operation duration in seconds.", labels, millisecondsToSeconds(input.durationMs));
    const totalTokens = input.usage.totalTokens ?? 0;
    if (totalTokens > 0) {
      this.incrementCounter("mindory_model_operation_tokens_total", "Total model operation token usage.", {
        role: labels.role,
        provider: labels.provider,
        model: labels.model
      }, totalTokens);
    }
  }

  recordStorageOperation(input: OperationMetricInput): void {
    const labels = operationLabels(input);
    this.incrementCounter("mindory_storage_operations_total", "Total object storage operations.", labels);
    this.observeSummary("mindory_storage_operation_duration_seconds", "Object storage operation duration in seconds.", labels, millisecondsToSeconds(input.durationMs));
  }

  recordVectorOperation(input: OperationMetricInput): void {
    const labels = operationLabels(input);
    this.incrementCounter("mindory_vector_operations_total", "Total vector backend operations.", labels);
    this.observeSummary("mindory_vector_operation_duration_seconds", "Vector backend operation duration in seconds.", labels, millisecondsToSeconds(input.durationMs));
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    const families = new Map<string, { help: string; type: PrometheusMetricKind; samples: PrometheusMetricSample[] }>();
    for (const sample of [...this.counters.values(), ...this.gauges.values()]) {
      const family = families.get(sample.name) ?? { help: sample.help, type: sample.type, samples: [] };
      family.samples.push(sample);
      families.set(sample.name, family);
    }
    for (const [name, family] of [...families.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`# HELP ${name} ${escapeHelp(family.help)}`);
      lines.push(`# TYPE ${name} ${family.type}`);
      for (const sample of family.samples.sort((left, right) => labelString(left.labels).localeCompare(labelString(right.labels)))) {
        lines.push(`${name}${formatLabels(sample.labels)} ${formatNumber(sample.value)}`);
      }
    }
    const summaryNames = new Set(Array.from(this.summaries.values()).map((sample) => sample.name));
    for (const name of Array.from(summaryNames).sort()) {
      const samples = Array.from(this.summaries.values()).filter((sample) => sample.name === name);
      const help = samples[0]?.help ?? name;
      lines.push(`# HELP ${name} ${escapeHelp(help)}`);
      lines.push(`# TYPE ${name} summary`);
      for (const sample of samples.sort((left, right) => labelString(left.labels).localeCompare(labelString(right.labels)))) {
        lines.push(`${name}_count${formatLabels(sample.labels)} ${formatNumber(sample.count)}`);
        lines.push(`${name}_sum${formatLabels(sample.labels)} ${formatNumber(sample.sum)}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.summaries.clear();
  }

  private getCounter(name: string, help: string, labels: PrometheusLabels): PrometheusMetricSample {
    const normalized = normalizeLabels(labels);
    const key = metricKey(name, normalized);
    const existing = this.counters.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const sample: PrometheusMetricSample = {
      name: normalizeMetricName(name),
      help,
      type: "counter",
      labels: normalized,
      value: 0
    };
    this.counters.set(key, sample);
    return sample;
  }
}

export function createStructuredLogEvent(input: StructuredLogInput): StructuredLogEvent {
  return {
    timestamp: (input.now ?? new Date()).toISOString(),
    level: input.level ?? "info",
    service: input.service,
    event: input.event,
    message: input.message,
    refs: compactRefs(input.refs ?? {}),
    fields: redactSecrets(input.fields ?? {}) as Record<string, unknown>
  };
}

export function createModelOperationLogEvent(input: ModelOperationAuditRecord): StructuredLogEvent {
  const record = withAuditTimestamp(input);
  return createStructuredLogEvent({
    level: record.status === "failed" ? "warn" : "info",
    service: "mindory-model-runtime",
    event: "model_operation",
    message: `Model operation ${record.role} ${record.status}.`,
    refs: record.refs,
    fields: {
      role: record.role,
      provider: record.provider,
      model: record.model,
      status: record.status,
      duration_ms: record.durationMs,
      usage: record.usage,
      error_code: record.errorCode,
      error_message: record.errorMessage
    },
    now: new Date(record.timestamp ?? Date.now())
  });
}

export function queryModelOperationAudits(
  records: readonly ModelOperationAuditRecord[],
  query: ModelOperationAuditQuery = {}
): ModelOperationAuditRecord[] {
  const filtered = records.filter((record) => {
    return matches(query.role, record.role)
      && matches(query.provider, record.provider)
      && matches(query.status, record.status)
      && matches(query.projectId, record.refs.projectId)
      && matches(query.documentId, record.refs.documentId)
      && matches(query.jobId, record.refs.jobId)
      && matches(query.sessionId, record.refs.sessionId);
  });
  const limited = query.limit === undefined ? filtered : filtered.slice(0, Math.max(0, query.limit));
  return limited.map((record) => cloneAuditRecord(record));
}

export function summarizeModelOperationAudits(records: readonly ModelOperationAuditRecord[]): ModelOperationAuditSummary {
  const byStatus: Record<string, number> = {};
  let totalDurationMs = 0;
  let totalTokens = 0;
  for (const record of records) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    totalDurationMs += record.durationMs;
    totalTokens += record.usage.totalTokens ?? 0;
  }
  return {
    total: records.length,
    byStatus,
    totalDurationMs,
    totalTokens
  };
}

export function summarizeJobStageMetrics(records: readonly JobStageMetricRecord[]): JobStageMetricBucket[] {
  const buckets = new Map<string, JobStageMetricBucket>();
  for (const record of records) {
    const key = [record.jobType, record.stage, record.status].join(":");
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        key,
        jobType: record.jobType,
        stage: record.stage,
        status: record.status,
        count: 1,
        totalDurationMs: record.durationMs,
        maxDurationMs: record.durationMs,
        averageDurationMs: record.durationMs
      });
      continue;
    }
    existing.count += 1;
    existing.totalDurationMs += record.durationMs;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, record.durationMs);
    existing.averageDurationMs = existing.totalDurationMs / existing.count;
  }
  return Array.from(buckets.values()).sort((left, right) => left.key.localeCompare(right.key));
}

export function createHealthSnapshot(input: HealthCheckInput): HealthSnapshot {
  const now = input.now ?? new Date();
  const checks = input.checks ?? {};
  const failed = Object.values(checks).some((status) => status === "failed");
  const degraded = Object.values(checks).some((status) => status === "degraded" || status === "not_checked");
  const snapshot: HealthSnapshot = {
    status: failed ? "failed" : degraded ? "degraded" : "ok",
    service: input.service,
    timestamp: now.toISOString(),
    uptime_ms: Math.max(0, now.getTime() - input.startedAt),
    checks,
    observability: {
      structured_logs: "enabled",
      audit_helpers: "enabled",
      metrics: "in_process"
    },
    fields: redactSecrets(input.fields ?? {}) as Record<string, unknown>
  };
  if (input.requestId !== undefined) {
    snapshot.request_id = input.requestId;
  }
  return snapshot;
}

export function createPrometheusMetricsHttpServer(options: PrometheusMetricsHttpServerOptions): PrometheusMetricsHttpServer {
  let server: Server | null = null;
  return {
    start: () => new Promise<void>((resolve, reject) => {
      if (!options.enabled || server !== null) {
        resolve();
        return;
      }
      server = createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== options.path) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "not_found" }));
          return;
        }
        if (!isMetricsRequestAuthorized(request.headers.authorization, options.bearerToken ?? "")) {
          response.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
          response.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        try {
          await options.collect?.();
          response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
          response.end(options.registry.renderPrometheus());
        } catch (error) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "metrics_collection_failed", message: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.once("error", reject);
      server.listen(options.port, options.host, () => {
        server?.off("error", reject);
        resolve();
      });
    }),
    close: () => new Promise<void>((resolve, reject) => {
      if (server === null) {
        resolve();
        return;
      }
      const closing = server;
      server = null;
      closing.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    })
  };
}

export function isMetricsRequestAuthorized(authorizationHeader: string | undefined, bearerToken: string): boolean {
  if (bearerToken.trim() === "") {
    return true;
  }
  return authorizationHeader === `Bearer ${bearerToken}`;
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? "<redacted>" : redactSecrets(nested);
  }
  return redacted;
}

function withAuditTimestamp(input: ModelOperationAuditRecord): ModelOperationAuditRecord {
  return {
    ...input,
    refs: compactRefs(input.refs),
    usage: { ...input.usage },
    timestamp: input.timestamp ?? new Date().toISOString()
  };
}

function compactRefs(refs: ObservabilityRefs): ObservabilityRefs {
  const compacted: ObservabilityRefs = {};
  for (const [key, value] of Object.entries(refs)) {
    if (typeof value === "string" && value.trim().length > 0) {
      (compacted as Record<string, string>)[key] = value;
    }
  }
  return compacted;
}

function cloneAuditRecord(record: ModelOperationAuditRecord): ModelOperationAuditRecord {
  return {
    ...record,
    refs: { ...record.refs },
    usage: { ...record.usage }
  };
}

function matches(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined || actual === expected;
}

function isSecretKey(key: string): boolean {
  return /(authorization|token|secret|password|api[_-]?key|bearer)/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function operationLabels(input: OperationMetricInput): PrometheusLabels {
  return {
    provider: sanitizeLabelValue(input.provider),
    operation: sanitizeLabelValue(input.operation),
    status: sanitizeLabelValue(input.status)
  };
}

function normalizeLabels(labels: PrometheusLabels): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    normalized[normalizeLabelName(key)] = sanitizeLabelValue(String(value));
  }
  return normalized;
}

function normalizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, "_");
}

function normalizeLabelName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function sanitizeRouteLabel(route: string): string {
  const normalized = route.split("?")[0] ?? "/";
  return normalized.replace(/[0-9a-f]{8,}/gi, ":id").replace(/\/+/g, "/");
}

function sanitizeLabelValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "unset";
  }
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function metricKey(name: string, labels: Record<string, string>): string {
  return `${normalizeMetricName(name)}:${labelString(labels)}`;
}

function labelString(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, "\\\"");
}

function escapeHelp(value: string): string {
  return value.replace(/\n/g, "\\n");
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function millisecondsToSeconds(durationMs: number): number {
  return Math.max(0, durationMs) / 1000;
}
