# Configuration

All runtime configuration must be represented in `.env.example`. When an
environment variable is added, renamed or removed, update this document and
`.env.example` in the same task.

## Sections

- Mindory API log level, host, port and public URL.
- PostgreSQL database URL.
- Redis/BullMQ URL and prefixes.
- Object storage provider and local/S3 settings.
- Vector index provider and optional Qdrant settings.
- Antivirus policy and ClamAV connection settings.
- Worker type and concurrency.
- Embedding provider settings.
- MCP settings.
- Hermes adapter defaults.
- Integration test ports and optional external test service URLs.

## Docker Compose Defaults

`docker-compose.yml` interpolates the same `MINDORY_*` variables documented by
`.env.example` and provides matching defaults when `.env` is absent. For normal
self-hosted use, copy `.env.example` to `.env` and change values there.

The base Compose scaffold hardcodes the bundled Postgres service credentials to
match the default `MINDORY_DATABASE_URL`. External database configuration can be
introduced in a later task when the database package exists.

`MINDORY_LOG_LEVEL` controls Fastify structured logging in the API skeleton.
Sensitive request headers such as `authorization` are redacted by the logger
configuration.

## Object Storage

`MINDORY_STORAGE_PROVIDER` selects `local-fs` or `s3`. In `TASK-6`, `local-fs`
is implemented by `@mindory/storage-local-fs` and uses
`MINDORY_STORAGE_LOCAL_PATH` as its root directory. Object keys are always
treated as relative paths below that root.

The S3/MinIO settings are already represented in `.env.example`, but
`@mindory/storage-s3` is still a skeleton and does not perform network calls.

## Queue And Workers

`MINDORY_REDIS_URL` points BullMQ at Redis. `MINDORY_QUEUE_PREFIX` namespaces
queue keys. `MINDORY_WORKER_CONCURRENCY` controls the BullMQ worker concurrency
used by the worker base runner.

`MINDORY_WORKER_TYPE` is already represented for future worker filtering, but
TASK-7 does not register concrete processors yet.

## Embeddings And Vector Indexes

`MINDORY_EMBEDDINGS_PROVIDER` accepts `disabled`, `openai-compatible` or
`ollama`. `MINDORY_EMBEDDINGS_MODEL` names the provider model.
`MINDORY_EMBEDDINGS_DIMENSIONS` is optional and is passed to compatible
providers that support explicit dimensions.

`MINDORY_OPENAI_COMPATIBLE_BASE_URL` and
`MINDORY_OPENAI_COMPATIBLE_API_KEY` configure the OpenAI-compatible embeddings
adapter. `MINDORY_OLLAMA_BASE_URL` configures the Ollama adapter and defaults to
the Compose Ollama service URL.

`MINDORY_VECTOR_PROVIDER` accepts `pgvector` or `qdrant`. `pgvector` is the
default MVP runtime after `TASK-20`; Qdrant remains optional and profile-gated
in Compose.

## MCP

`MINDORY_MCP_ENABLED` enables the MCP app. `MINDORY_MCP_TRANSPORT` is currently
`stdio` only; `TASK-23` wires stdio through the MCP SDK.

`MINDORY_MCP_API_URL` points MCP tools at the Mindory HTTP API. In local host
usage it defaults to `http://localhost:3000`; in Docker Compose it defaults to
the internal API service URL `http://api:3000`. `MINDORY_MCP_API_TOKEN` is an
optional bearer token used by MCP HTTP calls.

## CLI

`MINDORY_CLI_API_URL` points the `mindory` CLI at the Mindory HTTP API and
defaults to `http://localhost:3000`. `MINDORY_CLI_API_TOKEN` is an optional
bearer token used by CLI HTTP calls. Both can be overridden per invocation with
`--api-url` and `--token`.

## Hermes Adapter

`MINDORY_HERMES_ADAPTER_ENABLED` records whether the Hermes adapter should be
enabled by a future runtime. `MINDORY_HERMES_API_URL` points the adapter at the
Mindory HTTP API. `MINDORY_HERMES_API_TOKEN` is an optional bearer token used by
adapter HTTP calls.

`MINDORY_HERMES_DEFAULT_PROJECT`, `MINDORY_HERMES_DEFAULT_USER_PEER` and
`MINDORY_HERMES_DEFAULT_AGENT_PEER` are fallbacks when a Hermes event does not
include an explicit project, user or agent identity. The adapter preserves
provided external user/session/agent ids as stable Mindory ids.

`MINDORY_HERMES_CONTEXT_TOKEN_BUDGET` controls the default token budget sent to
`/v1/context/build` before prompt construction.

## Integration Tests

`pnpm test` uses `MINDORY_TEST_POSTGRES_PORT` and
`MINDORY_TEST_REDIS_PORT` when it starts the isolated `mindory-test` Docker
Compose project. Defaults are `55432` and `56379`.

Set `MINDORY_TEST_DATABASE_URL` and `MINDORY_TEST_REDIS_URL` to point tests at
already-running services. Set `MINDORY_TEST_SKIP_DOCKER=true` in that mode so
the runner does not start Compose. `MINDORY_TEST_SKIP_BUILD=true` skips the
pre-test TypeScript build when a caller has already produced current `dist`
outputs. `MINDORY_TEST_DOCKER_BIN` can override the Docker binary path.

## Secret Handling

`.env.example` must remain safe to commit. It may contain non-secret defaults and
obvious placeholders, but never real credentials.
