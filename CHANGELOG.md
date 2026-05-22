# Changelog

Mindory uses task-scoped changes. Each public release note should reference the
task ids that materially changed behavior, operations, configuration or public
documentation.

## Release Notes Policy

- Keep an `Unreleased` section until a version is tagged.
- Group changes as `Added`, `Changed`, `Fixed`, `Security`, `Deprecated` or
  `Removed`.
- Mention breaking configuration, schema, installer and deployment changes
  explicitly.
- Do not claim unsupported, placeholder or future functionality as supported.
- Include verification context for release candidates, especially `pnpm check`
  and relevant installer or live acceptance commands.
- Never include secrets, token values, private URLs or customer data.

## Unreleased

### Added

- `TASK-111`: Hermes host integration package with runnable example host,
  lifecycle hook registration and conformance coverage for attachments, turns
  and later-session recall.
- `TASK-110`: installer resume and repair execution backed by journal/run-state
  recovery, stale-lock cleanup and interrupted rollback continuation.
- `TASK-109`: signed remote installer update with release download/staging,
  manifest and checksum verification, pre-update backups, migration/startup
  health checks and rollback.
- `TASK-108`: hardened release publishing workflow with tag-only GHCR image
  pushes, generated release notes, signed artifact uploads and a public release
  checklist.
- `TASK-107`: signed release manifests with bootstrap signature verification
  before checksum trust and tampered manifest/artifact validation.
- `TASK-86`: public self-host acceptance gate for installer, runtime,
  backup/restore, CLI, MCP, Hermes and uninstall flows.
- `TASK-85`: installer runtime backup/restore commands for config, installer
  metadata, PostgreSQL dumps and local object storage state.
- `TASK-84`: observability baseline with structured log helpers, model audit
  queries, in-process job/stage metrics, health snapshots and rate-limit docs.
- `TASK-83`: Hermes-like runtime hook registration plus fake-compatible harness
  for context-before-prompt, attachment upload, saved turns and later recall.
- `TASK-82`: LibreFS/MinIO local S3 bucket bootstrap and signed external
  S3-compatible access checks in storage and installer startup flows.
- `TASK-81`: unified multimodal search through `POST /v1/search`, CLI
  `search query` and MCP `unified_search`, including metadata-only artifact
  search and face observation hits with source refs.
- `TASK-80`: local HTTP face detection and recognition through `@mindory/llm`,
  with provider-backed face observations and workspace auto-match.
- `TASK-79`: opt-in local-command video keyframe extraction, with capped frame
  artifacts and OCR/vision enrichment for extracted frame bytes.
- `TASK-78`: audio ASR through `@mindory/llm` local HTTP, with searchable
  derived transcript segments and time refs.
- `TASK-77`: image OCR and vision captioning through `@mindory/llm` local HTTP,
  with searchable derived OCR text, captions and labels.
- `TASK-76`: scanned-PDF OCR pipeline through `@mindory/llm` local HTTP OCR,
  with OCR page artifacts, `ocr_text` spans and integration coverage.
- `TASK-75`: self-contained local strict indexed acceptance with deterministic
  local HTTP embeddings for the `local-models` profile.
- `TASK-74`: local HTTP chat/text embedding adapters in `@mindory/llm`, plus
  provider health checks for local HTTP and Ollama services.
- `TASK-73`: OpenAI-compatible chat adapter in `@mindory/llm`, sharing API-key
  and OAuth bearer auth with embeddings plus operation audit output.
- `TASK-72`: centralized LLM role/provider support matrix with config and
  installer gating for experimental model roles.
- `TASK-71`: release workflow baseline with `pnpm check`, Docker image build,
  release bundle/checksum artifacts and packaged installer smoke validation.
- `TASK-70`: public repository hygiene baseline, including license,
  contribution guide, security policy, issue and pull request templates, support
  matrix and repository status documentation.

### Changed

- `TASK-69`: release-style bundle generation and bootstrap checksum/staging
  path are documented and validated.
