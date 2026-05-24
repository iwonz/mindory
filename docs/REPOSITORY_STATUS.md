# Repository Status

Mindory is a public-ready local MVP codebase, not a production SaaS platform.
The repository should be described with the support levels in
`docs/SUPPORT_MATRIX.md`.

## Current Baseline

The repository is complete through `TASK-141`.

Release baseline:

- `v0.1.0` is a historical pre-release and is stale relative to the current
  `master` baseline.
- `v0.1.1` is the fresh target pre-release for `TASK-133` through `TASK-147`.
- The `v0.1.1` target promotes OCR, ASR, vision captioning, object detection,
  image embeddings, face detection/recognition, image generation, audio
  generation, local-command runners and local-http runners into checked
  supported local/install/runtime paths. `TASK-133` registered this contract;
  `TASK-134` promoted the central role/provider support matrix,
  `TASK-135` added the supported Tesseract OCR runner, `TASK-136` added
  the supported Faster Whisper ASR runner, `TASK-137` added the supported
  image semantics runner, `TASK-138` added the supported local face runner and
  `TASK-139` added supported image/audio generation provider validation plus
  valid deterministic PNG/WAV generation smoke paths. `TASK-140` added the
  installer supported multimodal preset with resource confirmation, answer-file
  fields and generated local-model role config. `TASK-141` upgraded the full
  local-model live acceptance gate across deterministic MVP processing and the
  focused OCR, ASR, image semantics and face runner gates. `TASK-142` through
  `TASK-147` execute and verify the remaining documentation, release and final
  public-ready work one task at a time.

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
- Installer local model setup supports the `supported-multimodal` preset,
  resource confirmation, generated `@mindory/llm` local role config, redacted
  runner resource summaries and custom supported catalog runner selection. It
  preflights resource needs, starts the required Compose profiles, pull/verifies
  Ollama models, health-checks the Tesseract OCR, Faster Whisper ASR, image
  semantics and local face runners, logs diagnostics and stops safely before
  migrations on failure.
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
- The supported Tesseract runner uses the `local-models-ocr` profile and
  `MINDORY_LLM_OCR_LOCAL_HTTP_BASE_URL` for PDF/image OCR through `@mindory/llm`.
- The supported Faster Whisper runner uses the `local-models-asr` profile and
  `MINDORY_LLM_ASR_LOCAL_HTTP_BASE_URL` for audio ASR through `@mindory/llm`.
- The supported image semantics runner uses the `local-models-vision` profile,
  `MINDORY_LLM_IMAGE_EMBEDDING_LOCAL_HTTP_BASE_URL` and
  `MINDORY_LLM_VISION_CAPTIONING_LOCAL_HTTP_BASE_URL` for image vectors,
  captions and object observations through `@mindory/llm`.
- The supported local face runner uses the `local-models-face` profile,
  `MINDORY_LLM_FACE_DETECTION_LOCAL_HTTP_BASE_URL` and
  `MINDORY_LLM_FACE_RECOGNITION_LOCAL_HTTP_BASE_URL` for face boxes,
  embeddings and deterministic recognition ids through `@mindory/llm`.
- OpenAI-compatible chat, text embedding, image generation and audio generation
  operations support API-key and OAuth bearer auth through `@mindory/llm`.
- Local HTTP chat/text embedding/image embedding/OCR/vision/ASR/face/generation
  adapters, local-command adapters and provider health checks for local HTTP,
  local-command and Ollama services are implemented through `@mindory/llm`.
- Image/audio generation provider results validate MIME families, non-empty
  bytes, audit usage and CLI smoke output; the deterministic local HTTP runner
  returns valid PNG and WAV fixtures for local/self-host checks.
- `pnpm mvp:demo --model-profile local --require-indexed` can exercise the
  indexed pgvector path with a deterministic local HTTP embeddings service.
- `MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE=true pnpm local-model:acceptance`
  runs the full supported multimodal live gate: deterministic local MVP
  processing, image/audio generation smoke, worker model-operation metrics and
  the focused Tesseract OCR, Faster Whisper ASR, image semantics and local face
  runner gates in temporary Docker homes.
- Scanned-PDF OCR can run through `@mindory/llm` local HTTP or local-command
  OCR when the supported OCR role is enabled.
- Image OCR, vision captioning, object detection and image embeddings can run
  through `@mindory/llm` local HTTP or local-command providers when the
  supported OCR, vision-captioning and image-embedding roles are enabled; their
  derived captions, labels, object observations, vectors and OCR text are
  searchable.
- Audio ASR can run through `@mindory/llm` local HTTP or local-command when the
  supported ASR role is enabled; derived transcript segments keep time refs for
  search.
- Video keyframe extraction supports the manifest fallback and an opt-in
  local-command provider. Extracted frame bytes can run through configured OCR
  and vision providers before searchable frame artifacts are written.
- Face detection and recognition can run through `@mindory/llm` local HTTP or
  local-command when supported face roles are enabled. Provider boxes and
  embeddings are stored as workspace-scoped face observations and auto-matched
  through `FaceService`.
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
- Public current-state docs are aligned with the TASK-138 runtime baseline and
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
- Generation runner images remain runner-specific work for the v0.1.1 task
  series; provider and role support levels are defined in
  `docs/SUPPORT_MATRIX.md`.

## Public Claims Rule

When updating README, docs, issues or release notes:

- say `supported` only for paths covered by current checks or acceptance;
- say `experimental` for provider/profile/model flows that require additional
  local resources or credentials;
- use the support-matrix status terms for intentionally limited or planned
  surfaces, and keep those claims separate from supported runtime paths.
