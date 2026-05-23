# Mindory

Mindory is a self-hosted, project-scoped, evidence-backed memory backend for AI
agents. It is designed to persist sessions, messages, documents, chunks and
memory claims so agents can recall source-backed context across sessions.

The canonical product and engineering specification is `docs/PRD.md`.

## Repository Status

This repository is complete through `TASK-135`. Mindory can run a local
demo-MVP through Docker Compose, seed demo credentials, process uploaded
documents through the worker pipeline and run live acceptance. `pnpm check`
passes through the repo validation, typecheck, lint, tests and dry-run
installer, public self-host, local-model, Web UI E2E and final public-ready
acceptance paths.

Release status:

- `v0.1.0` is a historical pre-release and is stale relative to the current
  `master` baseline.
- `v0.1.1` is the fresh target pre-release for the `TASK-133` through
  `TASK-147` series.
- The `v0.1.1` target promotes OCR, ASR, vision captioning, object detection,
  image embeddings, face detection/recognition, image generation, audio
  generation, local-command runners and local-http runners into checked
  supported local/install/runtime paths. `TASK-133` registered that contract;
  `TASK-134` promoted the central role/provider support matrix; `TASK-135`
  added the supported PaddleOCR local OCR runner profile.

The current state is intentionally split into supported local-MVP surfaces,
experimental profile surfaces and documented non-MVP surfaces:

| Area | Current state |
| --- | --- |
| API | Supported local MVP: Fastify server runtime wires PostgreSQL repositories, bearer-token access control, projects, tokens, peers, sessions, messages, memories, context, documents, jobs, document/artifact search and unified multimodal search routes. Product startup requires runtime dependencies before serving traffic; dependency-free app construction is explicit test mode. |
| Worker pipeline | Supported local MVP: scan, route, extract, chunk, embed and index processors are registered. Text and metadata fallback search work without external model credentials. |
| Document modalities | Supported fallback: text/Markdown, native-text PDF, scanned-PDF OCR through local HTTP when enabled, image OCR/vision/object detection/image embeddings/face detection and recognition through local HTTP or local-command where the role supports it, deterministic image metadata fallback, audio ASR through local HTTP when enabled plus embedded WAV transcript fallback, and video keyframes through manifest fallback, bundled ffmpeg extraction or opt-in local-command extraction. |
| Vectors | Supported local MVP: pgvector for 1536-dimensional text chunk and image artifact embeddings when compatible providers are configured. Supported runtime option: Qdrant via `MINDORY_VECTOR_PROVIDER=qdrant`. Supported fallback: PostgreSQL full-text search when embeddings are disabled. |
| LLM/model runtime | Supported boundary: all model operations route through `@mindory/llm`, with disabled behavior, audit hooks, OpenAI-compatible chat/text embeddings/image generation/audio generation, Ollama text embeddings, local HTTP chat/text embeddings/image embeddings/OCR/vision captioning/ASR/face/generation roles, local-command role contracts, local provider health checks and deterministic local acceptance profiles. `LOCAL_MODEL_RUNNER_CATALOG` records local runner source/image metadata, model files, healthchecks and resource hints; supported Compose profiles and installer auto-install choices resolve from that catalog. |
| Interfaces | Supported local MVP: HTTP API, CLI and MCP stdio tools call the API, including unified multimodal search. Hermes adapter exposes lifecycle helpers, hook registration for Hermes-like runtimes, a runnable example host and conformance harnesses; no external Hermes SDK code is vendored. |
| Installer | Supported today: wizard, plan/dry-run, prepare execution for `$MINDORY_HOME` directories/config/compose assets, Docker Compose startup through health checks, supported local model auto-install with resource preflight/logs/Ollama pulls/PaddleOCR health checks, S3 bucket bootstrap/access checks, first project/token provisioning, local asset update, signed remote release update, runtime backup/restore, scheduled local backups with retention/health, local Compose PostgreSQL PITR, encrypted remote backup archives with S3-compatible upload/download verification, external S3 object inventory/streaming backup/restore, guarded uninstall, dependency detection, lock/journal resume/repair, signed bootstrap staging, installer acceptance and public self-host acceptance. |
| Deployment | Supported local MVP: Compose stack with single-home bind mounts under `MINDORY_HOME`, defaulting to `${HOME}/.mindory` outside demo scripts. Release bundle generation, signed manifest verification, generated release notes, tag-build Docker image publishing to GHCR and signed remote update/rollback are supported; unattended update automation remains outside the current scope. |
| Observability | Supported baseline: structured log helpers, model operation audit queries, Prometheus API/worker metrics exporters, OpenTelemetry OTLP tracing/log export, in-process job/stage metrics, health snapshots and documented in-process rate-limit strategy. |
| Web UI | Supported local MVP surface: `@mindory/ui` builds as a workspace package and provides token/API URL entry, API health, project/session navigation, session message inspection, document upload, document list/detail, job progress, retry/reprocess controls, artifact source refs, unified search, context preview, manual memory creation, source-backed memory display, face identity operations and runtime diagnostics through HTTP API calls. Docker Compose and installer deployments include the `ui` service on `MINDORY_UI_PORT` with `/api` proxy routing through `MINDORY_UI_API_URL`; Playwright acceptance covers login, upload, jobs, artifacts/source refs, search, memory, context and desktop/mobile layout. |

Public repository files:

- `LICENSE`: Apache-2.0 license.
- `CONTRIBUTING.md`: contributor workflow and task process.
- `SECURITY.md`: vulnerability reporting policy.
- `CHANGELOG.md`: changelog and release notes policy.
- `docs/RELEASE_CHECKLIST.md`: release secret, artifact, Docker tag and
  release-notes checklist.
- `docs/REPOSITORY_STATUS.md`: current public repository status.
- `docs/SUPPORT_MATRIX.md`: supported, experimental and planned capability
  matrix.
- `docs/UI.md`: Web UI build, run and validation notes.

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

The public self-host gate is:

```bash
pnpm selfhost:gate
```

By default this runs the live Docker release gate with temporary
`MINDORY_HOME` directories. It covers sync ClamAV, pgvector, Qdrant, Docling,
upload/search/context, runtime backup, restore smoke, signed remote update and
uninstall. To run the non-Docker dry-run path:

```bash
pnpm selfhost:gate -- --dry-run
```

`pnpm selfhost:acceptance` is the dry-run path used by `pnpm check`.

The final public-ready pre-release gate is:

```bash
pnpm public-ready:gate
```

By default it dry-runs the checklist and is included in `pnpm check`. Live mode
runs the full release announcement gate from a fresh clone:

```bash
MINDORY_PUBLIC_READY_LIVE=true pnpm public-ready:gate
```

The live gate verifies the published pre-release bootstrap, self-host live
matrix, local-model live profile, full Web UI Playwright flow, public wording
gate and clean `git status --short`.

The deterministic local-model profile has a separate dry-run gate:

```bash
pnpm local-model:acceptance
```

Set `MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE=true` to run the live Docker gate. Live
mode starts `pnpm mvp:demo --model-profile local --require-indexed` in a
temporary `MINDORY_HOME`, verifies OCR/ASR/vision/face artifacts, source refs,
jobs, unified search and worker model-operation metrics, then resets the stack.

The Web UI can be built and run locally:

```bash
pnpm --filter @mindory/ui build
pnpm --filter @mindory/ui start
```

It serves `http://127.0.0.1:3080` from the source package by default. In Docker
and installer deployments the `ui` service is published on
`http://localhost:3080` and proxies `/api` to the `api` service through
`MINDORY_UI_API_URL`.

The Web UI E2E dry-run is part of `pnpm check`:

```bash
pnpm ui:e2e
```

Run the live Playwright flow against a started API/UI stack:

```bash
MINDORY_UI_E2E_LIVE=true \
MINDORY_UI_E2E_URL=http://localhost:3080 \
MINDORY_E2E_API_URL=http://localhost:3000 \
pnpm ui:e2e
```

If Playwright browsers are not installed, run
`pnpm exec playwright install chromium` or set
`MINDORY_UI_E2E_BROWSER_EXECUTABLE` to a local Chrome/Chromium binary.

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
node scripts/validate-api-contract.js
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
`docs/DEPLOYMENT.md`; run `pnpm release:validate` to verify the signed manifest,
bundle checksum and packaged installer smoke locally without publishing.

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
tests must opt into dependency-free route mode; product startup requires
injected runtime dependencies before serving traffic.

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
dependency-free behavior is limited to explicit tests.

The processing packages expose built-in text/Markdown extraction, native-text
PDF extraction, scanned-PDF OCR, image OCR/vision captioning, audio ASR,
deterministic video fallback extractors, chunking, the `@mindory/llm` provider
entrypoint, document routing, pgvector search and selectable Qdrant search.
Text extraction/chunking writes derived artifact rows
and text spans; fallback document search uses PostgreSQL full-text search over
those spans.

The memory/context packages expose `MemoryService`, `ConservativeMemoryDeriver`
and `ContextBuilder` contracts plus Fastify route surfaces for `/v1/memories`
and `/v1/context/build`. Manual memory remember defaults to active claims;
worker-side derivation creates candidate claims only.

The MCP package exposes a `MindoryApiClient`, tool definitions, tool registry,
server builder and `mindory-mcp` stdio binary. Tools call the Mindory HTTP API
and do not access database, queue, storage or vector internals directly.

The UI package exposes `@mindory/ui`, a static browser app plus local static/API
proxy server. It covers token entry, health, project/session navigation,
messages, document upload, pipeline jobs, retry/reprocess controls and artifact
source refs, unified search, context preview, manual memory creation,
source-backed memories, face identity list/rename/merge and runtime diagnostics
for storage/vector/AV/model settings, provider health, job status, metrics links
and redacted installer/config summary through the HTTP API. It does not access
database, queue, storage, vector or worker internals directly. `TASK-130` wires
the UI into Docker Compose, release assets and installer-generated runtime
configuration, and `TASK-131` adds the Playwright E2E acceptance gate.

The CLI package exposes the `mindory` binary, a minimal bootstrap argument
parser, and commands for project, token, session, message, document, memory,
context and job operations. Token commands can create, list, revoke and rotate
project-scoped bearer tokens. Commands call HTTP API paths, use stable exit codes
for usage/API/network failures, and do not access database or worker internals
directly.

The Hermes adapter package exposes identity mapping, HTTP client, lifecycle
helpers, runtime hook installation, a runnable example host and optional
`memor_*` tools. It preserves external user/session/agent ids as stable Mindory
ids, builds context before prompt construction, saves turns after responses and
preserves attachment metadata on saved messages. Acceptance covers the runtime
contract, example host and hook conformance through HTTP API harnesses.

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
