# CLI

The CLI is a separate app/package. Product data commands call the Mindory HTTP
API and must not access PostgreSQL directly. Model diagnostic commands use the
central `@mindory/llm` SDK so operators can smoke-test configured providers
without creating product records.

## Current Boundary

`apps/cli` exposes the `mindory` binary. HTTP-backed commands do not access
PostgreSQL, Redis, object storage, vector indexes or worker internals directly.
The parser is dependency-free and intentionally small.

`mindory llm generate-image` and `mindory llm generate-audio` are local
diagnostic commands. They call only `@mindory/llm`, return status, MIME type,
byte length, SHA-256 and audit details, and print base64 media only when
`--include-bytes` is set.

## Commands

```bash
mindory project create <id> [--name <name>] [--description <text>]
mindory project get <id>
mindory project list

mindory token create --project <id> --permissions <csv> [--name <name>]
mindory token list --project <id> [--limit 20]
mindory token revoke <id> --project <id>
mindory token rotate <id> --project <id> [--expires-at <iso|null>]

mindory session create --project <id> [--title <text>] [--peer <id>]
mindory session get <id> --project <id>
mindory session list --project <id> [--limit 20]
mindory message add --session <id> --project <id> --peer <id> --text <text>
mindory message list --session <id> --project <id> [--limit 50]

mindory document upload <path> --project <id> [--mime-type <type>] [--title <text>]
mindory document status <id> --project <id>
mindory document reprocess <id> --project <id> [--stages text,pdf,image,audio,video]
mindory document runs <id> --project <id>
mindory document search --project <id> <query> [--limit 10] [--metadata-filter <json>]
mindory document read <id> --project <id>
mindory document list --project <id> [--status <status>] [--limit 20]

mindory artifact search --project <id> <query> [--artifact-type <csv>] [--span-type <csv>] [--metadata-filter <json>]
mindory search query --project <id> [query] [--target documents,artifacts,faces] [--artifact-type <csv>] [--span-type <csv>] [--metadata-filter <json>] [--face-status <csv>]

mindory face identities --project <id> [--status candidate] [--limit 20]
mindory face identity <id> --project <id>
mindory face observations --project <id> [--identity <id>] [--document <id>]
mindory face rename <id> --project <id> --label <text|null>
mindory face merge <source-id> --project <id> --target <target-id>

mindory memory remember --project <id> --source-ref <type:id> <text>
mindory memory recall --project <id> <query> [--limit 10]
mindory memory explain <id> --project <id>
mindory memory forget <id> --project <id>
mindory memory list --project <id> [--status active] [--limit 20]

mindory context build --project <id> [--session <id>] [--token-budget 3000] <query>

mindory jobs list --project <id> [--status <status>] [--limit 20]
mindory jobs get <id> --project <id>
mindory jobs retry <id> --project <id>

mindory llm generate-image <prompt> [--include-bytes]
mindory llm generate-audio <prompt> [--include-bytes]
```

Manual memory creation requires at least one `--source-ref <type:id>` argument
to keep memories evidence-backed.

The multimodal derived-state surface includes document reprocess/runs,
metadata-filtered document search, unified artifact search and face identity
operations. `mindory search query` combines document chunk, artifact span and
face observation search through `POST /v1/search`. `--metadata-filter` accepts
one JSON object per flag, matching the HTTP API filter shape.

## Configuration

The CLI reads:

```text
MINDORY_CLI_API_URL
MINDORY_CLI_API_TOKEN
MINDORY_LLM_* for local diagnostic model commands
```

Per-command overrides:

```bash
mindory --api-url http://localhost:3000 --token <token> memory recall --project homelab "workers"
```

Token creation returns the raw bearer token exactly once. Token list/revoke/
rotate responses expose metadata only, never token hashes. Rotation returns a
new raw bearer token and preserves the token's project permission scope.

Exit codes:

- `0`: success.
- `1`: unexpected CLI/runtime failure.
- `2`: usage error such as missing required flags.
- `3`: Mindory API returned an HTTP error.
- `4`: CLI could not reach the configured API.

`pnpm cli:smoke` runs a route-mapping smoke scenario with the injectable API
client and deterministic LLM generation conformance providers.
