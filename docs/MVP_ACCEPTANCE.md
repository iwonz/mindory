# MVP Acceptance

`TASK-27` adds local acceptance paths. `TASK-35` adds a one-command Docker demo
wrapper around the live path.

One-command live demo:

```bash
pnpm mvp:demo
```

This starts Docker Compose with the `clamav` profile, waits for required service
health/readiness, seeds demo credentials and runs live acceptance.

Start and seed without live acceptance:

```bash
pnpm mvp:up
```

Stop the stack:

```bash
pnpm mvp:down
```

Reset containers and demo volumes:

```bash
pnpm mvp:reset
```

Dry-run coverage check:

```bash
pnpm mvp:acceptance
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
`fixtures/demo/mindory-demo.txt`, waits for document processing to reach
`chunked` or `indexed`, verifies document search returns source-backed chunk
hits, creates a source-backed memory, builds context, then checks CLI, MCP and
Hermes flows over the HTTP API.

Strict indexed flow:

```bash
MINDORY_E2E_LIVE=true MINDORY_E2E_REQUIRE_INDEXED=true pnpm mvp:acceptance
```

Use strict mode only after configuring an embeddings provider whose dimensions
match the current pgvector MVP schema. Disabled embeddings remain supported and
should process documents to `chunked` in the default local flow.

Docker is not available in every development environment. In those cases the
dry-run remains the repository check, and the live command should be run where
Docker Compose can start Postgres, Redis, API, worker, MCP and ClamAV.
