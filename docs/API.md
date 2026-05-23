# API

The HTTP API is the source of truth for Mindory behavior. MCP, CLI and runtime
adapters call the API rather than accessing the database directly.

## Runtime Contract

Available process routes:

```text
GET /health
GET /ready
GET /metrics
```

`GET /metrics` is available only when `MINDORY_METRICS_ENABLED=true`. If
`MINDORY_METRICS_BEARER_TOKEN` is set, the route requires `Authorization:
Bearer <token>` and returns Prometheus text format.

Registered project routes:

```text
POST /v1/projects
GET  /v1/projects
GET  /v1/projects/:id
```

When started through the API server runtime, project routes use
`DbProjectRepository`. The product server requires all route dependencies during
startup. Tests that intentionally construct a dependency-free app must pass
`allowDependencyFreeRoutes: true`.

Registered token routes:

```text
POST /v1/tokens
GET  /v1/tokens
POST /v1/tokens/:id/revoke
POST /v1/tokens/:id/rotate
```

`POST /v1/tokens` creates a project-scoped bearer token, stores only the
SHA-256 token hash and returns the raw token exactly once in the response.
`GET /v1/tokens` lists token metadata without raw token values or hashes.
Revoke marks a token `revoked`; rotate replaces the stored hash with a new raw
token while preserving the token's project permissions. Listing requires
`token:read`; create, revoke and rotate require `token:write`.

Registered peer routes:

```text
POST /v1/peers
GET  /v1/peers
GET  /v1/peers/:id
```

Registered session/message routes:

```text
POST /v1/sessions
GET  /v1/sessions
GET  /v1/sessions/:id
POST /v1/sessions/:id/messages
GET  /v1/sessions/:id/messages
```

When the API server runtime is built, message append persists the message and
enqueues `session.summarize` plus `memory.derive` processing jobs. The response
includes `processing_jobs` when dispatch succeeds. A bare `buildApiApp` call
without a dispatcher still persists messages through the injected session
repository and skips these runtime jobs.

Registered document routes:

```text
POST /v1/documents
GET  /v1/documents
GET  /v1/documents/:id
GET  /v1/documents/:id/status
GET  /v1/documents/:id/processing-runs
GET  /v1/documents/:id/artifacts
POST /v1/documents/:id/recompute
POST /v1/documents/search
```

`POST /v1/documents` is wired for multipart parsing. In the API server runtime,
`DocumentUploadService`, object storage, document repositories and BullMQ
dispatch are injected, so uploads can store the file, create the `Document` row
and enqueue `document.scan` when async antivirus is required or `document.route`
when it can route immediately. The upload response includes `scan_job` and
`route_job` fields.

Document read/status/list/search routes use document repositories when the API
server runtime is built. Document search uses pgvector semantic search when an
embeddings provider is configured; otherwise it falls back to text-based chunk
search for local operation. Fallback search uses PostgreSQL full-text search
over derived artifact text spans and returns source refs for the artifact,
processing run and chunk. Search also accepts optional `metadataFilters` over
typed attachment metadata. Numeric filters support `lt`, `lte`, `gt`, `gte` and
`between`; text, boolean and timestamp filters support exact `eq` matching.
Current metadata keys include size, MIME, extension, checksum, media type,
container, duration, dimensions, page count, frame count and codec when the
route stage can derive them.

Example document search request:

```json
{
  "projectIds": ["homelab"],
  "query": "source-backed context",
  "limit": 5,
  "metadataFilters": [
    { "key": "size_bytes", "operator": "lte", "valueNumber": 104857600, "unit": "bytes" },
    { "key": "duration_ms", "operator": "between", "minNumber": 10000, "maxNumber": 15000, "unit": "ms" }
  ]
}
```

`GET /v1/documents/:id/artifacts` lists derived artifacts for a document with
source refs, source positions, model metadata and derived content/storage
references. The Web UI uses this route for its document pipeline workspace.

`POST /v1/documents/:id/recompute` enqueues a `document.recompute` job. The
worker creates a new `processing_run`, supersedes older derived runs for the
same requested stage, keeps the RAW storage key unchanged, then routes the
document back through the enabled processing graph.

Registered artifact search route:

```text
POST /v1/artifacts/search
```

Artifact search scans current non-superseded derived text spans across extracted
text, OCR, transcripts, captions, image object observations, video keyframes and
face observation spans.
It supports `artifactTypes`, `spanTypes`, `metadataFilters`, `projectIds`,
optional `query` and `limit`, and returns artifact ids, source refs, source
positions and span metadata. If `query` is omitted, callers must provide a
constraining metadata, artifact type or span type filter. It requires
`document:search` for every requested project.

Registered unified multimodal search route:

```text
POST /v1/search
```

Unified search combines document chunk search, derived artifact span search,
image artifact-vector search and face observation search. It accepts `targets` (`documents`, `artifacts`,
`faces`), `artifactTypes`, `spanTypes`, `faceIdentityStatuses`,
`metadataFilters`, optional `query` and `limit`. Document hits use pgvector when
text embeddings are configured and full-text fallback otherwise. Artifact hits
cover OCR text, transcripts, captions, image object observations,
`image_embedding` vector hits, video keyframe descriptions and face observation
spans. Face hits match workspace-scoped face identities and
observations. Every hit includes `source_refs` and `source_position` where the
underlying artifact has page, frame, timestamp, bounding box or confidence
metadata.

Registered memory route surfaces:

```text
POST   /v1/memories
GET    /v1/memories/:id
POST   /v1/memories/search
POST   /v1/memories/:id/explain
DELETE /v1/memories/:id
```

Registered context route surface:

```text
POST /v1/context/build
```

These routes use `MemoryService` and `ContextBuilder` when the API server
runtime is built. Product startup requires those dependencies before serving
traffic.

Manual `POST /v1/memories` still defaults to `active` memory claims and requires
source refs. Accepted source ref types match runtime evidence surfaces:
`session`, `message`, `document`, `chunk`, `artifact`, `processing_run`,
`face_identity`, `face_observation` and `memory`. Automatic memory derivation
is worker-side only and creates `candidate` claims for later review.

Registered face route surfaces:

```text
GET   /v1/faces/identities
GET   /v1/faces/identities/:id
GET   /v1/faces/observations
PATCH /v1/faces/identities/:id
POST  /v1/faces/identities/:id/merge
```

Face routes use `FaceService` when the API server runtime is built. Reads
require `face:read`; rename and merge require `face:write`. Identities and
observations are always project-scoped. Merge archives the source identity and
reassigns its observations to the target identity.

Registered processing job routes:

```text
GET  /v1/jobs/:id
GET  /v1/jobs
POST /v1/jobs/:id/retry
```

These routes use `ProcessingJobStore` and `ProcessingJobDispatcher` in the API
runtime. Job reads and manual retry are project-scoped and require
`project:read` permission.

Job responses include a normalized `details` object in addition to the raw
durable metadata. `details.status` can describe stage graph
outcomes such as `skipped`, `disabled`, `blocked_by_scan`, `partial_failed`,
`failed` or `retrying` while the database row keeps its coarse durable job
status. `details.stages` carries per-stage progress and queued child job ids.
`details.error` exposes readable error code/message, attempt counts and
retryability for failed jobs.

## MCP Boundary

MCP tools in `apps/mcp` call HTTP API paths rather than repositories or database
internals. Job get/list/retry tools call the jobs API. Token management remains
outside the current MCP tool set.

## CLI Boundary

The `mindory` CLI in `apps/cli` calls HTTP API paths rather than repositories or
database internals. Job list/retry and token create/list/revoke/rotate commands
call implemented API routes.

## Hermes Adapter Boundary

The Hermes adapter in `apps/adapters/hermes` calls HTTP API paths for
project/peer/session setup, context build, message append, document upload and
optional memory/document tools. The API server runtime accepts document uploads
through object storage and BullMQ scan job dispatch.

## Error Shape

Errors return JSON with:

```json
{
  "error": {
    "code": "project_access_denied",
    "message": "Token does not grant project:read on project homelab.",
    "statusCode": 403,
    "requestId": "request-id"
  }
}
```

When the API server runtime is built, bearer tokens are verified against hashed
access tokens in PostgreSQL and route handlers enforce project-scoped
permissions. Dependency-free app construction is an explicit test mode and is
not a product runtime.

## MVP Endpoint Groups

- Projects
- Tokens
- Peers
- Sessions and messages
- Documents and document search
- Artifact search
- Unified multimodal search
- Face identities and observations
- Memories and memory search
- Context builder
- Processing jobs

The API runtime wires Drizzle-backed repositories, access token verification,
route-level permission checks, document upload storage/queue runtime,
pgvector-backed document chunk search, processing job status/list/retry routes,
message-triggered summary and memory derivation jobs, token lifecycle
operations, face identity/observation management and unified multimodal search.
