# Deployment

Mindory targets self-hosted Docker Compose deployment.

Production hardening expectations for CI, release images, backups, rollback,
secrets, rate limits, structured logs and observability are maintained in
`docs/PRODUCTION_HARDENING.md`.

## Current Support Level

| Deployment path | Status |
| --- | --- |
| Local demo Compose | Supported local MVP. `pnpm mvp:demo` starts the stack, seeds demo credentials and runs live acceptance. |
| Persistent local Compose | Supported for development and self-host testing when `MINDORY_HOME` is set intentionally. |
| Installer wizard and dry-run | Supported. It can collect answers, render config previews and validate plans. |
| Installer prepare execution | Supported. It can create `$MINDORY_HOME`, write config/env files and copy Compose assets. |
| Installer Compose startup | Supported as an explicit start step. It can pull/build, start infrastructure, run migrations, start API/worker/MCP and wait for health checks. |
| Installer first-run provisioning | Supported. The start step creates the first project/token and writes `config/initial-token.json` under `$MINDORY_HOME`. |
| Installer lifecycle operations | Supported baseline for local asset update, runtime backup/restore, scheduled local backup, encrypted remote backup archives, external S3 streaming backups and guarded uninstall. Remote release update and full automated resume remain future work. |
| Release images and bundles | Bundle generation is supported with `pnpm release:bundle`. Generated manifests are RSA-SHA256 signed, and bootstrap scripts verify the signature before trusting bundle checksums. Publishing automation uploads release artifacts to draft GitHub Releases. |
| Heavy local models | Experimental. Profiles exist for wiring checks or local experiments, not as a guaranteed default install. |

The expected local demo flow is:

```bash
pnpm mvp:demo
```

The public self-host acceptance gate for release readiness is:

```bash
pnpm selfhost:acceptance
```

This default path is a dry-run and is included in `pnpm check`. The opt-in live
path runs installer startup, live MVP acceptance, backup, reset and uninstall
inside a temporary `MINDORY_HOME`:

```bash
MINDORY_SELFHOST_ACCEPTANCE_LIVE=true pnpm selfhost:acceptance
```

Add `MINDORY_SELFHOST_ACCEPTANCE_LOCAL=true` to also run the deterministic local
model profile with strict indexed pgvector acceptance.

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

Back up a persistent local install before upgrades or migrations with:

```bash
mindory-installer backup --home "$MINDORY_HOME"
```

Restore from a verified backup with:

```bash
mindory-installer restore --home "$MINDORY_HOME" --backup "$MINDORY_HOME/backups/<backup-dir>" --yes
```

The restore command imports PostgreSQL through Compose `psql`, so the Postgres
service must be running. Local filesystem objects and local LibreFS data are
copied from the backup; external S3-compatible bucket data must be restored
with provider-native tools.

If `MINDORY_HOME` is explicitly set for `pnpm mvp:reset`, the reset command
stops containers but leaves that directory in place to avoid deleting an
intentional install root.

`deploy/compose/release-manifest.json` lists the Compose files, Dockerfile,
environment template and required `MINDORY_HOME` directories that release
bundles must carry until the installer can render host-specific assets. The
baseline bundle builder is:

```bash
pnpm release:bundle -- --version 0.1.0
```

It writes `dist/releases/mindory-<version>.tar.gz`, a matching env-style
manifest with the bundle SHA-256 and RSA-SHA256 manifest signature, and
`dist/releases/mindory-<version>.manifest.env.public.pem`. Without `--url-base`,
the manifest uses a local `file://` bundle URL so the bootstrap path can be
tested without a remote release server.

MCP stdio is normally launched by an MCP client, not exposed as a Compose
network service. The Compose `mcp` service is a packaging artifact that proves
the command starts inside the image; real clients should use the examples in
`docs/MCP.md` and point `MINDORY_MCP_API_URL` at a reachable API URL.

On Apple Silicon, the `clamav/clamav:stable` image may need amd64 emulation.
The Compose profile uses `MINDORY_CLAMAV_PLATFORM=linux/amd64` by default for
that reason.

The `clamav` service has a Compose healthcheck that scans a clean probe with
`clamdscan`. Installer startup adds a stricter check: it executes both a clean
probe and an EICAR infected probe inside the service. If the daemon cannot be
reached, the scan protocol fails or the EICAR probe is not detected, startup
stops with a repairable diagnostic. Adjust `MINDORY_CLAMAV_PLATFORM`,
`MINDORY_CLAMAV_HEALTH_RETRIES` and `MINDORY_CLAMAV_HEALTH_TIMEOUT_MS` when the
image needs more time or a different platform on the target host.

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
`local-models` profile, which runs a lightweight deterministic local HTTP model
service for embeddings acceptance. `ollama` adds the real Ollama service for
local model experiments.

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

### Release Workflow

`.github/workflows/release.yml` is the public release baseline. It runs
`pnpm check`, builds the Docker image, generates the release bundle with
`pnpm release:bundle`, writes a `.sha256` checksum file, runs
`scripts/smoke-release-install.js` against the generated signed manifest and
uploads the release artifacts to the workflow run. For tag builds, it also
creates or updates a draft GitHub Release with the bundle, signed manifest,
public key sidecar and checksum.

Tag and manual release publishing require the GitHub secret
`MINDORY_RELEASE_SIGNING_PRIVATE_KEY_PEM`. The bundle builder signs the
manifest over all release metadata except the final signature line and writes
`MINDORY_RELEASE_PUBLIC_KEY_SHA256` into the manifest. Rotate the release key
by adding the new private key as the workflow secret, publishing the matching
public key fingerprint in release notes, and keeping the old public key
available for users who need to verify older manifests.

Validate this path locally without publishing:

```bash
pnpm release:validate
```

The local validation builds a temporary release bundle, verifies the manifest
signature, rejects tampered manifest and artifact cases, verifies the bundle
checksum and runs the packaged installer `plan` command from the extracted
bundle. It does not start Docker or publish artifacts.

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
Both local S3 profiles include health checks and one-shot bucket bootstrap
services (`librefs-bucket` and `minio-bucket`) that create
`MINDORY_S3_BUCKET` before API/worker startup when the installer uses the S3
storage path.

The `local-models` profile is intentionally lightweight and does not download
model weights. It serves deterministic 1536-dimensional embeddings for local
acceptance. The `ollama` profile is optional for local text embeddings. External
and Ollama embedding models must also produce 1536-dimensional vectors for the
current pgvector MVP schema.

The `docling` profile runs Mindory's Docling-compatible extraction service from
the built application image. It exposes `/health` on `MINDORY_DOCLING_PORT`
and `POST /v1/extract` for worker PDF extraction when
`MINDORY_DOCLING_ENABLED=true`.
Running Compose may require network access to pull images and to install
dependencies during the first Docker build if the cache is cold.
