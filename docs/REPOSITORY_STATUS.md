# Repository Status

Mindory is a public-ready local MVP codebase, not a production SaaS platform.
The repository should be described with the support levels in
`docs/SUPPORT_MATRIX.md`.

## Current Baseline

The repository is complete through `TASK-75`.

Supported local MVP path:

- `pnpm check` passes from a clean checkout with dependencies installed.
- `pnpm test` runs integration tests with PostgreSQL and Redis.
- `pnpm mvp:demo` starts the local Docker Compose demo and runs live acceptance.
- The installer can plan, prepare, start through health checks, provision the
  first project/token, update local assets and uninstall with confirmation.
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
- Scripted backup/restore is future work.
- Real Hermes SDK/runtime verification is future work.
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
