# Deployment

Mindory targets self-hosted Docker Compose deployment.

Production hardening expectations for CI, release images, backups, rollback,
secrets, rate limits and structured logs are maintained in
`docs/PRODUCTION_HARDENING.md`.

The expected local demo flow is:

```bash
pnpm mvp:demo
```

`pnpm mvp:demo` starts Docker Compose with the `clamav` profile, waits for
Postgres, Redis, migration completion, API, worker and MCP service readiness,
seeds demo credentials from inside the Compose network, then runs live MVP
acceptance.

Use `pnpm mvp:up` to start and seed without live acceptance, `pnpm mvp:down` to
stop the stack and `pnpm mvp:reset` to remove containers and demo volumes.

`TASK-3` adds a base Compose scaffold. `TASK-26` replaces the API, MCP and
worker placeholders with a shared built Node image and real runtime commands.

The startup path is:

1. Build the root `Dockerfile`.
2. Start PostgreSQL and Redis.
3. Run the `migrate` service with `pnpm db:migrate`.
4. Start API with `node apps/api/dist/server.js`.
5. Start worker with `node apps/worker/dist/server.js`.
6. Optionally start the MCP stdio command with `node apps/mcp/dist/stdio.js`
   as a process smoke check.

The API healthcheck calls `/ready`. API and worker mount the `objects-data`
volume at `/data/mindory/objects` for the default local filesystem storage
provider.

MCP stdio is normally launched by an MCP client, not exposed as a Compose
network service. The Compose `mcp` service is a packaging artifact that proves
the command starts inside the image; real clients should use the examples in
`docs/MCP.md` and point `MINDORY_MCP_API_URL` at a reachable API URL.

On Apple Silicon, the `clamav/clamav:stable` image may need amd64 emulation.
The Compose profile uses `MINDORY_CLAMAV_PLATFORM=linux/amd64` by default for
that reason.

`pnpm mvp:seed` creates a deterministic demo project and bearer token directly
in PostgreSQL when a host-reachable database URL is available. The one-command
demo uses the same seed script from inside the Compose network so the base stack
does not need to expose PostgreSQL on the host. Non-demo tokens should be
created, rotated and revoked through the token API or CLI added in `TASK-29`.

`pnpm mvp:acceptance` runs in dry-run mode by default and validates that the
scenario covers API, CLI, MCP, Hermes, document upload, job polling,
source-backed memory and context build. Set `MINDORY_E2E_LIVE=true` to execute
the live flow against `MINDORY_E2E_API_URL` or `http://localhost:3000`.
Set `MINDORY_E2E_REQUIRE_INDEXED=true` when embeddings are configured and the
deployment must prove the document pipeline reaches `indexed` status and serves
pgvector-backed document search.

## Base Services

- `postgres`
- `redis`
- `migrate`
- `api`
- `mcp`
- `worker`

Postgres uses a pgvector-capable image and the initial migration enables the
`vector` extension for document chunk embeddings.

## Release Images And Migrations

The reproducible release image path is:

```bash
docker build -t ghcr.io/<org>/mindory:<git-sha> .
```

Tag and push release images only after `pnpm check` passes on the target commit.
Run `pnpm db:migrate` through the Compose `migrate` service before API and
worker traffic starts.

Before production migrations, take a PostgreSQL backup and verify the restore
path. Rollback for the MVP means stopping API and worker traffic, restoring the
backup, redeploying the previous known-good image and rerunning acceptance.
Automated down migrations are not part of the MVP deployment path.

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

The `ollama` profile is optional for local embeddings. The selected embedding
model must produce 1536-dimensional vectors for the current pgvector MVP schema;
otherwise keep `MINDORY_EMBEDDINGS_PROVIDER=disabled` for the default chunked
fallback.

`docling` is still a profile skeleton. Running Compose may require network
access to pull images and to install dependencies during the first Docker build
if the cache is cold.
