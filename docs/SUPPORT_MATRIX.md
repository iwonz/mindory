# Support Matrix

This matrix defines public wording for Mindory capabilities. Use it when
writing README, issues, release notes and docs.

## Status Terms

| Term | Meaning |
| --- | --- |
| Supported | Expected to work in the documented local MVP path and covered by `pnpm check` or live acceptance. |
| Experimental | Available for testing, but may need extra configuration, local resources or provider credentials. |
| Placeholder | Intentional stub, scaffold or dependency-free test surface. Not a supported product feature. |
| Future | Planned or architecturally allowed, but not implemented. |

## Runtime And Deployment

| Area | Status | Notes |
| --- | --- | --- |
| Node.js | Supported | Node.js 22 or newer. CI currently uses Node.js 24. |
| Package manager | Supported | pnpm 10 with committed lockfile. |
| Linux/macOS source development | Supported | Primary contributor path. |
| Windows source development | Experimental | PowerShell bootstrap exists; full native matrix is dry-run validated. |
| Docker Compose local demo | Supported | `pnpm mvp:demo` is the local MVP demo path; `--model-profile local --require-indexed` proves indexed pgvector search with deterministic local embeddings. |
| One-home installer layout | Supported baseline | `$MINDORY_HOME` config, logs, data, install and backups layout is implemented. |
| Remote release update | Future | Local asset update exists; remote release orchestration is later work. |
| Release artifact publishing | Supported baseline | Release workflow generates bundle, manifest and checksum artifacts; tag builds upload them to a draft GitHub Release. |

## Product Surfaces

| Area | Status | Notes |
| --- | --- | --- |
| HTTP API | Supported local MVP | Project-scoped bearer-token runtime with routes for core memory, documents, jobs and search. |
| Worker document pipeline | Supported local MVP | Scan, route, extract, chunk, embed/index and status transitions are wired. |
| CLI | Supported local MVP | Calls HTTP API; no direct database access. |
| MCP stdio | Supported local MVP | Tools call HTTP API; Compose service is a packaging smoke artifact. |
| Hermes adapter | Experimental | Lifecycle surface is implemented; real Hermes SDK/runtime verification is future work. |
| Web UI | Future | Not part of the MVP. |

## Storage And Search

| Area | Status | Notes |
| --- | --- | --- |
| Local filesystem object storage | Supported | Default local MVP storage under `$MINDORY_HOME/data/objects`. |
| S3-compatible storage | Supported baseline | Adapter and smoke tests exist for LibreFS/MinIO/external S3-compatible endpoints. |
| LibreFS Compose profile | Experimental | Profile exists; operationalized installer bootstrap remains future hardening. |
| PostgreSQL full-text search | Supported | Used for fallback document search when embeddings are disabled. |
| Unified multimodal search | Supported local MVP | `POST /v1/search`, CLI `search query` and MCP `unified_search` combine document chunks, OCR/caption/transcript/keyframe artifact spans and face observations with metadata filters and source refs. |
| pgvector text embeddings | Supported | Requires a compatible 1536-dimensional embedding provider. |
| Qdrant | Future | Optional future vector backend. |

## Document Modalities

| Area | Status | Notes |
| --- | --- | --- |
| Video keyframes | Supported manifest fallback; experimental local-command provider | Local-command extraction is opt-in, validates a command path, respects the configured max frame count and can run extracted frame bytes through OCR/vision roles. Bundled ffmpeg profiles remain future work. |

## Model Roles

All model operations must go through `@mindory/llm`.

| Role | Status | Notes |
| --- | --- | --- |
| Disabled model roles | Supported | Disabled attempts are handled and audited. |
| Text embeddings | Supported | OpenAI-compatible, Ollama and local HTTP provider flows are implemented through `@mindory/llm`; pgvector requires 1536-dimensional vectors. |
| Chat | Supported SDK adapter | OpenAI-compatible API-key/OAuth modes and local HTTP chat are implemented in `@mindory/llm`; product flows do not require chat by default. |
| OCR | Experimental role, supported PDF/image paths | Scanned-PDF and image OCR run through `@mindory/llm` local HTTP OCR when enabled. |
| Vision captioning and image embeddings | Experimental | Image vision captioning runs through `@mindory/llm` local HTTP when enabled; image embeddings remain future hardening. |
| ASR | Experimental | Audio ASR runs through `@mindory/llm` local HTTP when enabled; embedded WAV transcript fallback remains supported. |
| Face detection and recognition | Experimental | Local HTTP face detection/recognition runs through `@mindory/llm` when enabled; observations remain workspace-scoped and auto-matched by threshold. |
| Image/audio generation | Future | Role placeholders exist for configuration planning only. |

Installer and config validation require
`MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true` before enabling experimental or future
model roles, or before selecting a non-supported provider for a supported role.

## Security And Operations

| Area | Status | Notes |
| --- | --- | --- |
| Project-scoped bearer tokens | Supported | Token create/list/revoke/rotate APIs and CLI commands exist. |
| API rate limit guard | Supported baseline | In-process guard; distributed enforcement is future hardening. |
| Structured logs | Supported baseline | Metrics, tracing and alerting are future hardening. |
| Backup and restore | Manual baseline | Scripted backup/restore is future work. |
| Public vulnerability process | Supported baseline | Root `SECURITY.md` defines reporting expectations. |
