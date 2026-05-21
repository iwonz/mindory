# MVP Acceptance

`TASK-27` adds two local acceptance paths.

Dry-run coverage check:

```bash
pnpm mvp:acceptance
```

Live Docker flow:

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
`chunked` or `indexed`, creates a source-backed memory, builds context, then
checks CLI, MCP and Hermes flows over the HTTP API.

Docker is not available in every development environment. In those cases the
dry-run remains the repository check, and the live command should be run where
Docker Compose can start Postgres, Redis, API, worker, MCP and ClamAV.
