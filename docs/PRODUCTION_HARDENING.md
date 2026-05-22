# Production Hardening

Mindory can run as a local MVP through Docker Compose, but non-demo use must
separate demo defaults from production operations. This document records the
minimum baseline for the MVP release path.

## Current Support Level

| Area | Current state |
| --- | --- |
| CI gate | Supported baseline. GitHub Actions runs `pnpm check` for pushes and pull requests to `master`. |
| Local demo | Supported local MVP through Docker Compose and `pnpm mvp:demo`. |
| Release images | Supported baseline. The release workflow runs `pnpm check` and builds a Docker image for the target version. Registry push policy is future hardening. |
| Release bundles | Supported baseline. The release workflow generates bundle, manifest and checksum artifacts, then runs smoke-release-install. Signature verification remains future work. |
| Installer execution | Partial baseline. Current installer can prepare `$MINDORY_HOME`, start Compose through health checks, provision the first token, refresh local assets, create/restore runtime backups and uninstall with explicit confirmation, but remote release update is future work. |
| Public self-host acceptance | Supported gate. `pnpm selfhost:acceptance` dry-runs the public self-host path; opt-in live mode runs installer start, MVP acceptance, backup, reset and uninstall in a temporary home. |
| Backup and restore | Supported MVP. Installer commands cover config, installer metadata, PostgreSQL dumps and local object storage state. Point-in-time recovery, scheduled backups and encrypted remote backups are future hardening work. |
| Observability | Supported baseline. Structured logs, model operation audit helpers, in-process job/stage metrics, health snapshots and rate-limit strategy are documented in `docs/OBSERVABILITY.md`. Metrics exporters, tracing, log aggregation and alerting are future hardening work. |
| Public GitHub readiness | Supported baseline. The repo includes license, contribution guide, root security policy, issue/PR templates, changelog/release notes policy, support matrix and repository status docs. |

## CI Gate

Pull requests and pushes to `master` run `.github/workflows/ci.yml`. The job
uses Node.js 24, installs the locked pnpm dependency graph, verifies Docker
Compose is available and runs:

```bash
pnpm check
```

The default CI path must not require private provider credentials. Live external
embedding providers, hosted storage and official Hermes SDK deployments are
verified by separate environment-specific checks.

## Release Images

### Release Workflow

`.github/workflows/release.yml` runs on `v*` tags and manual dispatch. It uses
only GitHub-provided automation credentials, not repository-stored secrets.

The release workflow:

- installs the locked pnpm dependency graph;
- runs `pnpm check`;
- builds the Docker image with `docker build`;
- runs `pnpm release:bundle`;
- publishes a `.sha256` checksum file next to the bundle and manifest;
- runs `scripts/smoke-release-install.js` as a dry-run install smoke;
- uploads release artifacts to the workflow run;
- uploads bundle, manifest and checksum to a draft GitHub Release for tag
  builds.

Validate the release path locally without publishing:

```bash
pnpm release:validate
pnpm selfhost:acceptance
```

`release:validate` generates a temporary bundle, verifies the checksum and runs
the packaged installer `plan` command from the extracted release. It does not
start Docker or publish artifacts.

Build release images from a verified `master` commit or signed release tag after
`pnpm check` passes.

```bash
export IMAGE=ghcr.io/<org>/mindory
export GIT_SHA=$(git rev-parse --short=12 HEAD)
docker build -t "$IMAGE:$GIT_SHA" .
docker tag "$IMAGE:$GIT_SHA" "$IMAGE:<semver>"
docker push "$IMAGE:$GIT_SHA"
docker push "$IMAGE:<semver>"
```

The Dockerfile installs with `pnpm install --frozen-lockfile` and runs
`pnpm typecheck`, so the image build is tied to the committed lockfile and
workspace TypeScript outputs.

## Migrations, Backup And Rollback

Run migrations as a deployment step before API and worker services accept
traffic. Docker Compose does this through the `migrate` service with
`pnpm db:migrate`.

Before applying migrations in production, create and verify a Mindory runtime
backup:

```bash
mindory-installer backup --home "$MINDORY_HOME" --label before-migration
pnpm backup:validate
```

The backup command writes `backup-manifest.json`, config, installer metadata,
a Docker Compose `pg_dump` output at `postgres/mindory.sql` and local object
storage files for `local-fs` or local LibreFS profiles. Restore requires an
explicit confirmation:

```bash
mindory-installer restore --home "$MINDORY_HOME" --backup "$MINDORY_HOME/backups/<backup-dir>" --yes
```

The MVP uses forward migrations. If a migration or release must be rolled back,
stop API and worker traffic, restore the verified backup, redeploy the previous
known-good image and then run acceptance against that restored deployment.
Automated down migrations are deferred until the schema is managed by a release
process that can test both forward and backward paths.

External S3-compatible bucket data is not copied by the local MVP backup
command. Back up external buckets with provider-native tooling before
migrations that change document metadata or chunk/index expectations. Database
point-in-time recovery remains future hardening.

## Production Secret Handling

Never use `.env.example` values as production secrets. Put production values in
a secret manager or in deployment-scoped environment injection that is not
committed to git.

Required production overrides include:

- `MINDORY_DATABASE_URL`
- `MINDORY_REDIS_URL`
- `MINDORY_S3_ACCESS_KEY_ID` and `MINDORY_S3_SECRET_ACCESS_KEY` when S3 is used
- `MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY` or `MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN` when external model providers are used
- `MINDORY_MCP_API_TOKEN`
- `MINDORY_CLI_API_TOKEN`
- `MINDORY_HERMES_API_TOKEN`
- bearer tokens created through the token API or CLI
- bundled Postgres, LibreFS/MinIO and demo token defaults

Rotate API tokens through the token API or CLI. Raw tokens are returned once on
create or rotate, so store them immediately after issuance.

## Request Guards

The API enables an in-process rate limit by default:

```env
MINDORY_API_RATE_LIMIT_ENABLED=true
MINDORY_API_RATE_LIMIT_WINDOW_MS=60000
MINDORY_API_RATE_LIMIT_MAX=600
```

The guard exempts `/health` and `/ready`, keys authenticated requests by a
hashed authorization header and unauthenticated requests by client IP, and
returns structured `429 rate_limited` errors with `x-ratelimit-*` headers.

This is a baseline guard for one API process. Distributed rate limiting is
deferred for the MVP; production deployments should also enforce global limits,
TLS, upload body limits and trusted proxy headers at the reverse proxy or load
balancer.

## Observability

`docs/OBSERVABILITY.md` is the detailed operations reference for structured
logs, model operation audit, job stage metrics, health endpoints and the MVP
rate-limit strategy.

API logs use Fastify structured JSON output. Authorization headers are redacted,
and requests carry a generated or caller-provided request id. Worker and
processor logs should keep the same style. The production baseline depends on
structured logs rather than plain text output.

Operational diagnosis should include these fields where available:

- `request_id`
- `project_id`
- `document_id`
- `job_id`
- `session_id`
- `memory_id`

Expected API errors should log at info level. Rejected rate limit requests log
the key type and reset time without raw tokens. Worker failures should include
processor name, job type, retry attempt and failed status transition context.

Model operation audit records include role, provider, model, duration, status,
usage and project/document/job/session refs. `@mindory/observability` exposes
local query and summary helpers for those records. Job stage metrics are
in-process and grouped by job type, stage and status.

Prometheus exporters, OpenTelemetry tracing, log aggregation and alerting are
future hardening work, but emitted logs and helper shapes must remain structured
enough to support those systems without rewriting runtime code.
