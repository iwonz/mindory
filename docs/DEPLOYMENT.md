# Deployment

Mindory targets self-hosted Docker Compose deployment.

Production hardening expectations for CI, release images, backups, rollback,
secrets, rate limits and structured logs are maintained in
`docs/PRODUCTION_HARDENING.md`.

## Current Support Level

| Deployment path | Status |
| --- | --- |
| Local demo Compose | Supported local MVP. `pnpm mvp:demo` starts the stack, seeds demo credentials and runs live acceptance. |
| Persistent local Compose | Supported for development and self-host testing when `MINDORY_HOME` is set intentionally. |
| Installer wizard and dry-run | Supported. It can collect answers, render config previews and validate plans. |
| Installer prepare execution | Supported. It can create `$MINDORY_HOME`, write config/env files and copy Compose assets. |
| Installer Compose startup and provisioning | Future work. The installer does not yet start services, run migrations, create the first token, update or uninstall. |
| Release images and bundles | Manual baseline only. Publishing automation and signed release manifests are future release tasks. |
| Heavy local models | Experimental. Profiles exist for wiring checks or local experiments, not as a guaranteed default install. |

The expected local demo flow is:

```bash
pnpm mvp:demo
```

`pnpm mvp:demo` starts Docker Compose with the `clamav` profile, enables the
local multimodal document routers, waits for Postgres, Redis, migration
completion, API, worker and MCP service readiness, seeds demo credentials from
inside the Compose network, then runs live MVP acceptance.

Use `pnpm mvp:up` to start and seed without live acceptance, `pnpm mvp:down` to
stop the stack and `pnpm mvp:reset` to remove containers and host data created
for the demo. The demo script uses `.mindory-demo` in the repository when
`MINDORY_HOME` is not set, so it does not touch a real `~/.mindory`
installation by default.

The Compose runtime uses a shared built Node image and real API, worker,
migration and MCP command entrypoints.

The startup path is:

1. Build the root `Dockerfile`.
2. Start PostgreSQL and Redis.
3. Run the `migrate` service with `pnpm db:migrate`.
4. Start API with `node apps/api/dist/server.js`.
5. Start worker with `node apps/worker/dist/server.js`.
6. Optionally start the MCP stdio command with `node apps/mcp/dist/stdio.js`
   as a process smoke check.

The API healthcheck calls `/ready`. Compose binds runtime paths under
`MINDORY_HOME`, defaulting to `${HOME}/.mindory` when the host environment does
not set it:

- `config`
- `data/postgres`
- `data/redis`
- `data/objects`
- `data/librefs`
- `logs`
- `backups`
- `install`

API and worker mount `data/objects` at `/data/mindory/objects` for the default
local filesystem storage provider.

If `MINDORY_HOME` is explicitly set for `pnpm mvp:reset`, the reset command
stops containers but leaves that directory in place to avoid deleting an
intentional install root.

`deploy/compose/release-manifest.json` lists the Compose files, Dockerfile,
environment template and required `MINDORY_HOME` directories that release
bundles must carry until the installer can render host-specific assets.

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

Model runner profiles are selected by `--model-profile`:

```bash
pnpm mvp:demo --model-profile disabled
pnpm mvp:demo --model-profile local
pnpm mvp:demo --model-profile ollama
```

`disabled` is the default and starts no heavy model containers. `local` adds the
`local-models` profile, which currently runs a lightweight profile-smoke HTTP
service for wiring checks. It is not a real model runner. `ollama` adds the real
Ollama service for local model experiments.

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
- `librefs`
- `clamav`
- `qdrant`
- `docling`
- `ollama`
- `local-models`

Example:

```bash
docker compose --profile librefs --profile clamav --profile qdrant up -d
```

The `librefs` profile runs `ghcr.io/librefs/librefs:latest` as the local
S3-compatible storage option and stores its data under
`$MINDORY_HOME/data/librefs`. The `minio` profile remains available for manual
compatibility testing and stores data under `$MINDORY_HOME/data/minio`.

The `local-models` profile is intentionally lightweight and does not download
model weights or execute model inference. The `ollama` profile is optional for
local text embeddings. The selected embedding model must produce
1536-dimensional vectors for the current pgvector MVP schema; otherwise keep
`MINDORY_LLM_TEXT_EMBEDDING_ENABLED=false` for the default chunked
fallback.

`docling` is experimental and not required by the default local MVP path.
Running Compose may require network access to pull images and to install
dependencies during the first Docker build if the cache is cold.
