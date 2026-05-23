# Local Model Install Catalog

`LOCAL_MODEL_RUNNER_CATALOG` in `@mindory/config` is the canonical metadata
source for local model runner choices. The installer resolves supported
local model Compose profiles from this catalog instead of hardcoded role/model
lists, and the installer auto-install flow uses the same catalog for prompts,
resource preflight, service health checks and model pulls.

Each catalog entry records:

- LLM roles served by the runner;
- provider contract: `local-http`, `ollama` or `local-command`;
- Compose profile and service name;
- container image when one is already the runtime image, otherwise source URL;
- model files and target storage path under `MINDORY_HOME`;
- license/status, ports, healthcheck and resource hints.

## v0.1.1 Supported Runtime Target

`v0.1.0` is historical and stale relative to the current `master` baseline.
The `TASK-133` through `TASK-147` series targets `v0.1.1` with checked local
runner paths for OCR, ASR, vision captioning, object detection, image
embeddings, face detection, face recognition, image generation and audio
generation. OCR is supported through Tesseract, ASR is supported through Faster
Whisper, image caption/object/vector processing is supported through the
Mindory local image semantics runner, and face detection/recognition is
supported through the Mindory local face runner. Image/audio generation runner
profiles are tracked by their own implementation tasks before they appear in
the install catalog.

## Catalog Entries

| ID | Roles | Provider | Status | Image or source | Ports | Healthcheck | Resource hint | License |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mindory-deterministic-local-http` | text embeddings, image embeddings, OCR, ASR, vision captioning, face detection, face recognition | `local-http` | supported | Mindory release image, `scripts/local-model-server.mjs` | `8080` | `GET /health` | 1 CPU, 256MB RAM, <100MB disk, no GPU | Apache-2.0 |
| `ollama-nomic-embed-text` | text embeddings | `ollama` | supported | `ollama/ollama:latest`, `nomic-embed-text` | `11434` | `GET /api/tags` | 2+ CPU, 4GB+ RAM, 1GB+ disk, optional GPU | Apache-2.0 model family; verify upstream model card before redistribution |
| `mindory-image-semantics-v1` | image embeddings, vision captioning | `local-http` | supported | Mindory image semantics adapter image built from `deploy/local-models/vision/image-semantics/Dockerfile` | `8082` | `GET /health` with sample caption/object/vector pass | 2+ CPU, 2GB+ RAM, 1GB+ disk, no GPU | Apache-2.0 |
| `tesseract-local-ocr` | OCR | `local-http` | supported | Mindory Tesseract adapter image built from `deploy/local-models/ocr/tesseract/Dockerfile`, `tesseract-ocr-eng` language data | `8083` | `GET /health` with language verification | 2+ CPU, 4GB+ RAM, 1GB+ disk, optional GPU | Apache-2.0 |
| `faster-whisper-tiny-asr` | ASR | `local-http` | supported | Mindory Faster Whisper adapter image built from `deploy/local-models/asr/faster-whisper/Dockerfile`, `Systran/faster-whisper-tiny.en` | `8084` | `GET /health` with model loading | 4+ CPU, 4GB+ RAM, 1GB+ disk, GPU recommended for long audio | MIT runtime; verify upstream model card before redistribution |
| `mindory-local-face-v1` | face detection, face recognition | `local-http` | supported | Mindory local face adapter image built from `deploy/local-models/face/local-face/Dockerfile` | `8086` | `GET /health` with sample detection/recognition pass | 2+ CPU, 2GB+ RAM, 1GB+ disk, no GPU | Apache-2.0 for Mindory runner; OpenCV Apache-2.0 runtime cascade |

## Role Coverage

The catalog covers all local-model roles needed by the document pipeline:

- `TEXT_EMBEDDING`
- `IMAGE_EMBEDDING`
- `OCR`
- `ASR`
- `VISION_CAPTIONING`
- `FACE_DETECTION`
- `FACE_RECOGNITION`

`pnpm local-models:validate` verifies this coverage, checks each runner has
source or image metadata, model files, port and healthcheck details, resource
hints and documentation coverage. `pnpm local-model-profiles:validate` checks
that supported catalog runners have matching Compose profiles, installer
profile resolution and runtime healthchecks.

`pnpm local-model:acceptance` is the CI-safe local-model acceptance gate. By
default it dry-runs the supported deterministic profile wiring: MVP scenario
coverage, local HTTP role environment, `@mindory/llm` audit coverage, worker
audit sinks and this documentation.

To run the live multimodal gate with Docker:

```bash
MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE=true pnpm local-model:acceptance
```

Live mode uses a temporary `MINDORY_HOME` and starts
`pnpm mvp:demo --model-profile local --require-indexed`. It verifies text
embedding/indexing, PDF and image OCR, image caption/search, audio ASR,
video keyframe artifacts, face observations/identities, source refs, jobs,
unified face search and worker model-operation metrics. Use
`MINDORY_LOCAL_MODEL_ACCEPTANCE_TIMEOUT_MS=<milliseconds>` when image builds or
Docker startup need more than the default timeout.

The OCR runner has its own live gate because Tesseract image build and model
download are heavier than the deterministic local profile:

```bash
MINDORY_LOCAL_OCR_ACCEPTANCE_LIVE=true pnpm local-model:acceptance
```

That gate starts the `local-models-ocr` Compose profile, waits for the
Tesseract `/health` response, posts generated image and PDF fixtures to
`POST /ocr`, and requires non-empty OCR page text.

The ASR runner also has a focused live gate because Faster Whisper downloads
and loads model weights during health checks:

```bash
MINDORY_LOCAL_ASR_ACCEPTANCE_LIVE=true pnpm local-model:acceptance
```

That gate starts the `local-models-asr` Compose profile, waits for the
Faster Whisper `/health` response, generates a local `espeak-ng` speech fixture
inside the runner container, posts it to `POST /asr`, requires non-empty
time-coded transcript segments, and verifies invalid audio produces an
`asr_failed` diagnostic.

The image semantics runner has a focused live gate for caption, object and
vector contracts:

```bash
MINDORY_LOCAL_VISION_ACCEPTANCE_LIVE=true pnpm local-model:acceptance
```

That gate starts the `local-models-vision` Compose profile, waits for the
image semantics `/health` response, creates a generated color-shape image
fixture inside the runner container, posts it to `POST /vision/caption`,
`POST /vision/objects` and `POST /embeddings/images`, requires caption labels,
object bounding boxes and a 1536-dimensional image vector, and verifies invalid
image bytes produce a `vision_failed` diagnostic.

The local face runner has a focused live gate for detection and recognition:

```bash
MINDORY_LOCAL_FACE_ACCEPTANCE_LIVE=true pnpm local-model:acceptance
```

That gate starts the `local-models-face` Compose profile, waits for the local
face `/health` response, creates a generated face fixture inside the runner
container, posts it to `POST /faces/detect` and `POST /faces/recognize`,
requires bounding boxes, 512-dimensional face embeddings and deterministic
identity ids, and verifies invalid image bytes produce a
`face_detection_failed` diagnostic.

## Installer Auto-Install

The wizard records local model setup in these generated settings:

- `MINDORY_INSTALL_LOCAL_MODEL_AUTO_INSTALL`
- `MINDORY_INSTALL_LOCAL_MODEL_RUNNERS`
- `MINDORY_INSTALL_LOCAL_MODEL_PULL_RETRIES`

When auto-install is enabled, supported runner choices are shown with catalog
resource hints. Selecting `mindory-deterministic-local-http` enables the
`local-models` Compose profile and verifies the local HTTP service through
`GET /health`. Selecting `tesseract-local-ocr` enables
`local-models-ocr`, sets `MINDORY_LLM_OCR_LOCAL_HTTP_BASE_URL=http://ocr:8083`,
waits for the Tesseract healthcheck and routes PDF/image OCR through
`@mindory/llm`. Selecting `faster-whisper-tiny-asr` enables
`local-models-asr`, sets `MINDORY_LLM_ASR_LOCAL_HTTP_BASE_URL=http://asr:8084`,
waits for Faster Whisper model-loading health, and routes audio ASR through
`@mindory/llm`. Selecting `mindory-image-semantics-v1` enables
`local-models-vision`, sets
`MINDORY_LLM_IMAGE_EMBEDDING_LOCAL_HTTP_BASE_URL=http://vision:8082` and
`MINDORY_LLM_VISION_CAPTIONING_LOCAL_HTTP_BASE_URL=http://vision:8082`, waits
for image semantics health and routes image vectors, captions and object
observations through `@mindory/llm`. Selecting `ollama-nomic-embed-text` enables the `ollama`
profile, waits for service health, runs `ollama pull nomic-embed-text`, then
verifies the model runner with `ollama list`.
Selecting `mindory-local-face-v1` enables `local-models-face`, sets
`MINDORY_LLM_FACE_DETECTION_LOCAL_HTTP_BASE_URL=http://faces:8086` and
`MINDORY_LLM_FACE_RECOGNITION_LOCAL_HTTP_BASE_URL=http://faces:8086`, waits for
local face health and routes face boxes, embeddings and recognition ids through
`@mindory/llm`.

Installer diagnostics are written under `$MINDORY_HOME/logs/local-model-install.log`
and the structured report lives at
`$MINDORY_HOME/install/local-models/install-report.json`. If a selected runner
fails preflight, pull/download or healthcheck, installation stops before
storage bootstrap and migrations continue.
