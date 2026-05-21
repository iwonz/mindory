# API

The HTTP API is the source of truth for Mindory behavior. MCP, CLI and runtime
adapters call the API rather than accessing the database directly.

## Current Skeleton

`TASK-5` adds a Fastify app factory and server entrypoint in `apps/api`.

Available process routes:

```text
GET /health
GET /ready
```

Registered project routes:

```text
POST /v1/projects
GET  /v1/projects
GET  /v1/projects/:id
```

When started through the API server runtime, project routes use
`DbProjectRepository`. When `buildApiApp` is used without dependencies, they
return structured `501 not_implemented` responses.

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
POST /v1/documents/search
```

`POST /v1/documents` is wired for multipart parsing. In the API server runtime,
`TASK-18` injects `DocumentUploadService`, local filesystem object storage,
document repositories and BullMQ dispatch, so uploads can store the file, create
the `Document` row and enqueue the first `document.scan` job. In a bare
`buildApiApp` call without dependencies, it still returns `501 not_implemented`.

Document read/status/list/search routes use document repositories when the API
server runtime is built. Document search uses pgvector semantic search when an
embeddings provider is configured; otherwise it falls back to text-based chunk
search for scaffold/local operation.

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
runtime is built. In a bare `buildApiApp` call without dependencies, they return
structured `501 not_implemented` responses.

Manual `POST /v1/memories` still defaults to `active` memory claims and requires
source refs. Automatic memory derivation is worker-side only and creates
`candidate` claims for later review.

Registered processing job routes:

```text
GET  /v1/jobs/:id
GET  /v1/jobs
POST /v1/jobs/:id/retry
```

`TASK-21` wires these routes to `ProcessingJobStore` and
`ProcessingJobDispatcher` in the API runtime. Job reads and manual retry are
project-scoped and require `project:read` permission.

## MCP Boundary

`TASK-11` adds MCP tools in `apps/mcp`; those tools call HTTP API paths rather
than repositories or database internals. `TASK-21` adds job get/list/retry tool
coverage over the jobs API. Token management remains outside the current MCP
tool set.

## CLI Boundary

`TASK-12` adds the `mindory` CLI in `apps/cli`. CLI commands also call HTTP API
paths rather than repositories or database internals. `TASK-21` wires job
list/retry commands to implemented API routes; token creation remains planned.

## Hermes Adapter Boundary

`TASK-13` adds the Hermes adapter in `apps/adapters/hermes`. It calls HTTP API
paths for project/peer/session setup, context build, message append, document
upload and optional memory/document tools. The API server runtime now accepts
document uploads through local-fs storage and BullMQ scan job dispatch.

## Error Shape

Errors return JSON with:

```json
{
  "error": {
    "code": "not_implemented",
    "message": "Project listing requires persistence repositories from a later task.",
    "statusCode": 501,
    "requestId": "request-id"
  }
}
```

When the API server runtime is built, bearer tokens are verified against hashed
access tokens in PostgreSQL and route handlers enforce project-scoped
permissions. A bare `buildApiApp` call without auth dependencies still uses the
placeholder context for scaffold tests and returns the existing explicit
placeholders.

## MVP Endpoint Groups

- Projects
- Tokens (planned)
- Peers
- Sessions and messages
- Documents and document search
- Memories and memory search
- Context builder
- Processing jobs

Remaining token endpoint group and response normalization will be added in later
tasks.

`TASK-14` adds Drizzle-backed repository classes in `@mindory/db`. `TASK-15`
adds API runtime dependency construction and wires core routes to those
repositories. `TASK-17` wires access token verification and route-level
permission checks. `TASK-18` wires document upload storage/queue runtime.
`TASK-20` wires pgvector-backed document chunk search. `TASK-21` wires
processing job status/list/retry routes. `TASK-22` wires message-triggered
summary and conservative memory derivation jobs.
