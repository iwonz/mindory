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
- Scheduled backup interval, retention and component switches.
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
rollback-on-failure behavior, dev-mode flag, local model auto-install switch,
selected local runner ids and local model pull retry count.

The default installation root is `~/.mindory`. `@mindory/installer` uses the
catalog for answer validation, generated `.env` output and redacted summaries.
The installer wizard uses the same catalog for prompts rather than hardcoding
choices in installer code.

Local model installation is controlled by
`MINDORY_INSTALL_LOCAL_MODEL_AUTO_INSTALL`,
`MINDORY_INSTALL_LOCAL_MODEL_RUNNERS` and
`MINDORY_INSTALL_LOCAL_MODEL_PULL_RETRIES`. Selected supported runners are
validated against `LOCAL_MODEL_RUNNER_CATALOG`, contribute Compose profiles,
run resource preflight, write diagnostic logs under `$MINDORY_HOME/logs` and
must pass health checks before installer startup continues.

Docker Compose uses `MINDORY_HOME` on the host as the single Mindory-owned root.
If it is not set, Compose falls back to `${HOME}/.mindory`. Runtime state is
bound under this root:

- `config`
- `data/postgres`
- `data/redis`
- `data/objects`
- `data/librefs`
- `data/models`
- `data/ollama`
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

The base Compose file sets bundled Postgres service credentials to match the
default `MINDORY_DATABASE_URL`. Self-host deployments can override database and
Redis connection strings through generated `$MINDORY_HOME/config/.env`.

`MINDORY_LOG_LEVEL` controls Fastify structured logging in the API runtime.
Sensitive request headers such as `authorization` are redacted by the logger
configuration.

## Scheduled Backups

`MINDORY_BACKUP_SCHEDULE_ENABLED` enables the installer-managed local backup
runner. It defaults to `false`; run it from an external host scheduler with:

```bash
mindory-installer backup-schedule --home "$MINDORY_HOME"
```

`MINDORY_BACKUP_SCHEDULE_INTERVAL_MINUTES` controls the minimum interval between
successful scheduled runs. `MINDORY_BACKUP_RETENTION_COUNT` keeps the newest
matching backup sets and `MINDORY_BACKUP_RETENTION_DAYS` removes matching sets
older than the configured age. Retention only deletes directories under
`$MINDORY_HOME/backups` that contain a Mindory `backup-manifest.json`.

`MINDORY_BACKUP_INCLUDE_CONFIG`, `MINDORY_BACKUP_INCLUDE_POSTGRES` and
`MINDORY_BACKUP_INCLUDE_OBJECTS` control which runtime components scheduled
backups include. Health is written to
`$MINDORY_HOME/backups/scheduled-backup-health.json`, the lock lives at
`$MINDORY_HOME/backups/scheduled-backup.lock` and JSONL run logs are appended to
`$MINDORY_HOME/logs/scheduled-backup.log`.

`MINDORY_POSTGRES_WAL_ARCHIVE_ENABLED` controls the local Compose Postgres WAL
archive command. It defaults to `true` so point-in-time recovery can be used
after the first `pitr-backup` base backup. WAL files are archived under
`$MINDORY_HOME/backups/postgres-wal`.

`MINDORY_POSTGRES_WAL_ARCHIVE_TIMEOUT_SECONDS` controls the Postgres
`archive_timeout` value and defaults to `60`.

`MINDORY_REMOTE_BACKUP_ENABLED` enables installer-managed encrypted remote
backup settings. When enabled, Mindory requires:

- `MINDORY_BACKUP_ENCRYPTION_KEY_ID`
- `MINDORY_BACKUP_ENCRYPTION_KEY`
- `MINDORY_REMOTE_BACKUP_S3_ENDPOINT`
- `MINDORY_REMOTE_BACKUP_S3_REGION`
- `MINDORY_REMOTE_BACKUP_S3_BUCKET`
- `MINDORY_REMOTE_BACKUP_S3_ACCESS_KEY_ID`
- `MINDORY_REMOTE_BACKUP_S3_SECRET_ACCESS_KEY`
- `MINDORY_REMOTE_BACKUP_S3_FORCE_PATH_STYLE`
- `MINDORY_REMOTE_BACKUP_S3_PREFIX`

`MINDORY_BACKUP_ENCRYPTION_KEY` accepts either a passphrase or
`base64:<32-byte-key>`. The key is never written into generated summaries; losing
it makes existing `.mindorybak` archives unrecoverable. Remote backups use the
same S3-compatible adapter as object storage, but keep separate credentials and
prefixes so backup retention can be managed independently.

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

## Metrics Exporter

`MINDORY_METRICS_ENABLED=true` enables Prometheus-compatible metrics. The API
serves `MINDORY_METRICS_PATH`, default `/metrics`, on the API listener. The
worker starts a separate metrics listener on `MINDORY_METRICS_WORKER_HOST` and
`MINDORY_METRICS_WORKER_PORT`, default `0.0.0.0:3001`.

Set `MINDORY_METRICS_BEARER_TOKEN` to require `Authorization: Bearer <token>`
on both API and worker metrics endpoints. Keep the worker metrics port private
to the Prometheus network when the token is empty.

The exporter includes API request counters/durations, worker job and stage
counters/durations, BullMQ queue depth, model operation metrics, object storage
operation metrics and vector backend operation metrics. Labels intentionally
avoid project ids, document ids, raw prompts, bearer tokens and other
high-cardinality or secret values.

## OpenTelemetry Export

`MINDORY_OTEL_TRACES_ENABLED=true` enables OTLP HTTP trace export. Configure the
collector with `MINDORY_OTEL_EXPORTER_OTLP_ENDPOINT`; the default is
`http://localhost:4318/v1/traces`. `MINDORY_OTEL_SERVICE_NAME` defaults to
`mindory`, and API/worker append their runtime names. Use
`MINDORY_OTEL_EXPORTER_OTLP_HEADERS` for comma-separated headers such as
`x-api-key=value`; this value is treated as secret config.

`MINDORY_OTEL_SAMPLE_RATE` must be between `0` and `1`, and
`MINDORY_OTEL_EXPORT_TIMEOUT_MS` controls trace export timeout. Export failures
do not fail API requests or worker jobs.

`MINDORY_OTEL_LOG_EXPORT_ENABLED=true` enables OTLP structured log export.
Configure it with `MINDORY_OTEL_LOG_EXPORT_ENDPOINT`,
`MINDORY_OTEL_LOG_EXPORT_HEADERS` and `MINDORY_OTEL_LOG_EXPORT_TIMEOUT_MS`.
Shared observability helpers redact secret-like fields before trace/log export.

## Queue And Workers

`MINDORY_REDIS_URL` points BullMQ at Redis. `MINDORY_QUEUE_PREFIX` namespaces
queue keys. `MINDORY_WORKER_CONCURRENCY` controls the BullMQ worker concurrency
used by the worker base runner.

`MINDORY_WORKER_TYPE` identifies the worker role. The local runtime uses `all`
to register document and memory processors in one process.

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
defaults to `manifest`; set it to `ffmpeg` to extract PNG frames with the
bundled ffmpeg provider. `MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND`
and `MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND` select the runtime
executables. Set the provider to `local-command` with
`MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND`,
`MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_ARGS` and
`MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS` to run a custom
external keyframe extractor.

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
artifacts. The supported `mindory-image-semantics-v1` local runner also writes
object observations and image vectors through
`MINDORY_LLM_IMAGE_EMBEDDING_LOCAL_HTTP_BASE_URL` and
`MINDORY_LLM_VISION_CAPTIONING_LOCAL_HTTP_BASE_URL` when selected. When
`MINDORY_LLM_FACE_DETECTION_ENABLED=true`, the image extractor can call the
local HTTP face provider for boxes and embeddings. If no provider is enabled,
the fallback image extractor can derive face observations from explicit
people-count signals and match them through the workspace-scoped face subsystem.
Audio extraction can call the local HTTP ASR provider for transcript segments,
or derive transcript segments from embedded WAV `INFO/ICMT` text when ASR is
disabled.
Video extraction uses `MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES` to cap
manifest-derived, bundled ffmpeg or local-command keyframes; the default
remains `10`. The ffmpeg provider writes the RAW video bytes to a temporary
file, extracts frame PNGs without a shell, and removes the temporary files.
Local-command keyframe extraction is opt-in and parses a JSON manifest from
stdout without mutating the RAW video object.

The role/provider support matrix is centralized in `@mindory/llm` and the
config catalog. `chat` and `text-embedding` have supported OpenAI-compatible
and local HTTP adapters today; text embeddings also support Ollama. OCR,
vision, ASR, image embeddings, face roles and generation roles are supported
when configured with supported providers. Scanned-PDF OCR, image OCR, image
embeddings, image vision captioning, image object detection, audio ASR, image
face detection/recognition and image/audio generation are implemented through
supported local HTTP or local-command providers where the role supports them.
Image/audio generation also supports OpenAI-compatible API-key and OAuth bearer
modes. Any selected provider marked `experimental` requires
`MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true`, including answer-file and
non-interactive installer runs. Providers marked `future` are rejected by
validation.

Text embeddings index document chunks; image embeddings index `image_embedding`
artifacts for visual artifact search.
When `MINDORY_LLM_TEXT_EMBEDDING_ENABLED=true`,
`MINDORY_LLM_TEXT_EMBEDDING_MODEL` is required. The current MVP
pgvector schema stores `vector(1536)`, so text and image embedding dimensions
must be empty or `1536` while
`MINDORY_VECTOR_PROVIDER=pgvector`.

The default local/free model names are examples for provider configuration:
`CLIP ViT-L-16-SigLIP2-256__webli` for image embeddings,
`mindory-image-semantics-v1` for the supported local image semantic runner,
`tesseract-eng` for OCR and `buffalo_l` for face detection and recognition.
They remain disabled until the corresponding handlers are enabled.

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
service used by supported `chat`, text/image embedding, PDF/image OCR, image
vision captioning/object detection, audio ASR, image face and generation paths.
`MINDORY_LLM_IMAGE_EMBEDDING_LOCAL_HTTP_BASE_URL` and
`MINDORY_LLM_VISION_CAPTIONING_LOCAL_HTTP_BASE_URL` are image-specific
overrides used by the supported image semantics runner; when they are set,
image vector calls, caption calls and object detection calls use the dedicated
vision endpoint. `MINDORY_LLM_OCR_LOCAL_HTTP_BASE_URL` is an OCR-specific override used by the
supported Tesseract runner; when it is set, `@mindory/llm` sends only OCR calls
to that endpoint and keeps other local HTTP roles on
`MINDORY_LLM_LOCAL_HTTP_BASE_URL`.
`MINDORY_LLM_ASR_LOCAL_HTTP_BASE_URL` is the equivalent ASR-specific override
used by the supported Faster Whisper runner; when it is set, only ASR calls use
that endpoint.

Image semantics runner example:

```env
MINDORY_LLM_IMAGE_EMBEDDING_ENABLED=true
MINDORY_LLM_IMAGE_EMBEDDING_PROVIDER=local-http
MINDORY_LLM_IMAGE_EMBEDDING_MODEL=mindory-image-embedding-v1
MINDORY_LLM_IMAGE_EMBEDDING_DIMENSIONS=1536
MINDORY_LLM_VISION_CAPTIONING_ENABLED=true
MINDORY_LLM_VISION_CAPTIONING_PROVIDER=local-http
MINDORY_LLM_VISION_CAPTIONING_MODEL=mindory-vision-captioning-v1
MINDORY_LLM_IMAGE_EMBEDDING_LOCAL_HTTP_BASE_URL=http://vision:8082
MINDORY_LLM_VISION_CAPTIONING_LOCAL_HTTP_BASE_URL=http://vision:8082
MINDORY_IMAGE_SEMANTICS_PORT=8082
MINDORY_IMAGE_SEMANTICS_MODEL=mindory-image-semantics-v1
MINDORY_IMAGE_SEMANTICS_EMBEDDING_DIMENSIONS=1536
```

The service must answer `GET /health`, `POST /chat/completions`,
`POST /embeddings`, `POST /embeddings/images`, `POST /ocr`,
`POST /vision/caption`, `POST /vision/objects`, `POST /asr`,
`POST /faces/detect`, `POST /faces/recognize`, `POST /generation/image` and
`POST /generation/audio`; the SDK accepts OpenAI-compatible response shapes
plus simple `{ text }`, `{ output }`, `{ embeddings }`, OCR `{ pages }`, vision
`{ caption, labels }`, object `{ objects }`, ASR `{ text, segments }`, face
`{ faces }` and generated byte `{ data_base64, mime_type }` bodies.

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

Bundled ffmpeg video keyframe extraction uses:

```env
MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER=ffmpeg
MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND=ffmpeg
MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND=ffprobe
MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS=120000
```

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
local HTTP text embeddings, image embeddings, OCR, ASR, vision captioning and
face roles through `@mindory/llm`. Text and image embeddings use 1536
dimensions for the current pgvector schema. `ollama` adds the Ollama profile
for a real local text embedding runner.

For installer-managed OCR, selecting `tesseract-local-ocr` starts the
`local-models-ocr` Compose profile and sets
`MINDORY_LLM_OCR_LOCAL_HTTP_BASE_URL=http://ocr:8083`.
The runner-specific knobs are `MINDORY_OCR_PORT`, `MINDORY_OCR_MODEL`,
`MINDORY_OCR_LANG`, `MINDORY_OCR_PSM`, `MINDORY_OCR_TIMEOUT_MS`,
`MINDORY_OCR_MAX_PDF_PAGES` and `MINDORY_OCR_HEALTH_LOAD_MODEL`.

For installer-managed ASR, selecting `faster-whisper-tiny-asr` starts the
`local-models-asr` Compose profile and sets
`MINDORY_LLM_ASR_LOCAL_HTTP_BASE_URL=http://asr:8084`.
The runner-specific knobs are `MINDORY_ASR_PORT`, `MINDORY_ASR_MODEL`,
`MINDORY_ASR_DEVICE`, `MINDORY_ASR_COMPUTE_TYPE`, `MINDORY_ASR_LANGUAGE`,
`MINDORY_ASR_BEAM_SIZE`, `MINDORY_ASR_VAD_FILTER`,
`MINDORY_ASR_TIMEOUT_MS` and `MINDORY_ASR_HEALTH_LOAD_MODEL`.

## Web UI

`MINDORY_UI_HOST` and `MINDORY_UI_PORT` configure the `@mindory/ui` static
server. `MINDORY_UI_API_URL` configures the upstream Mindory API that the UI
server proxies under `/api`. The browser app defaults to `/api`, so local UI
usage does not require cross-origin API requests. Docker and installer
deployments default `MINDORY_UI_HOST=0.0.0.0`,
`MINDORY_UI_PORT=3080` and `MINDORY_UI_API_URL=http://api:3000`; source package
runs can leave the variable unset to use the package fallback
`http://localhost:3000`.

## MVP Acceptance

`MINDORY_E2E_LIVE=true` makes `pnpm mvp:acceptance` run against
`MINDORY_E2E_API_URL` or `http://localhost:3000`. By default the live flow
accepts either `chunked` or `indexed` document status so disabled embeddings
remain usable. Set `MINDORY_E2E_REQUIRE_INDEXED=true` when a text embedding provider is
configured and the acceptance run must prove pgvector indexing and semantic
document search. Set `MINDORY_E2E_EXPECT_MODEL_AUDIT_METRICS=true` only for the
live local-model acceptance gate when worker metrics are enabled and the run
must prove model-operation audit counters were exported.

`MINDORY_UI_E2E_LIVE=true` makes `pnpm ui:e2e` run a live Playwright browser
flow against `MINDORY_UI_E2E_URL` or `http://127.0.0.1:3080`. The flow seeds
the API through `MINDORY_E2E_API_URL`, defaulting to `http://127.0.0.1:3000`,
and uses `MINDORY_DEMO_TOKEN`/`MINDORY_DEMO_PROJECT_ID` for browser login. The
browser connects through `MINDORY_UI_E2E_BROWSER_API_URL`, defaulting to `/api`
so the UI proxy path is exercised. Set `MINDORY_UI_E2E_HEADLESS=false` for a
visible browser and `MINDORY_UI_E2E_BROWSER_EXECUTABLE` when Chromium is
installed outside Playwright's browser cache.

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

`.env.example` must remain safe to commit. It may contain non-secret defaults
and dummy example values, but never real credentials.

Production deployments must override all demo defaults that grant access or
protect state, including database credentials, Redis URLs, S3 credentials, model
provider keys or OAuth bearer tokens, MCP/CLI/Hermes API tokens and Mindory
bearer tokens.
Store production values in a secret manager or deployment secret store.
