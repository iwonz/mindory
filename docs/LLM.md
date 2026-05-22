# LLM SDK

`@mindory/llm` is the single runtime entrypoint for Mindory subsystems
that need model-backed capabilities. Current runtime use includes text
embeddings for document indexing/query-time semantic search, PDF/image OCR,
image vision captioning and audio ASR. The same module owns the role registry
for chat, text embeddings, image embeddings, OCR, ASR, vision captioning, face
detection, face recognition, image generation and audio generation.

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
| `text-embedding` | supported | `disabled`, `openai-compatible`, `ollama`, `local-http` | none | `local-command` |
| `chat` | supported | `disabled`, `openai-compatible`, `local-http` | none | `ollama`, `local-command` |
| `image-embedding` | experimental | `disabled` | `local-http` | `openai-compatible`, `ollama`, `local-command` |
| `vision-captioning` | experimental | `disabled` | `openai-compatible`, `local-http` | `ollama`, `local-command` |
| `ocr` | experimental | `disabled` | `openai-compatible`, `local-http` | `ollama`, `local-command` |
| `asr` | experimental | `disabled` | `openai-compatible`, `local-http` | `ollama`, `local-command` |
| `face-detection` | experimental | `disabled` | `local-http` | `openai-compatible`, `ollama`, `local-command` |
| `face-recognition` | experimental | `disabled` | `local-http` | `openai-compatible`, `ollama`, `local-command` |
| `image-generation` | future | `disabled` | none | `openai-compatible`, `ollama`, `local-http`, `local-command` |
| `audio-generation` | future | `disabled` | none | `openai-compatible`, `ollama`, `local-http`, `local-command` |

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
vision captioning and ASR.

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

`buildMindoryLlm(config).healthCheck("local-http")` checks `/health`.
`healthCheck("ollama")` checks Ollama `/api/tags`; this verifies that the
service is reachable without performing a model operation.

OCR, vision captioning and ASR remain experimental and require
`MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true` when enabled. The scanned-PDF
pipeline uses the local HTTP OCR contract for pages without native PDF text.
The image pipeline uses local HTTP OCR and vision captioning to derive
searchable OCR text, captions and labels without changing RAW originals.
The audio pipeline uses local HTTP ASR to derive searchable transcript segments
with time refs.

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
embedding/OCR/vision/ASR provider calls with `success` or `failed` status,
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
