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
