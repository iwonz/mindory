# Observability

Mindory's MVP observability baseline is intentionally small and self-hostable.
It provides structured logs, in-process audit/metric helpers, lightweight health
payloads, Prometheus-compatible metrics exporters, OpenTelemetry OTLP trace
export, OTLP structured log export and documented rate-limit behavior.

## Structured Logs

API runtime logs use Fastify JSON logging with request ids and authorization
header redaction. Shared helpers in `@mindory/observability` expose
`createStructuredLogEvent` for packages that need the same shape outside
Fastify.

Use these field names when available:

- `request_id`
- `project_id`
- `document_id`
- `job_id`
- `session_id`
- `memory_id`
- `processing_run_id`

Secret-like fields such as authorization headers, bearer tokens, passwords,
API keys and secret values are redacted by shared helpers before export.

Set `MINDORY_OTEL_LOG_EXPORT_ENABLED=true` to export structured log events to an
OTLP HTTP logs endpoint. Configure the collector URL with
`MINDORY_OTEL_LOG_EXPORT_ENDPOINT`, optional comma-separated headers with
`MINDORY_OTEL_LOG_EXPORT_HEADERS` and timeout with
`MINDORY_OTEL_LOG_EXPORT_TIMEOUT_MS`.

## Model Operation Audit

`@mindory/llm` emits model operation audit records through its `auditSink`.
`@mindory/observability` provides in-process helpers for formatting and querying
those records:

- `createModelOperationLogEvent`
- `InMemoryModelOperationAuditStore`
- `queryModelOperationAudits`
- `summarizeModelOperationAudits`

The supported MVP audit fields are:

- role, provider and model;
- status: `success`, `disabled` or `failed`;
- duration in milliseconds;
- usage fields such as input/output/total tokens, embedding dimensions, image
  count and audio seconds;
- project, document, job, session, message and processing-run refs;
- optional error code and message.

The in-memory store is for local diagnostics and tests. For retention, export
structured model operation logs through the OTLP log exporter.

## Job Stage Metrics

`JobStageMetrics` records in-process job stage observations and summarizes them
by job type, stage and status. The summary includes count, total duration,
maximum duration and average duration.

Use it for lightweight diagnostics around worker stages such as scan, extract,
chunk, embed, index, OCR, ASR, keyframe extraction and face matching.

## Prometheus Metrics

Set `MINDORY_METRICS_ENABLED=true` to expose scrapeable metrics.

The API serves metrics at `MINDORY_METRICS_PATH`, default `/metrics`, on the
existing API listener. The worker starts a separate metrics HTTP listener at
`MINDORY_METRICS_WORKER_HOST:MINDORY_METRICS_WORKER_PORT`, default
`0.0.0.0:3001`, using the same path. Set
`MINDORY_METRICS_BEARER_TOKEN` to require `Authorization: Bearer <token>` for
both endpoints. Metrics are disabled by default, and public deployments should
either keep the worker metrics port private to the Prometheus network or set a
strong bearer token.

Exported metric families include:

- `mindory_api_requests_total`
- `mindory_api_request_duration_seconds`
- `mindory_processing_jobs_total`
- `mindory_processing_job_duration_seconds`
- `mindory_processing_job_stages_total`
- `mindory_processing_job_stage_duration_seconds`
- `mindory_processing_queue_depth`
- `mindory_model_operations_total`
- `mindory_model_operation_duration_seconds`
- `mindory_model_operation_tokens_total`
- `mindory_storage_operations_total`
- `mindory_storage_operation_duration_seconds`
- `mindory_vector_operations_total`
- `mindory_vector_operation_duration_seconds`

Labels intentionally stay low-cardinality: method, route template, status,
job type, stage, queue status, provider, model role, model name and operation.
Project ids, document ids, session ids, bearer tokens and raw user content are
not emitted as metric labels or values.

Prometheus scrape_config example:

```yaml
scrape_configs:
  - job_name: mindory-api
    metrics_path: /metrics
    bearer_token: ${MINDORY_METRICS_BEARER_TOKEN}
    static_configs:
      - targets: ["mindory-api:3000"]

  - job_name: mindory-worker
    metrics_path: /metrics
    bearer_token: ${MINDORY_METRICS_BEARER_TOKEN}
    static_configs:
      - targets: ["mindory-worker:3001"]
```

## OTLP Tracing

Set `MINDORY_OTEL_TRACES_ENABLED=true` to export OpenTelemetry-compatible traces
over OTLP HTTP. The exporter sends spans to
`MINDORY_OTEL_EXPORTER_OTLP_ENDPOINT`, default
`http://localhost:4318/v1/traces`. `MINDORY_OTEL_SERVICE_NAME` is used as the
service name prefix; API and worker append `-api` and `-worker`.

Supported trace coverage:

- API request spans with request id, method, route and response status;
- worker job consumer spans that continue the API trace from queued job
  metadata;
- job-stage spans;
- model operation spans from `@mindory/llm` audit hooks;
- object storage client spans;
- vector backend client spans.

Trace propagation uses W3C `traceparent`. API requests accept incoming
`traceparent`; newly enqueued jobs receive `traceparent`, `trace_id`,
`parent_span_id` and `correlation_id` metadata. Worker processors use that
metadata to continue the same trace and propagate it to downstream jobs.

Safe span attributes include operation names, providers, route templates,
statuses, durations and source refs such as request, project, document and job
ids. Raw document text, raw prompts, raw file contents, bearer tokens and secret
headers are not exported as trace attributes.

local collector example:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
    logs:
      receivers: [otlp]
      exporters: [debug]
```

For Docker Compose, run an OpenTelemetry Collector on the same network and set:

```env
MINDORY_OTEL_TRACES_ENABLED=true
MINDORY_OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces
MINDORY_OTEL_LOG_EXPORT_ENABLED=true
MINDORY_OTEL_LOG_EXPORT_ENDPOINT=http://otel-collector:4318/v1/logs
```

## Health Endpoints

The API exposes:

- `GET /health`
- `GET /ready`

Both payloads include request id, timestamp, uptime and baseline observability
metadata. `/ready` also reports configured dependency presence and rate-limit
configuration without opening database or Redis connections in bare app tests.

## Rate Limit Strategy

The MVP rate limiter is in-process per API instance:

- authenticated requests are keyed by a SHA-256 hash of the authorization
  header;
- unauthenticated requests are keyed by client IP;
- `/health` and `/ready` are exempt;
- responses include `x-ratelimit-limit`, `x-ratelimit-remaining` and
  `x-ratelimit-reset`;
- rejected requests return structured `429 rate_limited` errors.

Production deployments should enforce global limits, TLS and upload size limits
at the reverse proxy or load balancer.
