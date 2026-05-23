# Installer

The installer is built in layers. The current implementation supports planning,
interactive answer collection, config rendering, dependency diagnostics,
bootstrap staging, prepare execution, Docker Compose startup through health
checks and dry-run/live acceptance checks. It can write the local
`$MINDORY_HOME` file layout, start the runtime and provision the first
project/token, then create local, scheduled, PITR and encrypted remote backup
artifacts.

## Current Support Level

| Capability | Status |
| --- | --- |
| Interactive wizard | Supported. It collects and validates answers and shows a redacted summary. |
| Plan/dry-run | Supported. It renders deterministic install plans without mutating host state. |
| Config rendering | Supported in the installer core for generated `.env` and `mindory.config.json` content. |
| Prepare execution | Supported. It creates `$MINDORY_HOME`, writes generated config/env files and copies release Compose assets with journaled rollback. |
| Compose startup | Supported. It can pull/build, start infrastructure, run migrations, start API/worker/MCP and wait for Compose/API readiness. |
| S3 storage bootstrap | Supported baseline. Local LibreFS/MinIO profiles run bucket bootstrap services; external S3-compatible endpoints are signed access-checked before migrations. |
| Vector backend selection | Supported. The wizard and answer files can choose `pgvector` or `qdrant`; Qdrant automatically adds the `qdrant` Compose profile and is included in Compose health checks. |
| First project/token provisioning | Supported. It creates the initial project and bearer token, then writes `config/initial-token.json`. |
| Update assets | Supported for local config/Compose asset refresh and signed remote release update with pre-update backup, migration/startup execution, health checks and rollback. |
| Runtime backup/restore | Supported MVP. It writes `backup-manifest.json`, config, installer metadata, PostgreSQL dumps and local object storage copies. |
| PostgreSQL PITR | Supported local baseline. `pitr-backup` creates a `pg_basebackup` base backup and `pitr-restore` stages recovery with WAL archive refs and a target time. |
| Scheduled local backups | Supported. `backup-schedule` uses config-driven intervals, a lock file, retention, logs and health state under `$MINDORY_HOME`. |
| Encrypted remote backups | Supported. `backup-archive`, `backup-upload`, `backup-download` and `backup-restore-archive` encrypt backup sets and verify S3-compatible object integrity. |
| External S3 object streaming backups | Supported. `s3-inventory`, `s3-backup` and `s3-restore` list external object storage, create encrypted streaming archives and restore object keys/metadata without local object files. |
| Uninstall | Supported with explicit `--yes`; optional backup is written next to the removed home. |
| Dependency detection | Supported through injectable probes and diagnostics. |
| Lock, journal and recovery diagnostics | Supported. `repair` and `resume` inspect current state and act on recoverable interrupted runs. |
| Release bundle generation | Supported baseline through `pnpm release:bundle`. |
| Bootstrap staging, signature and checksum verification | Supported for source/release-style bundles, including local file paths and `file://` URLs. Manifest signatures are verified before bundle checksums are trusted. |
| Resume and repair execution | Supported. `resume` continues from a recoverable journal/run-state boundary; `repair` can clear confirmed stale locks and continue interrupted rollback. |

## Core Package

`@mindory/installer` owns:

- answer file types and validation;
- install plan generation;
- host dependency detection;
- transaction journal entries;
- reverse-order rollback execution;
- generated `.env` and `mindory.config.json` rendering;
- vector backend selection for `pgvector` or `qdrant`;
- redacted summaries for confirmation screens and logs.

The package reads defaults and supported values from `@mindory/config`. It must
not duplicate env names, secret flags or enum values outside the config catalog.

## Boundaries

The core package is deterministic and testable without mutating the host when
used in plan/dry-run mode. Its explicit prepare execution API mutates only the
selected `$MINDORY_HOME`: it creates the directory tree, writes generated
config/env files, copies release Compose assets and can run Docker Compose
startup commands when explicitly requested. It does not install Docker or
download releases.

The wizard is also testable without a terminal through injectable IO. A Node
readline adapter is available for real interactive use, but the wizard only
returns validated answers after showing a redacted confirmation summary.

Shell and PowerShell bootstrap scripts launch the same installer package used by
the CLI. Signal handling stops the bootstrap cleanly, while installer recovery
is handled through the journal-backed `resume` and `repair` commands.

## Bootstrap

The repository root contains:

- `install.sh` for Linux/macOS shells;
- `install.ps1` for Windows PowerShell.

Both scripts use `MINDORY_HOME`, defaulting to `~/.mindory`, and stage release
downloads under `$MINDORY_HOME/install/downloads` plus extracted releases under
`$MINDORY_HOME/install/releases/<version>`.

If the bootstrap receives `SIGINT`/Ctrl+C or fails, it stops further steps and
prints a short recovery message instead of continuing after a partial operation.

For dev/test mode, pass a local source or release directory:

```bash
./install.sh --source /path/to/mindory
```

```powershell
./install.ps1 -Source C:\path\to\mindory
```

After a source checkout has been built, the explicit startup command is:

```bash
node packages/installer/dist/cli.js start --home ~/.mindory --source /path/to/mindory
```

This command runs through health checks and first project/token provisioning.
If any enabled LLM role uses `local-command`, the installer also executes the
configured `MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND` once per role before
API readiness is accepted. The command must return the JSON contract documented
in [LLM.md](LLM.md), otherwise installation stops with the failing role/model
and healthcheck diagnostic.
The same wizard section captures `MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND`
and operation args for runtime model calls.

The generated raw bearer token is written once to:

```text
$MINDORY_HOME/config/initial-token.json
```

For release mode, provide a manifest URL or manifest file. The manifest is a
simple env-style file:

```env
MINDORY_RELEASE_VERSION=1.2.3
MINDORY_RELEASE_BUNDLE_URL=https://example.com/mindory-1.2.3.tar.gz
MINDORY_RELEASE_BUNDLE_SHA256=<sha256>
MINDORY_RELEASE_BUNDLE_NAME=mindory-1.2.3.tar.gz
MINDORY_RELEASE_CREATED_AT=2026-05-22T00:00:00.000Z
MINDORY_RELEASE_MANIFEST_SIGNATURE_ALGORITHM=RSA-SHA256
MINDORY_RELEASE_PUBLIC_KEY_SHA256=<trusted-public-key-sha256>
MINDORY_RELEASE_MANIFEST_SIGNATURE=<base64-signature>
```

`MINDORY_RELEASE_BUNDLE_URL` can be an HTTPS URL, an absolute or relative local
path, or a `file://` URL. The bootstrap verifies the manifest signature first,
then verifies the bundle checksum before extraction, extracts into a temporary
staging directory and promotes the staged release only after extraction
succeeds. If extraction or promotion fails, the previous release directory is
left in place when present.

Provide the trusted signing public key with one of:

```bash
./install.sh --manifest-url https://github.com/iwonz/mindory/releases/download/v0.1.0/mindory-0.1.0.manifest.env --public-key-path ./mindory-0.1.0.manifest.env.public.pem
./install.sh --manifest-url https://example.com/mindory.manifest.env --public-key-path ./mindory-release.public.pem
MINDORY_RELEASE_PUBLIC_KEY_PATH=./mindory-release.public.pem ./install.sh --manifest-path ./mindory.manifest.env
MINDORY_RELEASE_PUBLIC_KEY_PEM="$(cat ./mindory-release.public.pem)" ./install.sh --manifest-path ./mindory.manifest.env
```

```powershell
./install.ps1 -ManifestUrl https://example.com/mindory.manifest.env -PublicKeyPath .\mindory-release.public.pem
```

For local dev/test bundles, `pnpm release:bundle` also writes
`<manifest>.public.pem` next to the manifest, and the bootstrap can use that
sidecar automatically. Hosted production installs should pin a trusted public
key path or PEM from project release notes rather than relying on a downloaded
sidecar as the trust anchor.

Use verify-only mode to test downloads, signatures and checksums without
extracting or launching the wizard:

```bash
./install.sh --manifest-path dist/releases/mindory-0.1.0.manifest.env --verify-only
MINDORY_PUBLISHED_RELEASE_ACCEPTANCE_LIVE=true pnpm published-release:acceptance
```

`pnpm published-release:acceptance` runs a non-network dry-run by default. With
`MINDORY_PUBLISHED_RELEASE_ACCEPTANCE_LIVE=true`, it downloads the public
GitHub pre-release manifest and public key sidecar, runs `install.sh
--verify-only`, downloads the bundle, verifies the checksum, extracts into a
temporary `MINDORY_HOME` and runs the packaged installer `plan` command.

Create a local release-style bundle and matching manifest with:

```bash
pnpm release:bundle -- --version 0.1.0
```

By default this writes:

```text
dist/releases/mindory-0.1.0.tar.gz
dist/releases/mindory-0.1.0.manifest.env
dist/releases/mindory-0.1.0.manifest.env.public.pem
```

When `--url-base` is omitted, the generated manifest points at the bundle with a
local `file://` URL for dev/test installs. For hosted releases, pass a base URL:

```bash
pnpm release:bundle -- --version 0.1.0 --url-base https://downloads.example.com/mindory
pnpm release:bundle -- --version 0.1.0 --url-base https://github.com/iwonz/mindory/releases/download/v0.1.0
```

Production release publishing should pass a real RSA private key through
`MINDORY_RELEASE_SIGNING_PRIVATE_KEY_PEM` or
`MINDORY_RELEASE_SIGNING_PRIVATE_KEY_PATH`. The repository never stores the
private signing key. `--require-signing-key` makes release generation fail if
the key is missing; local validation omits that flag and generates an ephemeral
dev/test key only for the temporary manifest being tested.

The bootstrap launches `bin/mindory-installer` when a packaged binary exists, or
falls back to `node packages/installer/dist/cli.js wizard` for source-style
bundles. The installer CLI currently supports `wizard`, `plan`/`dry-run`,
`prepare`, `start`, `update`, `backup`, `backup-schedule`, `pitr-backup`,
`pitr-restore`, `restore`, `uninstall`,
`render-defaults`, `repair` and `resume`. `prepare` executes only the local
file preparation steps. `start`
additionally runs Docker Compose pull/build, infrastructure startup, migrations,
API/worker/MCP startup, health checks and first project/token provisioning.
`update --dry-run` previews local asset refresh or signed remote release
verification, while `update` creates a pre-update backup before rewriting
config and Compose assets. With `--manifest-url` or `--manifest-path`, it
downloads or copies the signed release manifest, verifies the trusted public
key fingerprint and manifest signature, verifies the bundle checksum, stages
the release under `$MINDORY_HOME/install/releases/<version>`, runs migrations,
starts runtime services and health-checks the updated stack. `backup` creates
a runtime backup under `$MINDORY_HOME/backups`; `backup-schedule` executes the
configured scheduled backup runner once and records health. `pitr-backup`
creates a PostgreSQL base backup for WAL-based recovery; `pitr-restore` stages
or explicitly replaces the local Postgres data directory with a target-time
recovery directory. `restore` requires `--yes` before overwriting local state.
`uninstall` requires `--yes` and can preserve a sibling backup with `--backup`.

## Recovery Surface

The installer core can acquire an install lock at
`$MINDORY_HOME/install/install.lock`, persist a transaction journal at
`$MINDORY_HOME/install/install-journal.json` and format clear diagnostics for
dependency or execution failures.

The CLI exposes:

```bash
mindory-installer repair --home ~/.mindory
mindory-installer resume --home ~/.mindory
mindory-installer update --home ~/.mindory --source /path/to/mindory --dry-run
mindory-installer update --home ~/.mindory --manifest-url https://example.com/mindory.manifest.env --public-key-path ./mindory-release.public.pem --dry-run
mindory-installer update --home ~/.mindory --manifest-url https://example.com/mindory.manifest.env --public-key-path ./mindory-release.public.pem
mindory-installer backup --home ~/.mindory
mindory-installer backup-schedule --home ~/.mindory --status
mindory-installer pitr-backup --home ~/.mindory
mindory-installer pitr-restore --home ~/.mindory --backup ~/.mindory/backups/<pitr-dir> --target-time 2026-05-22T12:00:00Z --yes
mindory-installer restore --home ~/.mindory --backup ~/.mindory/backups/<backup-dir> --yes
mindory-installer uninstall --home ~/.mindory --yes --backup
```

`repair` inspects lock, journal and run-state files. With `--yes` or
`--clear-stale-lock`, it removes a confirmed stale installer lock. With
`--continue-rollback` or `--yes`, it continues rollback entries that were
interrupted after a failure. `resume` continues a recoverable run from the
last planned step or, when explicitly requested with `--continue-completed`,
from the next step after the last completed action. Both commands operate only
inside `$MINDORY_HOME`.

## Dev/Test Matrix

`TASK-62` adds a dry-run matrix for Linux, macOS and Windows under
`packages/installer/fixtures/matrix`. Each fixture contains answer-file
snapshots plus expected Compose profiles and dependency diagnostics.

Run:

```bash
pnpm installer:matrix:validate
```

The matrix uses fake dependency probes. It does not start Docker, download
releases, install system dependencies or mutate host state outside the normal
TypeScript build outputs.

## Acceptance

`TASK-63` adds the installer acceptance command:

```bash
pnpm installer:acceptance
```

By default it runs a dry-run acceptance: installer CLI plan, `repair`, `resume`,
matrix validation and bootstrap validation. This default path is included in
`pnpm check` and does not start Docker.

To run the live Docker smoke path in a temporary `MINDORY_HOME`:

```bash
MINDORY_INSTALL_ACCEPTANCE_LIVE=true pnpm installer:acceptance
```

Live mode runs the existing MVP demo acceptance with disabled heavy model
services, then calls the reset path and removes the temp install home. Dry-run
acceptance also runs the prepare command in a temporary home. Live mode proves
that the current repo can run the local demo stack. The default installer
acceptance validates the installer Compose startup path with fake command and
health runners; real installer-driven startup is available through the explicit
`start` command. Live mode is opt-in because it may need cached images or
network access for Docker pulls.

The public self-host acceptance gate is:

```bash
pnpm selfhost:gate
```

It uses temporary `MINDORY_HOME` directories and runs installer `start` for
sync ClamAV, pgvector and Docling, executes live MVP acceptance, creates a
runtime backup, performs a restore smoke without replacing live PostgreSQL data,
applies a signed remote update, resets the stack, runs guarded uninstall, then
repeats the live path for Qdrant with deterministic local embeddings.

The non-Docker rehearsal path is:

```bash
pnpm selfhost:gate -- --dry-run
```

## Wizard Prompts

The wizard prompts for:

- install profile, home directory, dependency policy and public URL;
- antivirus mode;
- storage choice: local filesystem, LibreFS local S3 or external S3-compatible;
- document modality switches, video keyframe limit, keyframe provider and
  ffmpeg/ffprobe commands when the bundled ffmpeg provider is selected;
- local model auto-install, selected supported runner ids and pull retry count;
- independent LLM role enablement, provider, model, required mode, timeout,
  concurrency and embedding dimensions where applicable;
- API/MCP/Hermes interface switches and tokens.

Prompt labels, defaults, enum values, secret flags and resource hints come from
the config catalog whenever a catalog entry exists. Local model runner choices
come from `LOCAL_MODEL_RUNNER_CATALOG`; `docs/LOCAL_MODELS.md` records role
coverage, source/image metadata, model files, license/status, ports,
healthchecks and resource hints. If a supported local runner is selected, the
wizard applies the matching `@mindory/llm` role provider/model defaults. If the
runner is declined, roles only covered by that runner are written as disabled
instead of being left half-configured. Future or experimental LLM roles are
visible, but they cannot be enabled unless experimental mode is enabled
explicitly.

During `start`, selected local runners are installed after their Compose
services start and before storage bootstrap or migrations continue. The
installer writes `$MINDORY_HOME/logs/local-model-install.log` plus
`$MINDORY_HOME/install/local-models/install-report.json`, checks disk
requirements, waits for runner service health and retries pull/download
operations according to `MINDORY_INSTALL_LOCAL_MODEL_PULL_RETRIES`. The
supported deterministic local HTTP runner is verified through its `/health`
endpoint; the supported Ollama runner executes `ollama pull nomic-embed-text`
and `ollama list` inside the `ollama` service. Failures stop installation with
the log path in the diagnostic and leave rollback journal state for repair.

For LibreFS or MinIO local S3 choices, installer startup enables the matching
Compose profile and runs the one-shot bucket bootstrap service. For external
S3-compatible storage, it validates the endpoint URL, bucket and credentials,
then signs bucket-level access checks through `@mindory/storage-s3`. The
installer never deletes external buckets during rollback or uninstall.

When antivirus is enabled with the ClamAV provider, installer startup enables
the `clamav` Compose profile and performs runtime health validation after the
infrastructure services start. The validation runs a clean `clamdscan` probe and
an EICAR infected probe inside the ClamAV service. Failures are categorized as
daemon unavailable, timeout, protocol failure, clean probe reported infected or
EICAR probe not detected. The diagnostic includes `MINDORY_AV_MODE`,
`MINDORY_AV_PROVIDER`, `MINDORY_CLAMAV_PLATFORM`, the last scan output and the
recommended repair path.

When video processing selects the bundled ffmpeg keyframe provider, dev/source
dependency detection validates the configured ffmpeg executable. Runtime
installer health checks also execute `ffmpeg -version` inside the worker
container before accepting the stack, so missing binaries fail before uploads
can enqueue video extraction work.

## Transaction Model

Every install action is planned before execution. The journal records planned,
completed, failed and rollback events. On failure, completed actions are rolled
back in reverse order when they expose a rollback step. Actions with no local
rollback are recorded as skipped so the diagnosis can tell the user what may
require manual cleanup. Prepare execution uses this model for filesystem,
config and Compose asset writes. Startup execution adds `compose_down` rollback
for started services. First-token provisioning writes a local credential file
with rollback for that file. Local and remote update create a pre-update backup under
`$MINDORY_HOME/backups` and restore config/assets from that backup if asset
refresh, migration, startup or healthcheck fails. Remote update also restores
the previously staged release directory when promotion happened before the
failure. Update rollback never deletes existing backups. Uninstall
requires explicit confirmation and can copy the home to a sibling backup before
removal.

## Backup And Restore

The MVP backup command is local and single-home aware:

```bash
mindory-installer backup --home ~/.mindory
```

It creates a timestamped directory under `$MINDORY_HOME/backups` with:

- `backup-manifest.json` describing the backup, storage mode and component
  reports;
- `config/` with generated `.env`, `mindory.config.json` and first-run token
  file when present;
- `installer-state/` with installer metadata and Compose assets;
- `postgres/mindory.sql`, produced through Docker Compose `pg_dump`;
- `objects/` for local filesystem RAW object data, or `librefs/` for the local
  LibreFS bind-mounted S3 profile.

Useful options:

```bash
mindory-installer backup --home ~/.mindory --label before-upgrade
mindory-installer backup --home ~/.mindory --output /backups/mindory-pre-upgrade
mindory-installer backup --home ~/.mindory --dry-run
mindory-installer backup --home ~/.mindory --no-postgres --no-objects
```

Restore is intentionally guarded because it overwrites local state:

```bash
mindory-installer restore --home ~/.mindory --backup ~/.mindory/backups/<backup-dir> --yes
```

Restore copies backed-up config and local object data back into
`$MINDORY_HOME`, then imports `postgres/mindory.sql` through Docker Compose
`psql`. The PostgreSQL service must be running and reachable through the
installed Compose assets. To restore only selected components:

```bash
mindory-installer restore --home ~/.mindory --backup ~/.mindory/backups/<backup-dir> --yes --no-postgres
mindory-installer restore --home ~/.mindory --backup ~/.mindory/backups/<backup-dir> --yes --no-objects
mindory-installer restore --home ~/.mindory --backup ~/.mindory/backups/<backup-dir> --yes --no-config
```

External S3-compatible bucket data is not copied by the MVP local backup
command. The backup manifest records that component as skipped; use provider
native bucket backup tooling for external S3, then restore the bucket before or
alongside the Mindory database restore.

### PostgreSQL PITR

The local Compose Postgres profile enables WAL archiving by default:

```env
MINDORY_POSTGRES_WAL_ARCHIVE_ENABLED=true
MINDORY_POSTGRES_WAL_ARCHIVE_TIMEOUT_SECONDS=60
```

WAL files are archived to:

```text
$MINDORY_HOME/backups/postgres-wal
```

Create a PITR base backup:

```bash
mindory-installer pitr-backup --home ~/.mindory
mindory-installer pitr-backup --home ~/.mindory --label before-migration
```

This runs `pg_basebackup` inside the Postgres service, copies the tar-format
base backup under `$MINDORY_HOME/backups/<timestamp>-postgres-pitr-base`, writes
`pitr-manifest.json` and forces `pg_switch_wal()` so the archive path receives a
fresh WAL segment.

Stage a restore directory for a specific target time:

```bash
mindory-installer pitr-restore --home ~/.mindory \
  --backup ~/.mindory/backups/<pitr-dir> \
  --target-time 2026-05-22T12:00:00Z \
  --yes
```

The staged directory is written under `$MINDORY_HOME/backups/pitr-restore` with
`postgresql.auto.conf` containing `restore_command` and
`recovery_target_time`, plus `recovery.signal`. It does not overwrite live data.
To replace the local Compose Postgres data directory, pass
`--replace-live-data`; the installer stops Compose first and copies the current
`$MINDORY_HOME/data/postgres` to a timestamped backup before replacement.

Validate the scripted backup/restore path without starting Docker:

```bash
pnpm backup:validate
```

### Scheduled Backups

The scheduled backup runner is single-home aware and reads generated config from
`$MINDORY_HOME/config/.env`:

```env
MINDORY_BACKUP_SCHEDULE_ENABLED=true
MINDORY_BACKUP_SCHEDULE_INTERVAL_MINUTES=1440
MINDORY_BACKUP_RETENTION_COUNT=7
MINDORY_BACKUP_RETENTION_DAYS=30
MINDORY_BACKUP_INCLUDE_CONFIG=true
MINDORY_BACKUP_INCLUDE_POSTGRES=true
MINDORY_BACKUP_INCLUDE_OBJECTS=true
```

Run it from cron, systemd timer, launchd or a Windows scheduled task:

```bash
mindory-installer backup-schedule --home ~/.mindory
mindory-installer backup-schedule --home ~/.mindory --run-now --label manual-check
mindory-installer backup-schedule --home ~/.mindory --status
```

It writes:

- `$MINDORY_HOME/backups/scheduled-backup.lock`
- `$MINDORY_HOME/backups/scheduled-backup-health.json`
- `$MINDORY_HOME/logs/scheduled-backup.log`

Only one scheduled run executes at a time. A second runner reports
`already_running` without starting another backup. Retention deletes only
directories below `$MINDORY_HOME/backups` that contain a Mindory
`backup-manifest.json`, so active runtime directories such as
`$MINDORY_HOME/data/objects` are outside the deletion set.

### Encrypted Remote Backups

Create an encrypted archive from any runtime backup or PITR base backup before
copying it off host:

```bash
mindory-installer backup-archive --home ~/.mindory \
  --backup ~/.mindory/backups/<backup-dir> \
  --key-id local-2026-05 \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY"
```

The command writes a `.mindorybak` JSON archive under
`$MINDORY_HOME/backups`. It uses `aes-256-gcm`, a `scrypt-sha256` derived key
for passphrases, SHA-256 integrity metadata for every file and never stores the
raw `MINDORY_BACKUP_ENCRYPTION_KEY`.

Configure the remote S3-compatible backup target independently from RAW object
storage:

```env
MINDORY_REMOTE_BACKUP_ENABLED=true
MINDORY_BACKUP_ENCRYPTION_KEY_ID=local-2026-05
MINDORY_BACKUP_ENCRYPTION_KEY=base64:<32-byte-key>
MINDORY_REMOTE_BACKUP_S3_ENDPOINT=https://s3.example.test
MINDORY_REMOTE_BACKUP_S3_REGION=us-east-1
MINDORY_REMOTE_BACKUP_S3_BUCKET=mindory-backups
MINDORY_REMOTE_BACKUP_S3_ACCESS_KEY_ID=<access-key>
MINDORY_REMOTE_BACKUP_S3_SECRET_ACCESS_KEY=<secret-key>
MINDORY_REMOTE_BACKUP_S3_FORCE_PATH_STYLE=true
MINDORY_REMOTE_BACKUP_S3_PREFIX=mindory
```

Upload and download verify bucket access, object size and SHA-256 metadata:

```bash
mindory-installer backup-upload --home ~/.mindory --archive ~/.mindory/backups/<archive>.mindorybak
mindory-installer backup-download --home ~/.mindory --object-key mindory/<archive>.mindorybak
```

Decrypt and restore the archive to a staging backup directory before running
the normal restore command:

```bash
mindory-installer backup-restore-archive --home ~/.mindory \
  --archive ~/.mindory/backups/remote-downloads/<archive>.mindorybak \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY" \
  --yes
```

The restore step recreates the original `backup-manifest.json` or
`pitr-manifest.json` plus every archived file under
`$MINDORY_HOME/backups/decrypted`. Keep the encryption key outside the
repository and outside installer logs; losing it makes remote archives
unrecoverable.

### External S3 Object Streaming Backups

When `MINDORY_STORAGE_PROVIDER=s3`, RAW objects may live only in an external
S3-compatible bucket. Export an inventory without reading local object files:

```bash
mindory-installer s3-inventory --home ~/.mindory --prefix documents/ --page-size 1000
```

The inventory uses S3 ListObjectsV2 pagination, HEAD metadata reads and reports
object count, total bytes, pages and the last processed key.

Create an encrypted streaming archive:

```bash
mindory-installer s3-backup --home ~/.mindory \
  --prefix documents/ \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY" \
  --key-id local-2026-05
```

The archive is written as `.mindorys3bak` under `$MINDORY_HOME/backups`. Object
bodies are read as streams from S3, chunked into an encrypted
`ndjson-gzip-aes-256-gcm` payload and accompanied by SHA-256 verification data.
If a run is interrupted after a known key, resume with:

```bash
mindory-installer s3-backup --home ~/.mindory \
  --prefix documents/ \
  --resume-after-key documents/last-good-key \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY"
```

Restore objects and metadata into the configured S3-compatible bucket:

```bash
mindory-installer s3-restore --home ~/.mindory \
  --archive ~/.mindory/backups/<archive>.mindorys3bak \
  --key "$MINDORY_BACKUP_ENCRYPTION_KEY" \
  --yes
```

Restore verifies the archive ciphertext, plaintext, object SHA-256 values,
object counts and total bytes before reporting success.

## Generated State

The installer core can render, and installer execution can write:

- `$MINDORY_HOME/config/mindory.config.json`
- `$MINDORY_HOME/config/.env`
- `$MINDORY_HOME/config/initial-token.json`
- release Compose asset targets under `$MINDORY_HOME/install`

Runtime data remains under the single-home layout documented in
`docs/DEPLOYMENT.md`.
