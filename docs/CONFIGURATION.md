# Configuration

`packages/config/src/catalog.ts` is the source of truth for Mindory
configuration. Every `MINDORY_*` setting must be represented in the catalog with
its env name, type, default, support status, installer visibility, secret flag
and prompt/resource metadata when applicable.

`.env.example` is generated from the catalog. When an environment variable is
added, renamed or removed, update the catalog and this document, then run
`pnpm config:generate`. `pnpm config:validate` fails if `.env.example` is stale
or if runtime, Compose or script code uses a `MINDORY_*` variable that is not in
the catalog.

`loadMindoryConfig` must read defaults from the catalog rather than duplicating
literal fallback values.

## Sections

- Mindory API log level, host, port, public URL and request guards.
- PostgreSQL database URL.
- Redis/BullMQ URL and prefixes.
- Object storage provider and local/S3 settings.
- Vector index provider and optional Qdrant settings.
- Antivirus policy and ClamAV connection settings.
- Worker type and concurrency.
- Document processing router and modality switches.
- LLM SDK role and provider settings.
- MCP settings.
- Hermes adapter defaults.
- Integration test ports and optional external test service URLs.

## Installer Foundation

`TASK-52` introduces installer configuration metadata before the installer
runtime exists. The cataloged installer settings include `MINDORY_HOME`,
install profile, release channel, experimental-mode flag, dependency policy,
rollback-on-failure behavior and dev-mode flag.

The default installation root is `~/.mindory`. `@mindory/installer` uses the
catalog for answer validation, generated `.env` output and redacted summaries.
Future wizard tasks must use the same catalog for prompts rather than hardcoding
choices in installer code.

Docker Compose uses `MINDORY_HOME` on the host as the single Mindory-owned root.
If it is not set, Compose falls back to `${HOME}/.mindory`. Runtime state is
bound under this root:

- `config`
- `data/postgres`
- `data/redis`
- `data/objects`
- `data/librefs`
- `logs`
- `backups`
- `install`

## Docker Compose Defaults

`docker-compose.yml` interpolates the same `MINDORY_*` variables documented by
`.env.example` and provides matching defaults when `.env` is absent. For normal
self-hosted use, copy `.env.example` to `.env` and change values there.

Compose services bind host directories from `MINDORY_HOME` instead of using
Docker named volumes. Deleting or moving `MINDORY_HOME` deletes or moves the
local Mindory runtime state; system dependencies and Docker itself are outside
that ownership boundary.

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

`MINDORY_STORAGE_PROVIDER` selects `local-fs` or `s3`. `local-fs` is implemented
by `@mindory/storage-local-fs` and uses `MINDORY_STORAGE_LOCAL_PATH` as its root
directory. Object keys are always treated as relative paths below that root.

`s3` is implemented by `@mindory/storage-s3` and is wired into the API and worker
runtimes. It uses the S3-compatible settings from `.env.example`: endpoint,
region, bucket, access key, secret key and path-style mode. The default endpoint
targets the Compose `librefs` profile. Path-style mode is the default so local
S3-compatible services such as LibreFS or MinIO can be used without wildcard
DNS.

Installer startup bootstraps local S3 buckets through the Compose
`librefs-bucket` or `minio-bucket` services when a local profile is selected.
For external S3-compatible endpoints, the installer signs `HEAD`/`PUT` bucket
requests through `@mindory/storage-s3` to verify credentials and create the
bucket when the endpoint permits it. Rollback and uninstall do not delete
external buckets.

## Antivirus

`MINDORY_AV_MODE` selects `disabled`, `async_quarantine` or `sync_scan`.
`async_quarantine` stores the upload, creates the document with
`scan_pending`, enqueues `document.scan` and only routes the document after a
clean worker verdict.

`sync_scan` is handled in the API upload path. The API stores the RAW object,
streams that object through the configured ClamAV daemon, applies
`MINDORY_AV_ON_INFECTED` and `MINDORY_AV_ON_SCAN_FAILURE`, then creates the
document with `scan_clean`, `quarantined`, `scan_infected` or `scan_failed`.
Only `scan_clean` and `scan_failed` with `allow_with_warning` enqueue
`document.route`.

`MINDORY_CLAMAV_HOST` and `MINDORY_CLAMAV_PORT` must point to a reachable clamd
socket when `sync_scan` or `async_quarantine` with the ClamAV worker is used.

`MINDORY_CLAMAV_HEALTH_RETRIES` and
`MINDORY_CLAMAV_HEALTH_TIMEOUT_MS` control installer startup health checks for
the Compose `clamav` service. The installer runs one clean scan probe and one
EICAR infected probe before it declares ClamAV healthy, so daemon connectivity,
scan protocol errors and missing infected-file detection are reported before API
startup is accepted.

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
`TEXT`, `PDF`, `IMAGE`, `AUDIO` and `VIDEO`. The local MVP defaults enable all
five routers so fixtures can flow through derived-artifact processing without
large model services. Disable individual modalities when a self-host profile
should not enqueue that media type.

`MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES` sets the video keyframe cap
and defaults to `10`. `MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER`
defaults to `manifest`; set it to `local-command` with
`MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND`,
`MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_ARGS` and
`MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS` to run an external
keyframe extractor.

## Docling Extraction Service

`MINDORY_DOCLING_ENABLED=true` routes PDF extraction through the
Docling-compatible HTTP service started by the `docling` Compose profile. The
worker calls `MINDORY_DOCLING_URL` with `MINDORY_DOCLING_TIMEOUT_MS`; the
service listens on `MINDORY_DOCLING_HOST` and `MINDORY_DOCLING_PORT`, and
exposes `/health` plus `POST /v1/extract`.

When Docling is disabled, the worker uses the in-process
`@mindory/extractor-docling` PDF extractor. Both paths produce the same derived
text/page artifact shape and never mutate RAW originals.

## LLM SDK And Vector Indexes

`@mindory/llm` owns model-backed roles. Each role has an independent
`MINDORY_LLM_*_ENABLED`, `*_PROVIDER`, `*_MODEL`, `*_REQUIRED`,
`*_TIMEOUT_MS` and `*_CONCURRENCY` setting. Providers are `disabled`,
`openai-compatible`, `ollama`, `local-http` or `local-command`.

Text embeddings, scanned-PDF OCR, image OCR, image vision captioning, audio
ASR and image face detection/recognition can perform live model calls through
`@mindory/llm` when their roles are enabled.
The image pipeline stores provider OCR text, captions and labels as derived
artifacts, and falls back to deterministic metadata plus embedded PNG text when
OCR or vision captioning is disabled. When
`MINDORY_LLM_FACE_DETECTION_ENABLED=true`, the image extractor can call the
local HTTP face provider for boxes and embeddings. If no provider is enabled,
the fallback image extractor can derive face observations from explicit
people-count signals and match them through the workspace-scoped face subsystem.
Audio extraction can call the local HTTP ASR provider for transcript segments,
or derive transcript segments from embedded WAV `INFO/ICMT` text when ASR is
disabled.
Video extraction uses `MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES` to cap
manifest-derived or local-command keyframes; the default remains `10`.
Local-command keyframe extraction is opt-in and parses a JSON manifest from
stdout without mutating the RAW video object.

The role/provider support matrix is centralized in `@mindory/llm` and the
config catalog. `chat` and `text-embedding` have supported OpenAI-compatible
and local HTTP adapters today; text embeddings also support Ollama. OCR,
vision, ASR, image embeddings and face roles are experimental; generation roles
are future. Scanned-PDF OCR, image OCR, image vision captioning, audio ASR and
image face detection/recognition are implemented through experimental local
HTTP providers. Any
enabled role or selected provider that is not
`supported` requires `MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true`, including
answer-file and non-interactive installer runs.

Text embeddings are the only capability used for pgvector indexing today.
When `MINDORY_LLM_TEXT_EMBEDDING_ENABLED=true`,
`MINDORY_LLM_TEXT_EMBEDDING_MODEL` is required. The current MVP
pgvector schema stores `vector(1536)`, so
`MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS` must be empty or `1536` while
`MINDORY_VECTOR_PROVIDER=pgvector`.

The default local/free model names are examples for future processors:
`CLIP ViT-L-16-SigLIP2-256__webli` for image embeddings,
`ESLAV__PP-OCRv5_mobile` for OCR and `buffalo_l` for face detection and
recognition. They remain disabled until the corresponding handlers are enabled.

`MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL` configures the
OpenAI-compatible adapter. `MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE`
accepts `none`, `api-key` or `oauth-bearer`.

OpenAI-compatible example:

```env
MINDORY_LLM_TEXT_EMBEDDING_ENABLED=true
MINDORY_LLM_TEXT_EMBEDDING_PROVIDER=openai-compatible
MINDORY_LLM_TEXT_EMBEDDING_MODEL=text-embedding-3-small
MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=1536
MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=api-key
MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY=sk-...
```

OpenAI-compatible OAuth bearer example:

```env
MINDORY_LLM_TEXT_EMBEDDING_ENABLED=true
MINDORY_LLM_TEXT_EMBEDDING_PROVIDER=openai-compatible
MINDORY_LLM_TEXT_EMBEDDING_MODEL=text-embedding-3-small
MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=1536
MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=oauth-bearer
MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN=<host-supplied-access-token>
```

The OAuth bearer mode consumes a token supplied by a host runtime such as Codex
or Hermes. Mindory does not perform an interactive OAuth login flow in the MVP.

`MINDORY_LLM_OLLAMA_BASE_URL` configures the Ollama adapter and
defaults to the Compose Ollama service URL. For the current pgvector MVP schema,
the selected Ollama model must also return 1536-dimensional vectors:

Ollama example:

```env
MINDORY_LLM_TEXT_EMBEDDING_ENABLED=true
MINDORY_LLM_TEXT_EMBEDDING_PROVIDER=ollama
MINDORY_LLM_TEXT_EMBEDDING_MODEL=<1536-dimensional-local-embedding-model>
MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=1536
MINDORY_LLM_OLLAMA_BASE_URL=http://ollama:11434
```

`MINDORY_LLM_LOCAL_HTTP_BASE_URL` configures the optional local HTTP model
service used by supported `chat` and `text-embedding` roles and by the
experimental PDF/image OCR, image vision captioning, audio ASR and image face
paths. The service must answer `GET /health`, `POST /chat/completions`,
`POST /embeddings`, `POST /ocr`, `POST /vision/caption`, `POST /asr`,
`POST /faces/detect` and `POST /faces/recognize`; the SDK accepts
OpenAI-compatible response shapes plus simple `{ text }`, `{ output }`,
`{ embeddings }`, OCR `{ pages }`, vision `{ caption, labels }`, ASR
`{ text, segments }` and face `{ faces }` bodies.

`MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND` and
`MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS` configure the executable preflight
for `local-command` providers. The args value is a JSON string array; `{role}`
and `{model}` are rendered for each enabled role. The command must print JSON
with `status`, `provider`, `role` and `model`, and
`MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS` bounds each healthcheck execution.
`MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND` and
`MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS` configure model calls. Operations
receive JSON on stdin and return JSON on stdout; `{operation}` is available in
args alongside `{role}` and `{model}`. `MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES`
and `MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES` bound operation stdin and
combined stdout/stderr.

Local-command video keyframe extraction uses its own command settings:

```env
MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER=local-command
MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND=/usr/local/bin/mindory-keyframes
MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_ARGS=["--input","{input}","--max","{maxKeyframes}"]
MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS=120000
```

The command must print a JSON object with `durationMs`, `codec` and `frames`.
Each frame must include `timestampMs` and `description`; optional `labels`,
`mime_type` and `data_base64` let Mindory run configured OCR/vision providers
on extracted frame bytes.

Runtime consumers must obtain operation providers and role snapshots from
`@mindory/llm`. Worker processors may receive simple capability snapshots, but
those snapshots are projected from the SDK registry rather than assembled from
`config.llm` in each consumer.

`@mindory/llm` also exposes an in-process `auditSink` hook. Current chat, text
embedding, OCR, vision captioning, ASR and face calls emit `success` or `failed`
audit records when the sink is provided; disabled role attempts emit `disabled`
records through
`disabledResult`. The runtime also exposes provider health checks for local HTTP
and Ollama services. Database-backed audit persistence is not part of this
task.

`MINDORY_VECTOR_PROVIDER` accepts `pgvector` or `qdrant`. `pgvector` is the
default runtime backend. `qdrant` selects `@mindory/vector-qdrant` for both
worker indexing and API document search. The Qdrant adapter supports collection
bootstrap, healthcheck, chunk upsert, delete and vector search with the same
project/document/chunk source refs. Run the Compose `qdrant` profile when
selecting Qdrant; the installer adds that profile automatically when
`MINDORY_VECTOR_PROVIDER=qdrant`.

`MINDORY_E2E_MODEL_PROFILE` controls `pnpm mvp:demo` model profile selection
when `--model-profile` is not passed. Supported values are `disabled`, `local`
and `ollama`. `disabled` is the default and starts no heavy model services.
`local` adds the lightweight `local-models` Compose service and configures
local HTTP text embeddings with 1536 dimensions. `ollama` adds the Ollama
profile for a real local model runner.

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
