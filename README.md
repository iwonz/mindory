# Mindory

Mindory is a self-hosted, project-scoped, evidence-backed memory backend for AI
agents. It is designed to persist sessions, messages, documents, chunks and
memory claims so agents can recall source-backed context across sessions.

The canonical product and engineering specification is `docs/PRD.md`.

## Repository Status

This repository is complete through `TASK-82`. Mindory can run a local
demo-MVP through Docker Compose, seed demo credentials, process uploaded
documents through the worker pipeline and run live acceptance. `pnpm check`
passes through the repo validation, typecheck, lint, tests and dry-run
installer acceptance path.

The current state is intentionally split into supported local-MVP surfaces,
experimental/profile-smoke surfaces and future work:

| Area | Current state |
| --- | --- |
| API | Supported local MVP: Fastify server runtime wires PostgreSQL repositories, bearer-token access control, projects, tokens, peers, sessions, messages, memories, context, documents, jobs, document/artifact search and unified multimodal search routes. Bare app factories may return structured `501` responses when runtime dependencies are omitted for tests. |
| Worker pipeline | Supported local MVP: scan, route, extract, chunk, embed and index processors are registered. Text and metadata fallback search work without external model credentials. |
| Document modalities | Supported fallback: text/Markdown, native-text PDF, scanned-PDF OCR through local HTTP when enabled, image OCR/vision/face detection and recognition through local HTTP when enabled plus deterministic image metadata fallback, audio ASR through local HTTP when enabled plus embedded WAV transcript fallback, and video keyframes through manifest fallback or opt-in local-command extraction. Future: bundled ffmpeg profiles, image embeddings and object detection. |
| Vectors | Supported local MVP: pgvector for 1536-dimensional text embeddings when a compatible provider is configured. Supported fallback: PostgreSQL full-text search when embeddings are disabled. Future: Qdrant adapter. |
| LLM/model runtime | Supported boundary: all model operations route through `@mindory/llm`, with disabled behavior, audit hooks, OpenAI-compatible chat/embeddings, Ollama text embeddings, local HTTP chat/embeddings/OCR/vision captioning/ASR/face roles, local provider health checks and deterministic local acceptance profiles. Unsupported roles remain disabled or experimental until concrete adapters land. |
| Interfaces | Supported local MVP: HTTP API, CLI and MCP stdio tools call the API, including unified multimodal search. Hermes adapter exposes the lifecycle surface but does not import or verify against a real Hermes SDK yet. |
| Installer | Supported today: wizard, plan/dry-run, prepare execution for `$MINDORY_HOME` directories/config/compose assets, Docker Compose startup through health checks, S3 bucket bootstrap/access checks, first project/token provisioning, local asset update, guarded uninstall, dependency detection, lock/journal diagnostics, bootstrap staging and installer acceptance. Future: remote release update and full automated resume execution. |
| Deployment | Supported local MVP: Compose stack with single-home bind mounts under `MINDORY_HOME`, defaulting to `${HOME}/.mindory` outside demo scripts. Future: release artifact publishing and production-grade update/rollback automation. |

Public repository files:

- `LICENSE`: Apache-2.0 license.
- `CONTRIBUTING.md`: contributor workflow and task process.
- `SECURITY.md`: vulnerability reporting policy.
- `CHANGELOG.md`: changelog and release notes policy.
- `docs/REPOSITORY_STATUS.md`: current public repository status.
- `docs/SUPPORT_MATRIX.md`: supported, experimental, placeholder and future
  capability matrix.

## Development Process

Mindory uses the Mindory Ralph-cycle:

1. Read `PRD.md`.
2. Read `tasks/tasks.json`.
3. Read the current task file.
4. Implement only the current task scope.
5. Keep docs and `.env.example` current.
6. Verify acceptance criteria before finishing.

Task IDs use the `TASK-<number>` format, such as `TASK-1`.

## Local Demo And Development Checks

The one-command local demo with live acceptance is:

```bash
pnpm mvp:demo
```

To start and seed the stack without running live acceptance:

```bash
pnpm mvp:up
```

Stop the demo stack with `pnpm mvp:down`. Remove containers and default demo
home data with:

```bash
pnpm mvp:reset
```

The default demo keeps heavy model services disabled. It proves the runnable
API, worker, MCP, CLI, Hermes-surface, document upload, job polling,
source-backed memory and context flows with deterministic model fallbacks.

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
The release workflow and local release validation path are documented in
`docs/DEPLOYMENT.md`; run `pnpm release:validate` to verify bundle, checksum and
packaged installer smoke locally without publishing.

`pnpm test` runs the real MVP integration suite. It starts the separate
`mindory-test` Docker Compose project for PostgreSQL and Redis, applies
migrations, starts API and worker runtimes in-process, then verifies auth,
document upload/chunking, job get/list/retry and source-backed context build.
The default test path keeps embeddings disabled and does not require external
provider credentials.

The database package also exposes `pnpm db:generate`, `pnpm db:migrate` and
`pnpm db:validate`. Local pnpm is required for Drizzle commands.

The API package exposes the Fastify app builder, server runtime and health,
readiness and `/v1/*` route surfaces. The production-style server runtime wires
repositories, auth, storage and queue dependencies. Bare app factories used by
tests still return structured placeholders when required runtime dependencies
are intentionally omitted.

The storage packages expose the shared `ObjectStorage` interface, a local
filesystem adapter and an S3-compatible adapter for LibreFS, MinIO or external
S3-compatible endpoints. The installer can bootstrap local LibreFS/MinIO buckets
or signed-check external S3-compatible bucket access. Local filesystem storage
is the default local-MVP path.

The queue packages expose processing job queue contracts, a BullMQ adapter,
worker base runner, document pipeline runtime builder and memory/context worker
processors.

The document pipeline stores uploads through `ObjectStorage`, creates document
metadata through PostgreSQL repositories and enqueues `document.scan` or
`document.route` through BullMQ. The API server runtime wires local-fs storage,
S3-compatible storage configuration and the queue dispatcher; bare app factory
placeholders are limited to dependency-free tests.

The processing packages expose built-in text/Markdown extraction, native-text
PDF extraction, scanned-PDF OCR, image OCR/vision captioning, audio ASR,
deterministic video fallback extractors, chunking, the `@mindory/llm` provider
entrypoint, document routing and pgvector search. Qdrant is documented as a
future optional adapter. Text extraction/chunking writes derived artifact rows
and text spans; fallback document search uses PostgreSQL full-text search over
those spans.

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
ids as stable Mindory ids, builds context before saving turns and preserves
attachment metadata on saved messages. Real Hermes SDK/runtime verification is
future integration work.

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
started. For self-contained indexed embeddings acceptance or local model
experiments:

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
pnpm mvp:demo --model-profile local --require-indexed
MINDORY_E2E_LIVE=true MINDORY_E2E_REQUIRE_INDEXED=true pnpm mvp:acceptance
```

The `local` model profile is self-contained and serves deterministic
1536-dimensional embeddings. External providers must also match the current
pgvector MVP schema. Disabled embeddings remain supported and should process
demo documents to `chunked`.

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
