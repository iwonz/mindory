# Installer

The installer is built in layers. The current implementation supports planning,
interactive answer collection, config rendering, dependency diagnostics,
bootstrap staging, prepare execution, Docker Compose startup through health
checks and dry-run/live acceptance checks. It can write the local
`$MINDORY_HOME` file layout, start the runtime and provision the first
project/token.

## Current Support Level

| Capability | Status |
| --- | --- |
| Interactive wizard | Supported. It collects and validates answers and shows a redacted summary. |
| Plan/dry-run | Supported. It renders deterministic install plans without mutating host state. |
| Config rendering | Supported in the installer core for generated `.env` and `mindory.config.json` content. |
| Prepare execution | Supported. It creates `$MINDORY_HOME`, writes generated config/env files and copies release Compose assets with journaled rollback. |
| Compose startup | Supported. It can pull/build, start infrastructure, run migrations, start API/worker/MCP and wait for Compose/API readiness. |
| First project/token provisioning | Supported. It creates the initial project and bearer token, then writes `config/initial-token.json`. |
| Dependency detection | Supported through injectable probes and diagnostics. |
| Lock, journal and recovery diagnostics | Supported. `repair` and `resume` inspect current state. |
| Bootstrap staging and checksum verification | Supported for source/release-style bundles. |
| Update, uninstall and real resume execution | Future work. Current surfaces are diagnostics/planning only. |

## Core Package

`@mindory/installer` owns:

- answer file types and validation;
- install plan generation;
- host dependency detection;
- transaction journal entries;
- reverse-order rollback execution;
- generated `.env` and `mindory.config.json` rendering;
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

Shell and PowerShell bootstrap scripts belong to the bootstrap task. Signal
handling, repair and resume logic belong to the recovery task.

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
```

The bootstrap verifies the bundle checksum before extraction. Signature
verification and release publication automation are future release hardening
work.

The bootstrap launches `bin/mindory-installer` when a packaged binary exists, or
falls back to `node packages/installer/dist/cli.js wizard` for source-style
bundles. The installer CLI currently supports `wizard`, `plan`/`dry-run`,
`prepare`, `start`, `render-defaults`, `repair` and `resume`. `prepare`
executes only the local file preparation steps. `start` additionally runs
Docker Compose pull/build, infrastructure startup, migrations, API/worker/MCP
startup, health checks and first project/token provisioning.

## Recovery Surface

The installer core can acquire an install lock at
`$MINDORY_HOME/install/install.lock`, persist a transaction journal at
`$MINDORY_HOME/install/install-journal.json` and format clear diagnostics for
dependency or execution failures.

The CLI exposes:

```bash
mindory-installer repair --home ~/.mindory
mindory-installer resume --home ~/.mindory
```

`repair` inspects lock and journal state. `resume` reports the stored journal
and makes clear that full resume execution is future work.

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

## Wizard Prompts

The wizard prompts for:

- install profile, home directory, dependency policy and public URL;
- antivirus mode;
- storage choice: local filesystem, LibreFS local S3 or external S3-compatible;
- document modality switches and video keyframe limit;
- independent LLM role enablement, provider, model, required mode, timeout,
  concurrency and embedding dimensions where applicable;
- API/MCP/Hermes interface switches and tokens.

Prompt labels, defaults, enum values, secret flags and resource hints come from
the config catalog whenever a catalog entry exists. Future or experimental LLM
roles are visible, but they cannot be enabled unless experimental mode is
enabled explicitly.

## Transaction Model

Every install action is planned before execution. The journal records planned,
completed, failed and rollback events. On failure, completed actions are rolled
back in reverse order when they expose a rollback step. Actions with no local
rollback are recorded as skipped so the diagnosis can tell the user what may
require manual cleanup. Prepare execution uses this model for filesystem,
config and Compose asset writes. Startup execution adds `compose_down` rollback
for started services. First-token provisioning writes a local credential file
with rollback for that file; database token rollback remains a future lifecycle
operation.

## Generated State

The installer core can render, and installer execution can write:

- `$MINDORY_HOME/config/mindory.config.json`
- `$MINDORY_HOME/config/.env`
- `$MINDORY_HOME/config/initial-token.json`
- release Compose asset targets under `$MINDORY_HOME/install`

Runtime data remains under the single-home layout documented in
`docs/DEPLOYMENT.md`.
