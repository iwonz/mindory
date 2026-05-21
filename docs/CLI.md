# CLI

The CLI is a separate app/package and must call the Mindory HTTP API. It must not
access PostgreSQL directly.

## Current Boundary

`TASK-12` adds a bootstrap CLI in `apps/cli`. `TASK-24` hardens it for MVP
acceptance. It exposes the `mindory` binary and calls the HTTP API. It does not
access PostgreSQL, Redis, object storage, vector indexes or worker internals
directly.

The current parser is dependency-free and intentionally minimal until a later
task installs a CLI framework.

## Commands

```bash
mindory project create <id> [--name <name>] [--description <text>]
mindory project get <id>
mindory project list

mindory token create --project <id> --permissions <csv> [--name <name>]

mindory session create --project <id> [--title <text>] [--peer <id>]
mindory session get <id> --project <id>
mindory session list --project <id> [--limit 20]
mindory message add --session <id> --project <id> --peer <id> --text <text>
mindory message list --session <id> --project <id> [--limit 50]

mindory document upload <path> --project <id> [--mime-type <type>] [--title <text>]
mindory document status <id> --project <id>
mindory document search --project <id> <query> [--limit 10]
mindory document read <id> --project <id>
mindory document list --project <id> [--status <status>] [--limit 20]

mindory memory remember --project <id> --source-ref <type:id> <text>
mindory memory recall --project <id> <query> [--limit 10]
mindory memory explain <id> --project <id>
mindory memory forget <id> --project <id>
mindory memory list --project <id> [--status active] [--limit 20]

mindory context build --project <id> [--session <id>] [--token-budget 3000] <query>

mindory jobs list --project <id> [--status <status>] [--limit 20]
mindory jobs get <id> --project <id>
mindory jobs retry <id> --project <id>
```

Manual memory creation requires at least one `--source-ref <type:id>` argument
to keep memories evidence-backed.

## Configuration

The CLI reads:

```text
MINDORY_CLI_API_URL
MINDORY_CLI_API_TOKEN
```

Per-command overrides:

```bash
mindory --api-url http://localhost:3000 --token <token> memory recall --project homelab "workers"
```

Token creation still targets a planned HTTP endpoint. The other listed MVP
commands call implemented API route surfaces when the server runtime is wired.

Exit codes:

- `0`: success.
- `1`: unexpected CLI/runtime failure.
- `2`: usage error such as missing required flags.
- `3`: Mindory API returned an HTTP error.
- `4`: CLI could not reach the configured API.

`pnpm cli:smoke` runs a route-mapping smoke scenario with the injectable API
client. Live API acceptance remains part of the end-to-end MVP hardening task.
