# LLM SDK

`@mindory/llm` is the single runtime entrypoint for Mindory subsystems
that need model-backed capabilities. Current runtime use is text embeddings for
document indexing and query-time semantic search. The same module owns the role
registry for chat, text embeddings, image embeddings, OCR, ASR, vision
captioning, face detection, face recognition, image generation and audio
generation.

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
Use the `local-models` profile for a lightweight local LLM placeholder
or the `ollama` profile for a real Ollama service.

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

## Runtime Boundary

API and worker code call `buildMindoryLlm` or
`buildMindoryTextEmbeddingsProvider` from `@mindory/llm`.
Provider-specific packages remain low-level adapters; runtime packages must not
instantiate them directly.

## Docker Profiles

```bash
pnpm mvp:demo --model-profile disabled
pnpm mvp:demo --model-profile local
pnpm mvp:demo --model-profile ollama
```

- `disabled`: no heavy model service is started; multimodal demo fixtures still
  exercise routing, derived artifacts and search.
- `local`: adds the `local-models` profile and starts a lightweight
  `llm` placeholder on `MINDORY_LLM_LOCAL_HTTP_BASE_URL`.
- `ollama`: adds the `ollama` profile for local text embeddings. Configure a
  1536-dimensional embedding model before using strict indexed acceptance.
