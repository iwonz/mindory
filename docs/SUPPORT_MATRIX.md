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
| Docker Compose local demo | Supported | `pnpm mvp:demo` is the local MVP demo path. |
| One-home installer layout | Supported baseline | `$MINDORY_HOME` config, logs, data, install and backups layout is implemented. |
| Remote release update | Future | Local asset update exists; remote release orchestration is later work. |
| Release artifact publishing | Future | Bundle generation exists; GitHub publishing automation is later work. |

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
| pgvector text embeddings | Supported | Requires a compatible 1536-dimensional embedding provider. |
| Qdrant | Future | Optional future vector backend. |

## Model Roles

All model operations must go through `@mindory/llm`.

| Role | Status | Notes |
| --- | --- | --- |
| Disabled model roles | Supported | Disabled attempts are handled and audited. |
| Text embeddings | Supported | OpenAI-compatible and local provider flows are the current target for indexed acceptance. |
| Chat | Experimental | SDK boundary exists; product flows do not require chat by default. |
| OCR | Experimental | Role and artifact flows exist; real scanned-PDF/image OCR support is still being hardened. |
| Vision captioning and image embeddings | Experimental | Deterministic fallbacks exist; real adapters are future hardening. |
| ASR | Experimental | Transcript artifact shape exists; real adapters are future hardening. |
| Face detection and recognition | Experimental | Workspace data model exists; real adapters are future hardening. |
| Image/audio generation | Future | Role placeholders exist for configuration planning only. |

## Security And Operations

| Area | Status | Notes |
| --- | --- | --- |
| Project-scoped bearer tokens | Supported | Token create/list/revoke/rotate APIs and CLI commands exist. |
| API rate limit guard | Supported baseline | In-process guard; distributed enforcement is future hardening. |
| Structured logs | Supported baseline | Metrics, tracing and alerting are future hardening. |
| Backup and restore | Manual baseline | Scripted backup/restore is future work. |
| Public vulnerability process | Supported baseline | Root `SECURITY.md` defines reporting expectations. |
