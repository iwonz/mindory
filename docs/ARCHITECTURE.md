# Architecture

Mindory is a self-hosted, project-scoped, evidence-backed memory backend for AI
agents. The HTTP API is the source of truth for external interfaces, while
PostgreSQL remains the canonical business-state store.

## Core Boundaries

- API: stateless Fastify service.
- Database: PostgreSQL with Drizzle schema and migrations.
- Queue/cache: Redis and BullMQ for async work, not durable business state.
- Object storage: local filesystem or S3-compatible storage for original files.
- Vector index: replaceable index, with pgvector as the default MVP target.
- Workers: independently scalable processors for scan, recompute, routing,
  extraction, chunking, embeddings, indexing, memory derivation and session
  summaries.
- MCP: agent-facing interface over the core API.
- CLI: user-facing command line client over the HTTP API.
- Hermes adapter: runtime integration that calls the HTTP API.

## MVP Shape

The MVP should prove durable sessions, source-backed memories, document upload
and processing, context building, MCP, CLI and one Hermes adapter without
implementing future enterprise features early.

## Monorepo Layout

`TASK-2` establishes the pnpm workspace skeleton:

- `apps/` contains API, MCP, CLI, worker and Hermes adapter applications.
- `packages/` contains shared core, database, SDK, config, auth, storage,
  queue, vector, processor and observability packages.
- Root TypeScript project references cover every workspace package.

Workspace `src/index.ts` files are placeholders only. Runtime behavior is added
by later task-scoped changes.

## Compose Scaffold

`TASK-3` adds Docker Compose services for Postgres, Redis, API, MCP and worker.
`TASK-26` replaces API, MCP and worker placeholders with a shared built Node
image, a `migrate` service running `pnpm db:migrate`, real dist entrypoints and
local object storage mounts for API/worker.

`TASK-57` moves Compose runtime state from Docker named volumes into bind mounts
under the host `MINDORY_HOME` root. Postgres, Redis, local object storage,
LibreFS data, logs, config and future installer state now live in one
Mindory-owned directory so installer update/uninstall flows can reason about a
single root.

Optional profiles define LibreFS, MinIO, ClamAV, Qdrant, Docling, Ollama and a
lightweight deterministic local LLM service without making those services
mandatory for the base stack.

## Database Schema

`TASK-4` adds the MVP PostgreSQL schema in `packages/db`. The schema is declared
with Drizzle and mirrored by the initial SQL migration. PostgreSQL remains the
canonical state store for projects, tokens, peers, sessions, messages,
documents, chunks, memory claims and processing jobs.

Runtime repositories and API handlers are intentionally not part of the schema
task.

`TASK-14` adds the first database repository layer in `@mindory/db`:

- project and peer repositories;
- session and message repositories;
- document repository implementing `DocumentRepository`;
- memory repository implementing `MemoryRepository`;
- processing job store implementing `ProcessingJobStore`;
- text-based document chunk search repository for repository wiring tests.

These repositories are Drizzle-backed skeletons. Core API runtime wiring now
uses them, but they have not been exercised against a live PostgreSQL database
in the bootstrap environment.

`TASK-15` wires the first API runtime dependency graph:

- `@mindory/db/client` creates the PostgreSQL pool and Drizzle database.
- `apps/api/src/runtime.ts` creates repository instances from config.
- Project, peer, session, message, memory, context and document
  read/status/list/search routes use injected repositories.
- Repository not-found errors are mapped to structured API 404 responses.

`TASK-17` adds API access token verification through `@mindory/auth` and
`DbAccessTokenRepository`. `TASK-18` wires document upload runtime with local
object storage, `DbProcessingJobStore`, `ProcessingJobDispatcher` and BullMQ.
`TASK-20` wires pgvector storage/search for document chunk embeddings.
`TASK-21` exposes processing job status/list/retry routes. `TASK-22` adds
session summary and conservative memory derivation processors to the worker
runtime.

## API Skeleton

`TASK-5` adds the Fastify API process shape in `apps/api`. The app loads
configuration from `@mindory/config`, registers health/readiness routes,
attaches an authorization context, and returns structured errors. Runtime API
construction verifies bearer tokens against PostgreSQL token hashes; bare app
factory usage still has a placeholder context for scaffold validation.

Project routes are registered under `/v1/projects`, but they intentionally
use injected repositories when the server runtime is built. If the app factory
is used without dependencies, routes still return explicit `501 not_implemented`
placeholders. Docker Compose still uses the explicit TASK-3 placeholders until a
later task adds runnable images or installed dependencies.

## Configuration Catalog

`TASK-52` makes `packages/config/src/catalog.ts` the central catalog for
Mindory configuration metadata. Runtime loaders, generated `.env.example`,
future installer prompts and Compose/env validation all derive their defaults
and supported values from this catalog.

This keeps installer work, Docker profiles and runtime packages aligned: new
`MINDORY_*` settings are invalid until the catalog describes their type,
default, support status, visibility and secret handling.

`TASK-58` adds `@mindory/installer` as the deterministic installer core. It
builds answer-file install plans, dependency check results, generated config and
env files, transaction journal entries, rollback ordering and redacted summaries
without running interactive prompts or mutating host dependencies.

`TASK-59` adds the wizard layer over that core. The wizard uses stable prompt
IDs and injectable IO for testability, derives prompt metadata from the config
catalog, shows a redacted confirmation preview and returns a validated answer
file without executing the install plan.

## Object Storage

`TASK-6` adds the shared `ObjectStorage` contract in `@mindory/core` and adapter
packages for local filesystem and S3-compatible storage. The local filesystem
adapter can write, read, stat, check and delete objects under a configured root
path while rejecting absolute keys and path traversal.

`TASK-56` implements the S3-compatible adapter without a cloud-vendor SDK. It
signs requests with AWS SigV4 and supports PUT, GET, HEAD and DELETE against
path-style or virtual-host-style S3 endpoints. API and worker runtimes select it
when `MINDORY_STORAGE_PROVIDER=s3`, so LibreFS, MinIO and external S3-compatible
services share the same storage boundary.

## Queue And Workers

`TASK-7` adds processing job queue contracts in `@mindory/core`, a BullMQ adapter
in `@mindory/queue-bullmq`, and a worker base runner in `apps/worker`.

The boundary is deliberate:

- PostgreSQL `processing_jobs` rows are canonical durable business state.
- BullMQ receives payloads with durable `processingJobId` and idempotency key.
- The dispatcher creates the durable job before enqueueing BullMQ work.
- The base runner marks jobs running, succeeded and failed through an injected
  store interface.

Concrete PostgreSQL repositories and document processors are later tasks.

## Document Upload And Scan

`TASK-8` adds document upload and scan pipeline contracts:

- `@mindory/core` defines document status/model types, `DocumentRepository` and
  `DocumentUploadService`.
- The upload service writes the original blob through `ObjectStorage`, then
  creates document metadata through the repository interface.
- In `async_quarantine` mode, it creates a durable `document.scan` job through
  `ProcessingJobDispatcher`.
- When scan is not required, it creates a durable `document.route` job so the
  worker can classify the file before downstream processing.
- `@mindory/processor-antivirus-clamav` implements the ClamAV scanner adapter
  and a `document.scan` processor wrapper that enqueues routing after a clean
  verdict.

The API server runtime now includes concrete local-fs storage, document
repository and BullMQ queue dependencies for uploads. The bare app factory still
returns explicit `not_implemented` responses when dependencies are omitted.

## Extraction, Chunking And Indexing

`TASK-9` adds the next document processing boundary:

- `@mindory/core/processing` defines text extraction, chunking, embeddings and
  vector index contracts.
- `FixedSizeTextChunker` creates deterministic token-window chunks with
  `start_offset`, `end_offset` and token count metadata.
- `@mindory/extractor-builtin-text` handles UTF-8 plain text and simple Markdown
  normalization for `.txt`, `.md` and `.markdown` inputs.
- `@mindory/core/document-routing` classifies uploads by MIME, extension and
  magic bytes, then plans only enabled downstream jobs.
- `@mindory/llm` is the runtime adapter entrypoint for text
  embeddings and future OCR, ASR, vision and face capabilities, including
  OpenAI-compatible API key or OAuth bearer auth.
- `@mindory/vector-pgvector` implements the default PostgreSQL vector index.
- `@mindory/vector-qdrant` remains an optional future vector adapter.
- `@mindory/core/artifacts` and `DbDerivedArtifactRepository` define the
  derived artifact boundary for processing runs, artifact records, media
  metadata and workspace-scoped face observations.
- `POST /v1/artifacts/search` queries that derived artifact boundary across
  current text spans, metadata filters and source positions without reading RAW
  objects.
- `@mindory/core/faces` owns face identity operations, automatic observation
  matching by same-project embeddings, rename and merge semantics.
- Audio transcript extraction writes derived transcript artifacts and time-coded
  spans through the same artifact boundary.
- Video keyframe extraction writes derived `video_keyframe` artifacts and frame
  description spans through the same artifact boundary.
- The text pipeline writes extracted text and chunk spans through that artifact
  boundary before updating legacy chunk rows, so context/search hits can carry
  artifact and processing-run source refs.
- `@mindory/core/recompute` defines the document recompute request boundary.
  Recompute jobs create a new `processing_run`, supersede older runs by stage
  and enqueue routing while preserving the original document storage key.

Qdrant runtime remains an optional future adapter.

## Memory And Context Builder

`TASK-10` adds the memory/context domain boundary:

- `@mindory/core/memory` defines `SourceRef`, `MemoryClaimRecord`,
  `MemoryRepository`, `MemoryService` and `ContextBuilder`.
- Manual remember requires at least one source reference and defaults claims to
  `active` status.
- Memory search defaults to active claims unless explicit statuses are provided.
- Memory explanation returns the claim, source refs and creation metadata.
- `ContextBuilder` assembles prompt-ready session summary, recent message,
  memory and document chunk blocks under a token budget.
- The API app registers `/v1/memories` and `/v1/context/build` route surfaces.

`TASK-22` completes the MVP runtime path for context freshness:

- Appended messages enqueue `session.summarize` and `memory.derive` jobs when
  the API runtime dispatcher is wired.
- `session.summarize` updates the session summary through `SessionRepository`.
- `memory.derive` uses conservative explicit-memory cues and writes only
  `candidate` claims with source references.
- Manual `MemoryService.remember` remains the required path for active memories.

## MCP Server

`TASK-11` adds the agent-facing MCP package boundary in `apps/mcp`, and
`TASK-23` wires it to a runnable MCP SDK stdio server:

- `MindoryApiClient` calls the Mindory HTTP API with optional bearer auth.
- `MindoryMcpToolRegistry` defines session, memory, document and context tools.
- `MindoryMcpServer` exposes `listTools` and `callTool`.
- `runMindoryMcpStdio` registers SDK `tools/list` and `tools/call` handlers and
  connects `StdioServerTransport`.
- Document upload accepts UTF-8 or base64 content and sends multipart
  `POST /v1/documents`.
- Real MCP clients spawn the stdio process locally. Compose only proves the
  packaged command starts; it does not expose a network MCP daemon.

The MCP package must not access PostgreSQL, Redis, object storage or vector
indexes directly.

## CLI

`TASK-12` adds the command-line package in `apps/cli`:

- `mindory` is exposed as the package binary.
- The CLI uses a small bootstrap argument parser without external dependencies.
- `MindoryCliApiClient` sends JSON HTTP requests and multipart document uploads.
- Commands cover project, token, session, message, document, memory, context and
  jobs operations.

The CLI follows the same source-of-truth boundary as MCP: it calls HTTP API
paths and does not import database, queue, storage or vector runtime internals.
`TASK-24` adds stable usage/API/network exit codes and smoke coverage for the
implemented MVP route mapping. Token creation remains a planned endpoint.

## Hermes Adapter

`TASK-13` adds the runtime-agnostic Hermes adapter package in
`apps/adapters/hermes`; `TASK-25` wires its lifecycle helpers to the real HTTP
runtime:

- `mapHermesIdentity` maps external Hermes user, session and agent ids to stable
  Mindory project, peer and session ids.
- `MindoryHermesAdapter.preparePromptContext` ensures identity records, calls
  `/v1/context/build` and formats prompt-ready context text.
- `MindoryHermesAdapter.handleTurn` builds context before saving the current
  user/assistant turn.
- `MindoryHermesAdapter.saveTurn` saves user and assistant messages through
  session message HTTP paths.
- Attachment uploads use multipart `POST /v1/documents` and are referenced from
  saved message metadata.
- `MindoryHermesRuntimeBridge` maps the local Hermes runtime contract fixture
  (`before_prompt`, `after_response`, `completed_turn`) onto adapter methods.
- Optional `memor_*` tools ensure identity before calling memory and document
  HTTP API paths.

The adapter does not import a Hermes SDK, does not run as a daemon and does not
access PostgreSQL, Redis, object storage or vector indexes directly.
