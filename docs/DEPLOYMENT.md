# Deployment

Mindory targets self-hosted Docker Compose deployment.

The expected flow is:

```bash
cp .env.example .env
docker compose --profile clamav up -d --build
pnpm mvp:seed
MINDORY_E2E_LIVE=true pnpm mvp:acceptance
```

`TASK-3` adds a base Compose scaffold. `TASK-26` replaces the API, MCP and
worker placeholders with a shared built Node image and real runtime commands.

The startup path is:

1. Build the root `Dockerfile`.
2. Start PostgreSQL and Redis.
3. Run the `migrate` service with `pnpm db:migrate`.
4. Start API with `node apps/api/dist/server.js`.
5. Start worker with `node apps/worker/dist/server.js`.
6. Start MCP stdio with `node apps/mcp/dist/stdio.js`.

The API healthcheck calls `/ready`. API and worker mount the `objects-data`
volume at `/data/mindory/objects` for the default local filesystem storage
provider.

On Apple Silicon, the `clamav/clamav:stable` image may need amd64 emulation.
The Compose profile uses `MINDORY_CLAMAV_PLATFORM=linux/amd64` by default for
that reason.

`pnpm mvp:seed` creates a deterministic demo project and bearer token directly
in PostgreSQL. This is intentionally a local demo path because token management
HTTP endpoints are not part of the MVP surface yet.

`pnpm mvp:acceptance` runs in dry-run mode by default and validates that the
scenario covers API, CLI, MCP, Hermes, document upload, job polling,
source-backed memory and context build. Set `MINDORY_E2E_LIVE=true` to execute
the live flow against `MINDORY_E2E_API_URL` or `http://localhost:3000`.

## Base Services

- `postgres`
- `redis`
- `migrate`
- `api`
- `mcp`
- `worker`

Postgres uses a pgvector-capable image and the initial migration enables the
`vector` extension for document chunk embeddings.

## Optional Profiles

- `minio`
- `clamav`
- `qdrant`
- `docling`
- `ollama`

Example:

```bash
docker compose --profile minio --profile clamav --profile qdrant up -d
```

`docling` is still a profile skeleton. Running Compose may require network
access to pull images and to install dependencies during the first Docker build
if the cache is cold.
