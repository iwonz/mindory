# Installer

The installer is built in layers. `TASK-58` adds the non-interactive core in
`@mindory/installer`; `TASK-59` adds the interactive wizard layer. Later tasks
add bootstrap scripts, failure recovery and full install acceptance.

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

The core package is deterministic and testable without mutating the host. It can
detect dependencies through an injectable probe, but it does not install Docker,
write files, start Compose or download releases.

The wizard is also testable without a terminal through injectable IO. A Node
readline adapter is available for real interactive use, but the wizard only
returns validated answers after showing a redacted confirmation summary.

Shell and PowerShell bootstrap scripts belong to the bootstrap task. Signal
handling, repair and resume logic belong to the recovery task.

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
require manual cleanup.

## Generated State

The installer core renders:

- `$MINDORY_HOME/config/mindory.config.json`
- `$MINDORY_HOME/config/.env`
- release Compose asset targets under `$MINDORY_HOME/install`

Runtime data remains under the single-home layout documented in
`docs/DEPLOYMENT.md`.
