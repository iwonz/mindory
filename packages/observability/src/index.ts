export type ObservabilityLevel = "debug" | "info" | "warn" | "error";
export type HealthStatus = "ok" | "degraded" | "failed";
export type MetricStatus = "success" | "failed" | "skipped" | "disabled" | "partial_failed";

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
