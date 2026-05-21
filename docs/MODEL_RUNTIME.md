# Model Runtime

`@mindory/model-runtime` is the single runtime entrypoint for Mindory subsystems
that need model-backed capabilities. Current runtime use is text embeddings for
document indexing and query-time semantic search. The same module owns the
capability registry for OCR, ASR, image embeddings, image captioning, face
detection and face recognition before those processors are wired.

## Capabilities

Every capability is configured independently with:

- `*_ENABLED` to turn the capability on or off.
- `*_PROVIDER` with `disabled`, `openai-compatible`, `ollama` or `local`.
- `*_MODEL` for the model or local solution name.
- `*_REQUIRED` for future stage graph handling.

Text embeddings also support `*_DIMENSIONS`; with the current pgvector schema
this must be empty or `1536`.

The default local model names are examples, not mandatory services:

- image embeddings: `CLIP ViT-L-16-SigLIP2-256__webli`
- OCR: `ESLAV__PP-OCRv5_mobile`
- face detection and recognition: `buffalo_l`

## Configuration

```env
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED=false
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_PROVIDER=disabled
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_MODEL=
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS=
MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_REQUIRED=false

MINDORY_MODEL_RUNTIME_IMAGE_EMBEDDING_ENABLED=false
MINDORY_MODEL_RUNTIME_IMAGE_EMBEDDING_PROVIDER=local
MINDORY_MODEL_RUNTIME_IMAGE_EMBEDDING_MODEL=CLIP ViT-L-16-SigLIP2-256__webli

MINDORY_MODEL_RUNTIME_OCR_ENABLED=false
MINDORY_MODEL_RUNTIME_OCR_PROVIDER=local
MINDORY_MODEL_RUNTIME_OCR_MODEL=ESLAV__PP-OCRv5_mobile

MINDORY_MODEL_RUNTIME_FACE_DETECTION_ENABLED=false
MINDORY_MODEL_RUNTIME_FACE_DETECTION_PROVIDER=local
MINDORY_MODEL_RUNTIME_FACE_DETECTION_MODEL=buffalo_l
MINDORY_MODEL_RUNTIME_FACE_RECOGNITION_ENABLED=false
MINDORY_MODEL_RUNTIME_FACE_RECOGNITION_PROVIDER=local
MINDORY_MODEL_RUNTIME_FACE_RECOGNITION_MODEL=buffalo_l

MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL=
MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE=none
MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY=
MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN=
MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL=http://ollama:11434
MINDORY_MODEL_RUNTIME_LOCAL_BASE_URL=http://model-runtime:8080
```

## OpenAI-Compatible Auth

`MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE` accepts:

- `none` for local fake or unauthenticated OpenAI-compatible endpoints.
- `api-key` with `MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY`.
- `oauth-bearer` with `MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN`.

The OAuth mode expects the host runtime to supply an already-issued bearer
access token, for example from a Codex or Hermes integration. Mindory does not
run an interactive OAuth login flow; it consumes the supplied token and sends it
as `Authorization: Bearer ...`.

## Runtime Boundary

API and worker code call `buildMindoryModelRuntime` or
`buildMindoryTextEmbeddingsProvider` from `@mindory/model-runtime`.
Provider-specific packages remain low-level adapters; runtime packages must not
instantiate them directly.
