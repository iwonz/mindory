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
| Release bundles | Supported baseline. The release workflow generates bundle, RSA-SHA256 signed manifest, public key sidecar and checksum artifacts, then runs smoke-release-install with signature and checksum verification. |
| Installer execution | Partial baseline. Current installer can prepare `$MINDORY_HOME`, start Compose through health checks, provision the first token, refresh local assets, create/restore runtime backups, encrypt and upload remote backup archives, stream external S3 object backups and uninstall with explicit confirmation, but remote release update is future work. |
| Public self-host acceptance | Supported gate. `pnpm selfhost:acceptance` dry-runs the public self-host path; opt-in live mode runs installer start, MVP acceptance, backup, reset and uninstall in a temporary home. |
| Backup and restore | Supported MVP. Installer commands cover config, installer metadata, PostgreSQL dumps, local object storage state, scheduled local backup runs, local Compose PostgreSQL PITR with WAL archive/base backup/restore-to-time, encrypted S3-compatible remote backup archives and external S3 object streaming backups. |
| Observability | Supported baseline. Structured logs, model operation audit helpers, Prometheus metrics exporters, OpenTelemetry OTLP tracing/log export, in-process job/stage metrics, health snapshots and rate-limit strategy are documented in `docs/OBSERVABILITY.md`. |
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
GitHub-provided automation credentials plus the release signing private key
stored in `MINDORY_RELEASE_SIGNING_PRIVATE_KEY_PEM`. The private key is never
stored in repository files.

The release workflow:

- installs the locked pnpm dependency graph;
- runs `pnpm check`;
- builds the Docker image with `docker build`;
- runs `pnpm release:bundle -- --require-signing-key`;
- publishes a `.sha256` checksum file next to the bundle, signed manifest and
  public key sidecar;
- runs `scripts/smoke-release-install.js` as a dry-run install smoke;
- uploads release artifacts to the workflow run;
- uploads bundle, signed manifest, public key sidecar and checksum to a draft
  GitHub Release for tag builds.

Validate the release path locally without publishing:

```bash
pnpm release:validate
pnpm selfhost:acceptance
```

`release:validate` generates a temporary bundle, verifies the signed manifest
signature, records the manifest signature check as a release gate, rejects
tampered manifest and artifact cases, verifies the checksum
and runs the packaged installer `plan` command from the extracted release. It
does not start Docker or publish artifacts.

Rotate release signing keys by updating the `MINDORY_RELEASE_SIGNING_PRIVATE_KEY_PEM`
secret, recording the new public key fingerprint from the generated manifest in
release notes and keeping old public keys accessible for old release
verification. Bootstrap users should pass the trusted public key through
`MINDORY_RELEASE_PUBLIC_KEY_PATH`, `MINDORY_RELEASE_PUBLIC_KEY_PEM` or the
`--public-key-path` argument.

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
mindory-installer pitr-backup --home "$MINDORY_HOME" --label before-migration
pnpm backup:validate
```

The backup command writes `backup-manifest.json`, config, installer metadata,
a Docker Compose `pg_dump` output at `postgres/mindory.sql` and local object
storage files for `local-fs` or local LibreFS profiles. Restore requires an
explicit confirmation:

```bash
mindory-installer restore --home "$MINDORY_HOME" --backup "$MINDORY_HOME/backups/<backup-dir>" --yes
```

Scheduled local backups use the same runtime backup format and live under
`$MINDORY_HOME`. Enable them in generated config:

```env
MINDORY_BACKUP_SCHEDULE_ENABLED=true
MINDORY_BACKUP_SCHEDULE_INTERVAL_MINUTES=1440
MINDORY_BACKUP_RETENTION_COUNT=7
MINDORY_BACKUP_RETENTION_DAYS=30
```

Run the scheduler entrypoint from cron, systemd timer, launchd or another host
scheduler:

```bash
mindory-installer backup-schedule --home "$MINDORY_HOME"
mindory-installer backup-schedule --home "$MINDORY_HOME" --status
```

The runner writes `$MINDORY_HOME/backups/scheduled-backup.lock`,
`$MINDORY_HOME/backups/scheduled-backup-health.json` and
`$MINDORY_HOME/logs/scheduled-backup.log`. Only one scheduled run executes at a
time. Retention deletes only directories under `$MINDORY_HOME/backups` that
contain a Mindory `backup-manifest.json`.

For point-in-time recovery in the local Compose profile, keep WAL archiving
enabled:

```env
MINDORY_POSTGRES_WAL_ARCHIVE_ENABLED=true
MINDORY_POSTGRES_WAL_ARCHIVE_TIMEOUT_SECONDS=60
```

WAL files are stored in `$MINDORY_HOME/backups/postgres-wal`. A PITR base backup
is created with:

```bash
mindory-installer pitr-backup --home "$MINDORY_HOME" --label before-release
```

Restore to a target timestamp by staging recovery files first:

```bash
mindory-installer pitr-restore --home "$MINDORY_HOME" \
  --backup "$MINDORY_HOME/backups/<pitr-dir>" \
  --target-time 2026-05-22T12:00:00Z \
  --yes
```

The staged restore writes `postgresql.auto.conf` with `restore_command` and
`recovery_target_time`, plus `recovery.signal`, under
`$MINDORY_HOME/backups/pitr-restore`. To replace the local Compose data
directory, rerun with `--replace-live-data`; the installer stops Compose and
backs up the current `$MINDORY_HOME/data/postgres` first. Keep enough disk for
base backups plus retained WAL segments, and prune old PITR backup directories
only after newer base backups and their required WAL ranges are verified.

Encrypt a verified backup before copying it off host:

```bash
mindory-installer backup-archive --home "$MINDORY_HOME" \
  --backup "$MINDORY_HOME/backups/<backup-dir>" \
  --key-id local-2026-05 \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY"
mindory-installer backup-upload --home "$MINDORY_HOME" \
  --archive "$MINDORY_HOME/backups/<archive>.mindorybak"
```

Remote backup upload uses S3-compatible bucket health checks, writes SHA-256
metadata and verifies the remote object after upload. Configure it with
`MINDORY_REMOTE_BACKUP_ENABLED`, `MINDORY_BACKUP_ENCRYPTION_KEY_ID`,
`MINDORY_BACKUP_ENCRYPTION_KEY`, `MINDORY_REMOTE_BACKUP_S3_ENDPOINT`,
`MINDORY_REMOTE_BACKUP_S3_BUCKET`, `MINDORY_REMOTE_BACKUP_S3_ACCESS_KEY_ID`,
`MINDORY_REMOTE_BACKUP_S3_SECRET_ACCESS_KEY` and
`MINDORY_REMOTE_BACKUP_S3_PREFIX`. Store the encryption key in a secret manager
or offline password vault; a lost key makes `.mindorybak` archives unrecoverable.

Verify a remote restore path before depending on it:

```bash
mindory-installer backup-download --home "$MINDORY_HOME" --object-key mindory/<archive>.mindorybak
mindory-installer backup-restore-archive --home "$MINDORY_HOME" \
  --archive "$MINDORY_HOME/backups/remote-downloads/<archive>.mindorybak" \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY" \
  --yes
mindory-installer restore --home "$MINDORY_HOME" \
  --backup "$MINDORY_HOME/backups/decrypted/<archive-dir>" \
  --yes --no-postgres
```

For deployments where RAW object storage is an external S3-compatible bucket,
validate bucket inventory and streaming backup separately from database restore:

```bash
mindory-installer s3-inventory --home "$MINDORY_HOME" --prefix documents/
mindory-installer s3-backup --home "$MINDORY_HOME" \
  --prefix documents/ \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY" \
  --key-id local-2026-05
mindory-installer s3-restore --home "$MINDORY_HOME" \
  --archive "$MINDORY_HOME/backups/<archive>.mindorys3bak" \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY" \
  --yes
```

The streaming archive records ListObjectsV2 page progress, object chunks,
metadata and SHA-256 verification data. Use `--resume-after-key` with the last
completed key printed by progress diagnostics when restarting an interrupted
external S3 backup.

The MVP uses forward migrations. If a migration or release must be rolled back,
stop API and worker traffic, restore the verified backup, redeploy the previous
known-good image and then run acceptance against that restored deployment.
Automated down migrations are deferred until the schema is managed by a release
process that can test both forward and backward paths.

External S3-compatible bucket data is not copied by the local MVP backup
command. Back up external buckets with provider-native tooling before
migrations that change document metadata or chunk/index expectations.

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
logs, model operation audit, job stage metrics, Prometheus metrics, health
endpoints and the MVP rate-limit strategy.

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
in-process and grouped by job type, stage and status. API and worker metrics
are exported in Prometheus text format when `MINDORY_METRICS_ENABLED=true`;
the endpoints support bearer-token protection through
`MINDORY_METRICS_BEARER_TOKEN` and avoid project/document/session ids as
labels.

OpenTelemetry trace and structured log export are configured through
`MINDORY_OTEL_*`. API requests, worker jobs, model operations, object storage
and vector operations emit safe spans when tracing is enabled. Export failures
are non-fatal for runtime operations.
