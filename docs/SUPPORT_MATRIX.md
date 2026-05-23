# Support Matrix

This matrix defines public wording for Mindory capabilities. Use it when
writing README, issues, release notes and docs.

## Status Terms

| Term | Meaning |
| --- | --- |
| Supported | Expected to work in the documented local MVP path and covered by `pnpm check` or live acceptance. |
| Experimental | Available for testing, but may need extra configuration, local resources or provider credentials. |
| Future | Planned or architecturally allowed, but not implemented. |

## Runtime And Deployment

| Area | Status | Notes |
| --- | --- | --- |
| Node.js | Supported | Node.js 22 or newer. CI currently uses Node.js 24. |
| Package manager | Supported | pnpm 10 with committed lockfile. |
| Linux/macOS source development | Supported | Primary contributor path. |
| Windows source development | Experimental | PowerShell bootstrap exists; full native matrix is dry-run validated. |
| Docker Compose local demo | Supported | `pnpm mvp:demo` is the local MVP demo path; `--model-profile local --require-indexed` proves indexed pgvector search with deterministic local embeddings. |
| Public self-host acceptance | Supported gate | `pnpm selfhost:gate` runs the live Docker self-host gate with sync ClamAV, pgvector with Docling, Qdrant with deterministic local embeddings, MVP acceptance, backup, restore smoke, signed remote update, reset and uninstall in temporary homes. `pnpm selfhost:gate -- --dry-run` runs the non-Docker rehearsal path. |
| One-home installer layout | Supported baseline | `$MINDORY_HOME` config, logs, data, install and backups layout is implemented. |
| Installer resume and repair | Supported baseline | `mindory-installer resume` continues recoverable interrupted runs from journal/run-state; `repair` clears confirmed stale locks and continues interrupted rollback inside `$MINDORY_HOME`. |
| Backup and restore | Supported MVP | `mindory-installer backup`, `backup-schedule`, `pitr-backup`, `pitr-restore`, `backup-archive`, `backup-upload`, `backup-download`, `backup-restore-archive`, `s3-inventory`, `s3-backup`, `s3-restore` and `restore` cover config, installer metadata, PostgreSQL dumps, local object storage state, scheduled retention/health, local Compose PostgreSQL PITR, encrypted S3-compatible remote backup archives and external S3 object inventory/streaming backup/restore. |
| Remote release update | Supported baseline | Installer `update --manifest-url` and `update --manifest-path` verify signed manifests and bundle checksums, create pre-update backups, stage release assets, run migrations/startup/health checks and rollback release/config assets on failure. |
| Release artifact publishing | Supported baseline | Release workflow generates bundle, signed manifest, public key sidecar, checksum and release notes artifacts; trusted tag builds push versioned Docker images and publish artifacts to a public GitHub pre-release. Draft releases are manual staging only. |

## Product Surfaces

| Area | Status | Notes |
| --- | --- | --- |
| HTTP API | Supported local MVP | Project-scoped bearer-token runtime with routes for core memory, documents, jobs and search. |
| Worker document pipeline | Supported local MVP | Scan, route, extract, chunk, embed/index and status transitions are wired. |
| CLI | Supported local MVP | Calls HTTP API; no direct database access. |
| MCP stdio | Supported local MVP | Tools call HTTP API; Compose service is a packaging smoke artifact. |
| Hermes adapter | Supported baseline | Lifecycle helpers, HTTP client, optional tools, runnable example host and conformance harnesses are covered by `pnpm check`; no external Hermes SDK code is vendored. |
| Web UI | Future | Planned public-ready MVP surface. It is not implemented in the current baseline; HTTP API, CLI and MCP are the supported surfaces until the UI task series lands. |

## Storage And Search

| Area | Status | Notes |
| --- | --- | --- |
| Local filesystem object storage | Supported | Default local MVP storage under `$MINDORY_HOME/data/objects`. |
| S3-compatible storage | Supported baseline | Adapter, signed bucket access checks and smoke tests exist for LibreFS/MinIO/external S3-compatible endpoints. |
| LibreFS Compose profile | Supported baseline | Local S3-compatible profile has a health check and bucket bootstrap service for installer startup. |
| PostgreSQL full-text search | Supported | Used for fallback document search when embeddings are disabled. |
| Unified multimodal search | Supported local MVP | `POST /v1/search`, CLI `search query` and MCP `unified_search` combine document chunks, OCR/caption/transcript/keyframe artifact spans and face observations with metadata filters and source refs. |
| pgvector text embeddings | Supported | Requires a compatible 1536-dimensional embedding provider. |
| Qdrant vector backend | Supported runtime option | `MINDORY_VECTOR_PROVIDER=qdrant` uses `@mindory/vector-qdrant` for worker indexing and API document search with project-scoped source refs. |

## Document Modalities

| Area | Status | Notes |
| --- | --- | --- |
| Video keyframes | Supported manifest fallback and bundled ffmpeg provider; experimental local-command provider | The ffmpeg provider extracts frame PNGs through the bundled runtime image, enforces the configured max frame count and can run frame bytes through OCR/vision roles. Local-command extraction is opt-in and validates a command path for custom deployments. |

## Model Roles

All model operations must go through `@mindory/llm`.

| Role | Status | Notes |
| --- | --- | --- |
| Disabled model roles | Supported | Disabled attempts are handled and audited. |
| Text embeddings | Supported | OpenAI-compatible, Ollama, local HTTP and local-command provider flows are implemented through `@mindory/llm`; pgvector requires 1536-dimensional vectors. |
| Chat | Supported SDK adapter | OpenAI-compatible API-key/OAuth modes plus local HTTP and local-command chat are implemented in `@mindory/llm`; product flows do not require chat by default. |
| Local-command provider | Supported/experimental by role | `@mindory/llm` and installer execute configured healthchecks, and runtime operations cover chat, text/image embeddings, OCR, ASR, vision, face detection/recognition, image generation and audio generation through stdin/stdout JSON. |
| OCR | Experimental role, supported PDF/image paths | Scanned-PDF and image OCR run through `@mindory/llm` local HTTP or local-command OCR when enabled. |
| Vision captioning, object detection and image embeddings | Experimental | Image vision captioning, object detection and image embeddings run through `@mindory/llm` local HTTP or local-command when enabled; image vectors are indexed through the selected vector backend. |
| ASR | Experimental | Audio ASR runs through `@mindory/llm` local HTTP or local-command when enabled; embedded WAV transcript fallback remains supported. |
| Face detection and recognition | Experimental | Local HTTP and local-command face detection/recognition run through `@mindory/llm` when enabled; observations remain workspace-scoped and auto-matched by threshold. |
| Image/audio generation | Experimental SDK role | OpenAI-compatible, local HTTP and local-command image/audio generation return typed bytes, MIME metadata and model-operation audit records through `@mindory/llm`; CLI `llm generate-image` and `llm generate-audio` provide smoke diagnostics. |

Installer and config validation require
`MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true` before enabling experimental or future
model roles, or before selecting a non-supported provider for a supported role.

## Security And Operations

| Area | Status | Notes |
| --- | --- | --- |
| Project-scoped bearer tokens | Supported | Token create/list/revoke/rotate APIs and CLI commands exist. |
| API rate limit guard | Supported baseline | In-process guard; distributed enforcement is future hardening. |
| Observability baseline | Supported baseline | Structured logs, model operation audit helpers, Prometheus API/worker metrics exporters, OpenTelemetry OTLP tracing/log export, in-process job/stage metrics, health snapshots and rate-limit strategy are documented. |
| Backup and restore | Supported MVP | Installer CLI creates `backup-manifest.json`, PostgreSQL dumps and local object-storage copies; scheduled local backups add lock, retention, logs and health; PITR commands create `pitr-manifest.json`, base backups, WAL archive refs and target-time restore staging; encrypted remote backup commands create `.mindorybak` archives and verify S3-compatible upload/download integrity; external S3 commands page bucket inventory and create `.mindorys3bak` streaming archives for object restore. |
| Public vulnerability process | Supported baseline | Root `SECURITY.md` defines reporting expectations. |
