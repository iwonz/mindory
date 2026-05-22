# Repository Status

Mindory is a public-ready local MVP codebase, not a production SaaS platform.
The repository should be described with the support levels in
`docs/SUPPORT_MATRIX.md`.

## Current Baseline

The repository is complete through `TASK-86`.

Supported local MVP path:

- `pnpm check` passes from a clean checkout with dependencies installed.
- `pnpm test` runs integration tests with PostgreSQL and Redis.
- `pnpm mvp:demo` starts the local Docker Compose demo and runs live acceptance.
- `pnpm selfhost:acceptance` runs the public self-host dry-run gate; setting
  `MINDORY_SELFHOST_ACCEPTANCE_LIVE=true` runs installer start, MVP acceptance,
  backup, reset and uninstall in a temporary home.
- The installer can plan, prepare, start through health checks, provision the
  first project/token, update local assets, create runtime backups, restore
  runtime backups and uninstall with confirmation.
- Release-style bundles can be generated with `pnpm release:bundle`.
- Release validation can be run locally with `pnpm release:validate`.
- LLM role/provider support levels are centralized and enforced by config and
  installer validation.
- OpenAI-compatible chat and text embedding operations support API-key and
  OAuth bearer auth through `@mindory/llm`.
- Local HTTP chat/text embedding adapters and provider health checks for local
  HTTP and Ollama services are implemented through `@mindory/llm`.
- `pnpm mvp:demo --model-profile local --require-indexed` can exercise the
  indexed pgvector path with a deterministic local HTTP embeddings service.
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
- LibreFS and MinIO local S3-compatible profiles include health-gated bucket
  bootstrap, and installer startup validates signed access for external
  S3-compatible buckets.
- Hermes integration includes runtime hook registration for Hermes-like hosts
  plus a fake-compatible harness covering context-before-prompt, attachment
  upload, saved turns and later-session recall.
- Observability baseline includes structured log helpers, model operation audit
  querying, in-process job/stage metrics, health snapshots and documented
  in-process rate-limit strategy.
- Backup/restore MVP includes installer CLI commands for config, installer
  metadata, PostgreSQL dumps and local object-storage state.
- Public self-host acceptance is documented as the release-readiness gate for
  local self-host users.

Public GitHub hygiene baseline:

- Apache-2.0 license.
- Contribution guide.
- Root security policy.
- Issue and pull request templates.
- Changelog and release notes policy.
- Support matrix.
- Release workflow for checks, Docker image build, bundle artifacts, checksum
  publication and packaged installer smoke.

## Known Limits

- Signed release manifests are future work.
- Registry push policy for Docker images is future hardening.
- Full automated installer resume is future work.
- Point-in-time recovery, scheduled backups, encrypted remote backups and
  external S3 bucket streaming backups are future work.
- Prometheus/OpenTelemetry exporters, log aggregation and alerting are future
  observability hardening work.
- Official Hermes SDK certification is future work; the current supported path
  is the fake-compatible runtime harness.
- Heavy multimodal model adapters are still experimental unless a role is
  explicitly documented as supported in `docs/SUPPORT_MATRIX.md`.
- A web UI is not part of the MVP.

## Public Claims Rule

When updating README, docs, issues or release notes:

- say `supported` only for paths covered by current checks or acceptance;
- say `experimental` for provider/profile/model flows that require additional
  local resources or credentials;
- say `placeholder` for intentional stubs or smoke-only surfaces;
- say `future` for planned work that is not implemented.
