# LLM SDK

`@mindory/llm` is the single runtime entrypoint for Mindory subsystems
that need model-backed capabilities. Current runtime use includes text
embeddings for document indexing/query-time semantic search, PDF/image OCR,
image vision captioning, audio ASR and image face detection/recognition. The
same module owns the role registry for chat, text embeddings, image embeddings,
OCR, ASR, vision captioning, face detection, face recognition, image generation
and audio generation.

## Capabilities

Every role is configured independently with:

- `*_ENABLED` to turn the capability on or off.
- `*_PROVIDER` with `disabled`, `openai-compatible`, `ollama`, `local-http` or
  `local-command`.
- `*_MODEL` for the model or local solution name.
- `*_REQUIRED` for future stage graph handling.
- `*_TIMEOUT_MS` and `*_CONCURRENCY` for runtime guardrails.

Text embeddings also support `*_DIMENSIONS`; with the current pgvector schema
this must be empty or `1536`.

The default local model names are examples, not mandatory services:

- image embeddings: `CLIP ViT-L-16-SigLIP2-256__webli`
- OCR: `ESLAV__PP-OCRv5_mobile`
- face detection and recognition: `buffalo_l`

Docker Compose keeps local model runners optional. The default MVP demo uses
disabled/non-blocking model capabilities and deterministic embedded fixtures.
Use the `local-models` profile for a lightweight deterministic local HTTP model
service or the `ollama` profile for a real Ollama service.

## Support Matrix

`@mindory/llm` exports the role/provider support matrix, and the config catalog
uses the same matrix for defaults, env metadata and installer gating.

| Role | Role status | Supported providers | Experimental providers | Future providers |
| --- | --- | --- | --- | --- |
| `text-embedding` | supported | `disabled`, `openai-compatible`, `ollama`, `local-http`, `local-command` | none | none |
| `chat` | supported | `disabled`, `openai-compatible`, `local-http`, `local-command` | none | `ollama` |
| `image-embedding` | experimental | `disabled` | `local-http`, `local-command` | `openai-compatible`, `ollama` |
| `vision-captioning` | experimental | `disabled` | `openai-compatible`, `local-http`, `local-command` | `ollama` |
| `ocr` | experimental | `disabled` | `openai-compatible`, `local-http`, `local-command` | `ollama` |
| `asr` | experimental | `disabled` | `openai-compatible`, `local-http`, `local-command` | `ollama` |
| `face-detection` | experimental | `disabled` | `local-http`, `local-command` | `openai-compatible`, `ollama` |
| `face-recognition` | experimental | `disabled` | `local-http`, `local-command` | `openai-compatible`, `ollama` |
| `image-generation` | experimental | `disabled` | `local-command` | `openai-compatible`, `ollama`, `local-http` |
| `audio-generation` | experimental | `disabled` | `local-command` | `openai-compatible`, `ollama`, `local-http` |

When a role or selected provider is not `supported`, the installer and config
validation require `MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true`. A disabled role
may keep an experimental or future default provider value because no model call
is made until the role is enabled.

## Configuration

```env
MINDORY_LLM_CHAT_ENABLED=false
MINDORY_LLM_CHAT_PROVIDER=disabled
MINDORY_LLM_CHAT_MODEL=
MINDORY_LLM_CHAT_REQUIRED=false
MINDORY_LLM_CHAT_TIMEOUT_MS=60000
MINDORY_LLM_CHAT_CONCURRENCY=1

MINDORY_LLM_TEXT_EMBEDDING_ENABLED=false
MINDORY_LLM_TEXT_EMBEDDING_PROVIDER=disabled
MINDORY_LLM_TEXT_EMBEDDING_MODEL=
MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=
MINDORY_LLM_TEXT_EMBEDDING_REQUIRED=false
MINDORY_LLM_TEXT_EMBEDDING_TIMEOUT_MS=60000
MINDORY_LLM_TEXT_EMBEDDING_CONCURRENCY=1

MINDORY_LLM_IMAGE_EMBEDDING_ENABLED=false
MINDORY_LLM_IMAGE_EMBEDDING_PROVIDER=local-http
MINDORY_LLM_IMAGE_EMBEDDING_MODEL=CLIP ViT-L-16-SigLIP2-256__webli

MINDORY_LLM_OCR_ENABLED=false
MINDORY_LLM_OCR_PROVIDER=local-http
MINDORY_LLM_OCR_MODEL=ESLAV__PP-OCRv5_mobile

MINDORY_LLM_FACE_DETECTION_ENABLED=false
MINDORY_LLM_FACE_DETECTION_PROVIDER=local-http
MINDORY_LLM_FACE_DETECTION_MODEL=buffalo_l
MINDORY_LLM_FACE_RECOGNITION_ENABLED=false
MINDORY_LLM_FACE_RECOGNITION_PROVIDER=local-http
MINDORY_LLM_FACE_RECOGNITION_MODEL=buffalo_l

MINDORY_LLM_VISION_CAPTIONING_ENABLED=false
MINDORY_LLM_IMAGE_GENERATION_ENABLED=false
MINDORY_LLM_AUDIO_GENERATION_ENABLED=false

MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL=
MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=none
MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY=
MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN=
MINDORY_LLM_OLLAMA_BASE_URL=http://ollama:11434
MINDORY_LLM_LOCAL_HTTP_BASE_URL=http://llm:8080
MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS=120000
MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND=
MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS=["healthcheck","--role","{role}","--model","{model}"]
MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND=
MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS=["operate","--role","{role}","--model","{model}","--operation","{operation}"]
MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES=16777216
MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES=67108864
```

## OpenAI-Compatible Auth

`MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE` accepts:

- `none` for local fake or unauthenticated OpenAI-compatible endpoints.
- `api-key` with `MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY`.
- `oauth-bearer` with `MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN`.

The OAuth mode expects the host runtime to supply an already-issued bearer
access token, for example from a Codex or Hermes integration. Mindory does not
run an interactive OAuth login flow; it consumes the supplied token and sends it
as `Authorization: Bearer ...`.

The OpenAI-compatible adapter currently implements chat completions and text
embeddings. Chat calls use `/chat/completions`; text embeddings use
`/embeddings`. Both API-key and OAuth bearer modes share the same centralized
auth configuration and audit path.

## Local HTTP Adapter

`MINDORY_LLM_LOCAL_HTTP_BASE_URL` configures an unauthenticated local model
service intended for trusted single-host or private-network deployments. It is
supported for `chat` and `text-embedding` roles and experimental for OCR,
vision captioning, ASR and face roles.

The local HTTP contract is intentionally small:

- `GET /health` returns any 2xx response when the model service is ready.
- `POST /chat/completions` accepts `{ model, messages, temperature, max_tokens }`
  and returns either OpenAI-compatible `choices[0].message.content` or a simple
  `{ text }` / `{ output }` body.
- `POST /embeddings` accepts `{ model, input, dimensions }` and returns either
  OpenAI-compatible `{ data: [{ index, embedding }] }` or `{ embeddings }`.
- `POST /ocr` accepts `{ model, mime_type, data_base64 }` and returns `{ text }`
  or `{ pages: [{ page_number, text, confidence }] }` for OCR-capable roles.
- `POST /vision/caption` accepts `{ model, mime_type, data_base64 }` and
  returns `{ caption, labels }` or `{ text, labels }` for image captioning.
- `POST /asr` accepts `{ model, mime_type, data_base64 }` and returns
  `{ text, segments }`, where each segment may include `segment_index`,
  `start_ms`, `end_ms` and `confidence`.
- `POST /faces/detect` and `POST /faces/recognize` accept
  `{ model, mime_type, data_base64 }` and return `{ faces }`, where each face
  includes a `bounding_box`, optional `embedding`, `confidence` and `label`.

`buildMindoryLlm(config).healthCheck("local-http")` checks `/health`.
`healthCheck("ollama")` checks Ollama `/api/tags`; this verifies that the
service is reachable without performing a model operation.

## Local Command Healthcheck

`local-command` roles use a command healthcheck before installer startup can
accept the configuration. Set:

```env
MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND=/usr/local/bin/mindory-model
MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS=["healthcheck","--role","{role}","--model","{model}"]
MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS=120000
```

The executable is launched directly without a shell. Path-like commands are
checked for executable permissions before launch; PATH-resolved command names
must still start successfully. `{role}` and `{model}` are rendered once for
each enabled `local-command` role.

The command must print one JSON object to stdout:

```json
{
  "status": "ok",
  "provider": "local-command",
  "role": "text-embedding",
  "model": "local-command-embedding",
  "diagnostics": {
    "ready": true
  }
}
```

Failure responses use the same role and model fields with `status: "failed"`,
`error_code` and `error_message`. Mindory validates the returned role/model,
timeout, exit status and JSON shape, then emits a model audit event with
duration and structured diagnostics.

Local-command model operations use `MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND`
with args rendered from `MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS`. The process
receives one JSON request on stdin:

```json
{
  "operation": "text_embeddings",
  "role": "text-embedding",
  "model": "local-command-embedding",
  "input": {
    "texts": ["semantic text"]
  }
}
```

The response is one JSON object on stdout:

```json
{
  "status": "ok",
  "role": "text-embedding",
  "model": "local-command-embedding",
  "output": {
    "embeddings": [[0.1, 0.2, 0.3]]
  },
  "usage": {
    "embedding_dimensions": 3
  }
}
```

Supported operation names are `chat`, `text_embeddings`, `image_embeddings`,
`ocr`, `asr`, `vision_caption`, `face_detection`, `face_recognition`,
`image_generation` and `audio_generation`. Binary inputs are passed as
`data_base64` plus `mime_type`; generated image/audio operations return
`data_base64` with `mime_type`. `MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES`
and `MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES` bound stdin and stdout/stderr.

OCR, vision captioning, ASR and face roles remain experimental and require
`MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true` when enabled. The scanned-PDF
pipeline uses the local HTTP OCR contract for pages without native PDF text.
The image pipeline uses local HTTP OCR and vision captioning to derive
searchable OCR text, captions and labels without changing RAW originals.
The audio pipeline uses local HTTP ASR to derive searchable transcript segments
with time refs.
The image pipeline uses local HTTP face detection/recognition to derive
workspace-scoped face observations with provider boxes and embeddings.

## Runtime Boundary

API and worker code call `buildMindoryLlm` or
`buildMindoryTextEmbeddingsProvider` from `@mindory/llm`.
Provider-specific packages remain low-level adapters; runtime packages must not
instantiate them directly.

Workers that need OCR, ASR, vision, face or future generation state use
`llmRoleState(runtime, role)` snapshots from the SDK registry. They should not
read `config.llm.<role>` directly except for non-operation plumbing such as the
current pgvector dimension guard.

## Operation Audit

`buildMindoryLlm` accepts an optional `auditSink` callback. The SDK calls it for
disabled role attempts through `disabledResult` and for current chat/text
embedding/OCR/vision/ASR/face provider calls with `success` or `failed` status,
role, provider, model, duration, usage details when available and optional
project/document/job/session refs. TASK-55 keeps this as an in-process hook;
durable audit persistence is future work.

## Docker Profiles

```bash
pnpm mvp:demo --model-profile disabled
pnpm mvp:demo --model-profile local
pnpm mvp:demo --model-profile ollama
```

- `disabled`: no heavy model service is started; multimodal demo fixtures still
  exercise routing, derived artifacts and search.
- `local`: adds the `local-models` profile, starts a lightweight deterministic
  `llm` service on `MINDORY_LLM_LOCAL_HTTP_BASE_URL`, and configures
  1536-dimensional local HTTP text embeddings for strict indexed acceptance.
- `ollama`: adds the `ollama` profile for local text embeddings. Configure a
  1536-dimensional embedding model before using strict indexed acceptance.
