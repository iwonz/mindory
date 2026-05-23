# Repository Status

Mindory is a public-ready local MVP codebase, not a production SaaS platform.
The repository should be described with the support levels in
`docs/SUPPORT_MATRIX.md`.

## Current Baseline

The repository is complete through `TASK-132`.

Supported local MVP path:

- `pnpm check` passes from a clean checkout with dependencies installed.
- `pnpm public-ready:gate` dry-runs the final public pre-release checklist and
  is included in `pnpm check`; live mode runs the same gate from a fresh clone.
- `pnpm local-model:acceptance` runs a CI-safe dry-run of the supported local
  model profile and is included in `pnpm check`; live mode is explicit through
  `MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE=true`.
- `pnpm ui:validate` builds and validates the Web UI foundation;
  `pnpm ui:documents:validate` validates the document pipeline workspace;
  `pnpm ui:insights:validate` validates search/context/memory/faces;
  `pnpm ui:diagnostics:validate` validates runtime diagnostics; and
  `pnpm ui:docker:validate` validates Docker Compose and installer integration.
  `pnpm ui:e2e` validates the Web UI Playwright acceptance coverage in dry-run
  mode. All are included in `pnpm check`.
- `pnpm test` runs integration tests with PostgreSQL and Redis.
- `pnpm mvp:demo` starts the local Docker Compose demo and runs live acceptance.
- `pnpm selfhost:gate` runs the live release-readiness matrix for sync ClamAV,
  pgvector with Docling, Qdrant with deterministic local embeddings, live MVP
  acceptance, backup, restore smoke, signed remote update, reset and uninstall
  in temporary homes. `pnpm selfhost:gate -- --dry-run` runs the non-Docker
  rehearsal path used by `pnpm check`.
- The installer can plan, prepare, start through health checks, provision the
  first project/token, update local assets, create runtime backups, restore
  runtime backups and uninstall with confirmation.
- Installer local model auto-install can select supported catalog runners,
  preflight resource needs, start the required Compose profiles, pull/verify
  Ollama models, log diagnostics and stop safely before migrations on failure.
- Release-style bundles can be generated with `pnpm release:bundle`; generated
  manifests are RSA-SHA256 signed and bootstrap scripts verify signatures
  before trusting bundle checksums.
- Release validation can be run locally with `pnpm release:validate`.
- Tag release publishing builds and pushes versioned GHCR images, generates
  release notes with support matrix and upgrade notes, and attaches signed
  release artifacts to public GitHub pre-releases.
- Signed remote installer update can download/copy release manifests and
  bundles, verify signatures/checksums, stage releases, run migrations/startup
  health checks and rollback release/config assets on failure.
- Installer recovery includes run-state backed `resume` for interrupted
  file generation, Compose startup, migrations, health checks and first-run
  provisioning, plus `repair` for confirmed stale locks and interrupted
  rollback continuation inside `$MINDORY_HOME`.
- LLM role/provider support levels are centralized and enforced by config and
  installer validation.
- Local model runner metadata is centralized in `LOCAL_MODEL_RUNNER_CATALOG`
  with source/image, model file, license/status, port, healthcheck and resource
  hints documented in `docs/LOCAL_MODELS.md`.
- Supported local model Compose profiles are resolved from the catalog, use
  healthchecks and persist model state under `$MINDORY_HOME/data/models` and
  `$MINDORY_HOME/data/ollama`.
- OpenAI-compatible chat and text embedding operations support API-key and
  OAuth bearer auth through `@mindory/llm`.
- Local HTTP chat/text embedding adapters and provider health checks for local
  HTTP and Ollama services are implemented through `@mindory/llm`.
- `pnpm mvp:demo --model-profile local --require-indexed` can exercise the
  indexed pgvector path with a deterministic local HTTP embeddings service.
- `MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE=true pnpm local-model:acceptance`
  verifies deterministic local OCR, ASR, vision, image embedding, video
  keyframe, face, source-ref, job, unified search and model-operation metric
  coverage in a temporary Docker home.
- Scanned-PDF OCR can run through `@mindory/llm` local HTTP OCR when the
  experimental OCR role is enabled.
- Image OCR and vision captioning can run through `@mindory/llm` local HTTP
  providers when the experimental OCR and vision-captioning roles are enabled;
  their derived captions, labels and OCR text are searchable.
- Audio ASR can run through `@mindory/llm` local HTTP when the experimental ASR
  role is enabled; derived transcript segments keep time refs for search.
- Video keyframe extraction supports the manifest fallback and an opt-in
  local-command provider. Extracted frame bytes can run through configured OCR
  and vision providers before searchable frame artifacts are written.
- Face detection and recognition can run through `@mindory/llm` local HTTP when
  experimental face roles are enabled. Provider boxes and embeddings are stored
  as workspace-scoped face observations and auto-matched through `FaceService`.
- Unified multimodal search is available through `POST /v1/search`, CLI
  `mindory search query` and MCP `unified_search`, combining document chunks,
  artifact spans and face observations with source refs.
- Web UI is available as `@mindory/ui`: token/API URL entry, API health,
  project/session navigation, session message inspection, document upload,
  document list/detail, pipeline job progress, retry/reprocess controls and
  artifact source refs, unified search, context preview, manual memory
  creation, source-backed memory display and face identity list/rename/merge
  plus runtime diagnostics for storage/vector/AV/model settings, provider
  health, recent job status, metrics links and redacted installer/config summary
  through HTTP API calls only. Docker Compose and installer deployments include
  the `ui` service, host port wiring and `/api` proxy routing through
  `MINDORY_UI_API_URL`; this Docker/installer wiring was completed in
  `TASK-130`. Playwright acceptance covers login/token, upload, jobs,
  artifacts/source refs, unified search, manual memory, context preview and
  desktop/mobile layout in live mode.
- LibreFS and MinIO local S3-compatible profiles include health-gated bucket
  bootstrap, and installer startup validates signed access for external
  S3-compatible buckets.
- Hermes integration includes runtime hook registration for Hermes-like hosts,
  a runnable example host and conformance harnesses covering
  context-before-prompt, attachment upload, saved turns and later-session
  recall.
- Observability baseline includes structured log helpers, model operation audit
  querying, Prometheus metrics exporters, OpenTelemetry OTLP trace/log export,
  in-process job/stage metrics, health snapshots and documented in-process
  rate-limit strategy.
- Backup/restore MVP includes installer CLI commands for config, installer
  metadata, PostgreSQL dumps, local object-storage state and scheduled local
  backup runs with retention, logs and health status.
- Local Compose PostgreSQL PITR includes WAL archiving under
  `$MINDORY_HOME/backups/postgres-wal`, base backups with `pitr-manifest.json`
  and target-time restore staging.
- Encrypted remote backups include `.mindorybak` archive generation, AES-GCM
  encryption, SHA-256 verification, S3-compatible upload/download integrity
  checks and decrypted restore staging under `$MINDORY_HOME/backups/decrypted`.
- External S3 object storage backups include paginated bucket inventory,
  `.mindorys3bak` streaming archive generation, progress events, encrypted
  object chunk storage and restore into an S3-compatible bucket with integrity
  validation.
- Public self-host acceptance is the release-readiness gate for local self-host
  users and is required by `docs/RELEASE_CHECKLIST.md` before publication.
- Final public-ready gate combines fresh clone, published-release bootstrap,
  self-host live matrix, local-model live acceptance, Web UI Playwright flow,
  CLI/MCP smoke coverage through self-host acceptance, public stale wording
  validation and clean `git status --short`.
- Public current-state docs are aligned with the TASK-132 runtime baseline and
  distinguish checked local-MVP paths from planned release work.

Public GitHub hygiene baseline:

- Apache-2.0 license.
- Contribution guide.
- Root security policy.
- Issue and pull request templates.
- Changelog and release notes policy.
- Support matrix.
- Release workflow for checks, Docker image build/publish on tags, signed
  bundle manifests, checksum publication, release notes generation and
  packaged installer smoke.

## Known Limits

- Alerting policy is not bundled; route Prometheus and OTLP exports to the
  monitoring stack used by the deployment.
- Heavy multimodal model adapters are still experimental unless a role is
  explicitly documented as supported in `docs/SUPPORT_MATRIX.md` or a local
  model profile is checked by live acceptance.

## Public Claims Rule

When updating README, docs, issues or release notes:

- say `supported` only for paths covered by current checks or acceptance;
- say `experimental` for provider/profile/model flows that require additional
  local resources or credentials;
- use the support-matrix status terms for intentionally limited or planned
  surfaces, and keep those claims separate from supported runtime paths.
