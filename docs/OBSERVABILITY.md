# Observability

Mindory's MVP observability baseline is intentionally small and self-hostable.
It provides structured logs, in-process audit/metric helpers, lightweight health
payloads and documented rate-limit behavior. Prometheus, OpenTelemetry,
external log aggregation, alerting and durable enterprise audit tables are
future hardening work.

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
API keys and secret values must be redacted before they are logged.

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

The in-memory store is for local diagnostics and tests only. Durable audit
persistence and query APIs are future work.

## Job Stage Metrics

`JobStageMetrics` records in-process job stage observations and summarizes them
by job type, stage and status. The summary includes count, total duration,
maximum duration and average duration.

Use it for lightweight diagnostics around worker stages such as scan, extract,
chunk, embed, index, OCR, ASR, keyframe extraction and face matching. It is not a
Prometheus exporter and does not persist metrics after process restart.

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

Distributed rate limiting remains future hardening. Production deployments
should enforce global limits, TLS and upload size limits at the reverse proxy or
load balancer.
