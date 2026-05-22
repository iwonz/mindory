# MVP Acceptance

`TASK-27` adds local acceptance paths. `TASK-35` adds a one-command Docker demo
wrapper around the live path. `TASK-51` extends the demo to cover multimodal
derived artifacts and model profiles. `TASK-86` adds the public self-host
acceptance gate that ties installer startup, runtime acceptance, backup and
uninstall together.

One-command live demo:

```bash
pnpm mvp:demo
```

This starts Docker Compose with the `clamav` profile, enables local multimodal
routing, waits for required service health/readiness, seeds demo credentials and
runs live acceptance.

Start and seed without live acceptance:

```bash
pnpm mvp:up
```

Stop the stack:

```bash
pnpm mvp:down
```

Reset containers and demo home data:

```bash
pnpm mvp:reset
```

Dry-run coverage check:

```bash
pnpm mvp:acceptance
```

Public self-host release-readiness gate:

```bash
pnpm selfhost:acceptance
```

The default self-host command dry-runs the public flow in a temporary
`MINDORY_HOME`: installer plan/prepare, backup dry-run, MVP scenario coverage
for uploads/jobs/search/context/CLI/MCP/Hermes and guarded uninstall. It does
not start Docker by default.

Opt-in live self-host flow:

```bash
MINDORY_SELFHOST_ACCEPTANCE_LIVE=true pnpm selfhost:acceptance
```

Live mode uses a temporary `MINDORY_HOME`, runs installer `start`, executes the
live MVP acceptance against the provisioned API token, creates a runtime backup,
stops the stack and runs guarded uninstall. To additionally prove the
deterministic local model profile and strict indexed search:

```bash
MINDORY_SELFHOST_ACCEPTANCE_LIVE=true MINDORY_SELFHOST_ACCEPTANCE_LOCAL=true pnpm selfhost:acceptance
```

Manual live Docker flow:

```bash
cp .env.example .env
docker compose --profile clamav up -d --build
pnpm mvp:seed
MINDORY_E2E_LIVE=true pnpm mvp:acceptance
```

The live script uses `MINDORY_E2E_API_URL` or `http://localhost:3000`,
`MINDORY_DEMO_PROJECT_ID` or `mindory-demo`, and `MINDORY_DEMO_TOKEN` or
`mindory-demo-token`.

The live scenario creates project, peer, session and message records, uploads
text, PDF, image, audio and video fixtures, waits for document processing to
reach `chunked` or `indexed`, verifies document search, artifact search and
metadata filters, requests document reprocess, checks job status details,
creates a source-backed memory, builds context, then checks CLI, MCP and Hermes
flows over the HTTP API. The default model profile is disabled and non-blocking;
deterministic fixture metadata is used instead of large local
model weights.

Optional model profiles:

```bash
pnpm mvp:demo --model-profile disabled
pnpm mvp:demo --model-profile local
pnpm mvp:demo --model-profile ollama
```

`local` starts the lightweight `local-models` deterministic HTTP model service
and configures 1536-dimensional local HTTP text embeddings. `ollama` starts the
Ollama profile; configure a 1536-dimensional embedding model before combining it
with strict indexed acceptance.

Strict indexed flow:

```bash
pnpm mvp:demo --model-profile local --require-indexed
MINDORY_E2E_LIVE=true MINDORY_E2E_REQUIRE_INDEXED=true pnpm mvp:acceptance
```

The first command is self-contained and uses the local deterministic model
service. Use the second command only after configuring a live embeddings provider
whose dimensions match the current pgvector MVP schema. Disabled embeddings
remain supported and should process documents to `chunked` in the default local
flow.

Docker is not available in every development environment. In those cases the
dry-run remains the repository check, and the live commands should be run where
Docker Compose can start Postgres, Redis, API, worker, MCP, ClamAV and optional
local model services.
