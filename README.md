# Mindory

Mindory is a self-hosted, project-scoped, evidence-backed memory backend for AI
agents. It is designed to persist sessions, messages, documents, chunks and
memory claims so agents can recall source-backed context across sessions.

The canonical product and engineering specification is `docs/PRD.md`.

## Repository Status

This repository is currently bootstrapped through `TASK-53`. The repo has the
operating model, documentation skeleton, configuration contract, pnpm monorepo
layout, Docker Compose base scaffold, MVP database schema, Fastify API skeleton
object storage abstraction, Redis/BullMQ queue scaffold and document upload/scan
pipeline contracts. It also has text/Markdown extraction, deterministic
chunking, a unified LLM adapter for embeddings, vector index scaffolding, and
memory/context builder contracts. The MCP package now exposes HTTP-backed tool
definitions and a server registry. The CLI package now exposes HTTP-backed
commands. The Hermes adapter package maps Hermes lifecycle inputs to HTTP API
calls. The database package now exposes Drizzle-backed repository skeletons.
The API server now wires those repositories for core project, token, peer,
session, message, memory, context and document read/search routes, and verifies
project-scoped bearer tokens in the server runtime. Worker document processors
are wired in the worker package, and pgvector is wired for document chunk
embeddings/search. Jobs HTTP routes are wired. Message append now enqueues
session summary and conservative memory derivation jobs; automatic derivation
creates only candidate memories with source refs. The MCP stdio SDK transport is
wired. Docker runtime commands, integration tests, indexed-search acceptance,
MCP client packaging, Hermes runtime contract validation and the production
hardening baseline are now present. The API includes a configurable in-process
rate-limit guard, and CI runs `pnpm check` for pushes and pull requests to
`master`. A one-command local MVP demo workflow now starts Compose, waits for
readiness, seeds demo credentials and can run live acceptance. Runtime and first
installer settings are now described in a typed config catalog that generates
`.env.example` and validates `MINDORY_*` usage across code, scripts and Compose.
Model-backed work now routes through the `@mindory/llm` SDK boundary with
role-level configuration for chat, embeddings, OCR, ASR, vision, face and
generation operations.

## Development Process

Mindory uses the Mindory Ralph-cycle:

1. Read `PRD.md`.
2. Read `tasks/tasks.json`.
3. Read the current task file.
4. Implement only the current task scope.
5. Keep docs and `.env.example` current.
6. Verify acceptance criteria before finishing.

Task IDs use the `TASK-<number>` format, such as `TASK-1`.

## Local Bootstrap

`TASK-3` adds Docker Compose placeholders for API, MCP and worker services. They
prove the self-hosted service shape but do not implement product behavior.

Useful first checks:

```bash
ls AGENTS.md README.md PRD.md .env.example
ls tasks/tasks.json tasks/TASK-1.json tasks/TASK-2.json tasks/TASK-3.json
ls docs/
node scripts/check-repo.js
pnpm config:validate
node scripts/validate-db-schema.js
node scripts/validate-db-repositories.js
node scripts/validate-api-skeleton.js
node scripts/validate-api-runtime-wiring.js
node scripts/validate-storage-adapters.js
node scripts/validate-queue.js
node scripts/validate-document-pipeline.js
node scripts/validate-processing-pipeline.js
node scripts/validate-memory-context.js
node scripts/validate-mcp-server.js
node scripts/validate-cli.js
node scripts/validate-hermes-adapter.js
docker compose -f docker-compose.yml -f docker-compose.override.yml config
```

The intended package manager is pnpm. In an environment with pnpm installed,
standard scripts are available through `pnpm check`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm tasks:validate` and
`pnpm workspace:validate`.

Production hardening guidance for CI, release images, backups, rollback,
secrets, rate limits and structured logs is in `docs/PRODUCTION_HARDENING.md`.

`pnpm test` runs the real MVP integration suite. It starts the separate
`mindory-test` Docker Compose project for PostgreSQL and Redis, applies
migrations, starts API and worker runtimes in-process, then verifies auth,
document upload/chunking, job get/list/retry and source-backed context build.
The default test path keeps embeddings disabled and does not require external
provider credentials.

The database package also exposes `pnpm db:generate`, `pnpm db:migrate` and
`pnpm db:validate`. Local pnpm is required for Drizzle commands.

The API package currently exposes a Fastify app skeleton with `GET /health`,
`GET /ready` and project route stubs under `/v1/projects`.

The storage packages expose the shared `ObjectStorage` interface, a local
filesystem adapter and an S3-compatible adapter for LibreFS, MinIO or external
S3-compatible endpoints.

The queue packages expose processing job queue contracts, a BullMQ adapter,
worker base runner, document pipeline runtime builder and memory/context worker
processors.

The document pipeline code stores uploads through `ObjectStorage`, creates
document metadata through an injected repository and enqueues `document.scan` or
`document.route` through the queue dispatcher. The API server runtime now wires
those dependencies for local-fs storage and BullMQ; the bare app factory still
returns a structured placeholder when dependencies are omitted.

The processing packages expose a built-in text/Markdown extractor, a fixed-size
chunker, the `@mindory/llm` provider entrypoint, document routing, and
explicit pgvector and Qdrant vector index scaffolds. The worker package
registers scan, recompute, route, extract, chunk, embed and index processors;
pgvector is the default vector storage/search path when text embeddings are
configured. Text extraction/chunking now writes derived artifact rows and text
spans, and fallback document search uses PostgreSQL full-text search over those
spans.

The memory/context packages expose `MemoryService`, `ConservativeMemoryDeriver`
and `ContextBuilder` contracts plus Fastify route surfaces for `/v1/memories`
and `/v1/context/build`. Manual memory remember defaults to active claims;
worker-side derivation creates candidate claims only.

The MCP package exposes a `MindoryApiClient`, tool definitions, tool registry,
server builder and `mindory-mcp` stdio binary. Tools call the Mindory HTTP API
and do not access database, queue, storage or vector internals directly.

The CLI package exposes the `mindory` binary, a minimal bootstrap argument
parser, and commands for project, token, session, message, document, memory,
context and job operations. Token commands can create, list, revoke and rotate
project-scoped bearer tokens. Commands call HTTP API paths, use stable exit codes
for usage/API/network failures, and do not access database or worker internals
directly.

The Hermes adapter package exposes identity mapping, HTTP client, lifecycle
helpers and optional `memor_*` tools. It preserves external user/session/agent
ids as stable Mindory ids, builds context before saving turns, preserves
attachment metadata on saved messages, and does not import a Hermes SDK yet.

The database package exposes repository classes for projects, access tokens,
peers, sessions, messages, documents, memory claims, document chunk text search
and processing jobs. The API runtime wires core read/write repositories for
projects, tokens, peers, sessions, messages, memories, context and document
read/status/list/search, access token verification/lifecycle operations and
document upload runtime for local-fs storage plus BullMQ scan job dispatch.

## Docker Compose

The one-command local demo with live acceptance is:

```bash
pnpm mvp:demo
```

To start and seed the stack without running live acceptance:

```bash
pnpm mvp:up
```

Base services are `postgres`, `redis`, `migrate`, `api`, `mcp` and `worker`.
The API, worker and MCP services now use the built workspace image and real
dist entrypoints. Runtime state is bind-mounted under `MINDORY_HOME`, defaulting
to `${HOME}/.mindory`; API and worker use `data/objects` there for local
filesystem storage. Optional profiles are `librefs`, `minio`, `clamav`,
`qdrant`, `docling`, `ollama` and `local-models`.

The default demo model profile is disabled, so no heavy model service is
started. For profile wiring checks or local model experiments:

```bash
pnpm mvp:demo --model-profile local
pnpm mvp:demo --model-profile ollama
```

Stop the demo stack with `pnpm mvp:down`. Remove containers and default demo
home data with `pnpm mvp:reset`; explicit `MINDORY_HOME` directories are left in
place.

`pnpm mvp:acceptance` without `MINDORY_E2E_LIVE=true` runs a dry-run scenario
coverage check that does not require Docker.

With embeddings configured, run strict indexed acceptance:

```bash
MINDORY_E2E_LIVE=true MINDORY_E2E_REQUIRE_INDEXED=true pnpm mvp:acceptance
```

The current pgvector MVP schema uses 1536-dimensional vectors. Disabled
embeddings remain supported and should process demo documents to `chunked`.

## Integration Tests

Run:

```bash
pnpm test
```

By default the test runner uses:

```text
PostgreSQL: localhost:55432
Redis:      localhost:56379
```

Override these with `MINDORY_TEST_POSTGRES_PORT`, `MINDORY_TEST_REDIS_PORT`,
`MINDORY_TEST_DATABASE_URL` or `MINDORY_TEST_REDIS_URL`. Set
`MINDORY_TEST_SKIP_DOCKER=true` when pointing tests at already-running
PostgreSQL and Redis services.

`pnpm test` also starts a local OpenAI-compatible fake embeddings server for the
indexed-search scenario, so it verifies pgvector row persistence without
external provider credentials.
