# Configuration

All runtime configuration must be represented in `.env.example`. When an
environment variable is added, renamed or removed, update this document and
`.env.example` in the same task.

## Sections

- Mindory API log level, host, port, public URL and request guards.
- PostgreSQL database URL.
- Redis/BullMQ URL and prefixes.
- Object storage provider and local/S3 settings.
- Vector index provider and optional Qdrant settings.
- Antivirus policy and ClamAV connection settings.
- Worker type and concurrency.
- Document processing router and modality switches.
- Model runtime capability and provider settings.
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

## API Request Guards

`MINDORY_API_RATE_LIMIT_ENABLED` enables the API rate-limit guard. It defaults
to `true`.

`MINDORY_API_RATE_LIMIT_WINDOW_MS` controls the fixed window length in
milliseconds and defaults to `60000`.

`MINDORY_API_RATE_LIMIT_MAX` controls the maximum requests allowed per key in a
window and defaults to `600`.

The guard exempts `/health` and `/ready`, emits `x-ratelimit-*` headers and
returns structured `429 rate_limited` responses when the limit is exceeded. It
is intentionally in-process for the MVP; use a reverse proxy or load balancer
for global production limits.

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

## Document Processing Router

`MINDORY_DOCUMENT_PROCESSING_ROUTING_ENABLED` controls whether uploads enqueue
the `document.route` planning job after a clean scan or when antivirus is
disabled. It defaults to `true`.

Each modality has `MINDORY_DOCUMENT_PROCESSING_<TYPE>_ENABLED` and
`MINDORY_DOCUMENT_PROCESSING_<TYPE>_REQUIRED` settings. Current types are
`TEXT`, `PDF`, `IMAGE`, `AUDIO` and `VIDEO`. Text is enabled by default and
routes to the existing text extraction/chunking/indexing pipeline. PDF is
implemented for native text streams but remains disabled by default; set
`MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED=true` to route PDFs into
`document.extract`. Image semantic fallback extraction is implemented but also
disabled by default; set `MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED=true` to
route images into `document.extract`. Audio and video default to disabled until
their processors are implemented.

`MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES` sets the future video
keyframe cap and defaults to `10`.

## Model Runtime And Vector Indexes

`@mindory/model-runtime` owns model-backed capabilities. Each capability has an
independent `MINDORY_MODEL_RUNTIME_*_ENABLED`, `*_PROVIDER`, `*_MODEL` and
`*_REQUIRED` setting. Providers are `disabled`, `openai-compatible`, `ollama` or
`local`.

Text embeddings are currently the only capability that performs live model
calls. The image pipeline records OCR, image-captioning and image-embedding
capability state in derived artifacts, but the current MVP extractor uses a
deterministic metadata and embedded PNG text fallback until concrete vision/OCR
adapters are added.

Text embeddings are the only capability used for pgvector indexing today.
When `MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED=true`,
`MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_MODEL` is required. The current MVP
pgvector schema stores `vector(1536)`, so
`MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS` must be empty or `1536` while
`MINDORY_VECTOR_PROVIDER=pgvector`.

The default local/free model names are examples for future processors:
`CLIP ViT-L-16-SigLIP2-256__webli` for image embeddings,
`ESLAV__PP-OCRv5_mobile` for OCR and `buffalo_l` for face detection and
recognition. They remain disabled until the corresponding handlers are enabled.

`MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL` configures the
OpenAI-compatible adapter. `MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE`
accepts `none`, `api-key` or `oauth-bearer`.

OpenAI-compatible example:

```env
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED=true
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_PROVIDER=openai-compatible
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_MODEL=text-embedding-3-small
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS=1536
MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE=api-key
MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY=sk-...
```

OpenAI-compatible OAuth bearer example:

```env
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED=true
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_PROVIDER=openai-compatible
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_MODEL=text-embedding-3-small
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS=1536
MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE=oauth-bearer
MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN=<host-supplied-access-token>
```

The OAuth bearer mode consumes a token supplied by a host runtime such as Codex
or Hermes. Mindory does not perform an interactive OAuth login flow in the MVP.

`MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL` configures the Ollama adapter and
defaults to the Compose Ollama service URL. For the current pgvector MVP schema,
the selected Ollama model must also return 1536-dimensional vectors:

Ollama example:

```env
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED=true
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_PROVIDER=ollama
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_MODEL=<1536-dimensional-local-embedding-model>
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS=1536
MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL=http://ollama:11434
```

`MINDORY_VECTOR_PROVIDER` accepts `pgvector` or `qdrant`. `pgvector` is the
default MVP runtime after `TASK-20`; Qdrant remains optional and profile-gated
in Compose.

## MVP Acceptance

`MINDORY_E2E_LIVE=true` makes `pnpm mvp:acceptance` run against
`MINDORY_E2E_API_URL` or `http://localhost:3000`. By default the live flow
accepts either `chunked` or `indexed` document status so disabled embeddings
remain usable. Set `MINDORY_E2E_REQUIRE_INDEXED=true` when a text embedding provider is
configured and the acceptance run must prove pgvector indexing and semantic
document search.

## MCP

`MINDORY_MCP_ENABLED` enables the MCP app. `MINDORY_MCP_TRANSPORT` is currently
`stdio` only; `TASK-23` wires stdio through the MCP SDK.

`MINDORY_MCP_API_URL` points MCP tools at the Mindory HTTP API. In local host
usage it defaults to `http://localhost:3000`; in Docker Compose it defaults to
the internal API service URL `http://api:3000`. `MINDORY_MCP_API_TOKEN` is an
optional bearer token used by MCP HTTP calls.

Real MCP clients should launch the stdio process themselves with `node
apps/mcp/dist/stdio.js` or `pnpm --filter @mindory/mcp start`; see
`docs/MCP.md` for copyable client configuration examples.

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

`MINDORY_HERMES_CONTEXT_TOKEN_BUDGET` controls the default context budget used
by `preparePromptContext` and the runtime contract bridge before prompt
construction.

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

Production deployments must override all demo defaults that grant access or
protect state, including database credentials, Redis URLs, S3 credentials, model
provider keys or OAuth bearer tokens, MCP/CLI/Hermes API tokens and Mindory
bearer tokens.
Store production values in a secret manager or deployment secret store.
