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

## Catalog Entries

| ID | Roles | Provider | Status | Image or source | Ports | Healthcheck | Resource hint | License |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mindory-deterministic-local-http` | text embeddings, image embeddings, OCR, ASR, vision captioning, face detection, face recognition | `local-http` | supported | Mindory release image, `scripts/local-model-server.mjs` | `8080` | `GET /health` | 1 CPU, 256MB RAM, <100MB disk, no GPU | Apache-2.0 |
| `ollama-nomic-embed-text` | text embeddings | `ollama` | supported | `ollama/ollama:latest`, `nomic-embed-text` | `11434` | `GET /api/tags` | 2+ CPU, 4GB+ RAM, 1GB+ disk, optional GPU | Apache-2.0 model family; verify upstream model card before redistribution |
| `openclip-siglip2-image-embedding` | image embeddings | `local-http` | experimental | `https://github.com/mlfoundations/open_clip`, `timm/ViT-L-16-SigLIP2-256` | `8082` | `GET /health` | 4+ CPU, 8GB+ RAM, 5GB+ disk, GPU recommended | MIT runtime; verify upstream model card before redistribution |
| `paddleocr-pp-ocrv5-mobile` | OCR | `local-http` | experimental | `https://github.com/PaddlePaddle/PaddleOCR`, PP-OCRv5 mobile models | `8083` | `GET /health` | 2+ CPU, 4GB+ RAM, 1GB+ disk, optional GPU | Apache-2.0 |
| `faster-whisper-small-asr` | ASR | `local-http` | experimental | `https://github.com/SYSTRAN/faster-whisper`, `openai/whisper-small` | `8084` | `GET /health` | 4+ CPU, 6GB+ RAM, 3GB+ disk, GPU recommended for long audio | MIT |
| `moondream2-vision-captioning` | vision captioning | `local-http` | experimental | `https://huggingface.co/vikhyatk/moondream2` | `8085` | `GET /health` | 4+ CPU, 8GB+ RAM, 8GB+ disk, GPU recommended | Apache-2.0 |
| `compreface-face-services` | face detection, face recognition | `local-http` | experimental | `exadel/compreface:latest`, `https://github.com/exadel-inc/CompreFace` | `8086` | `GET /health` | 4+ CPU, 8GB+ RAM, 8GB+ disk, optional GPU | Apache-2.0 runtime; verify bundled model licenses before redistribution |

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

## Installer Auto-Install

The wizard records local model setup in these generated settings:

- `MINDORY_INSTALL_LOCAL_MODEL_AUTO_INSTALL`
- `MINDORY_INSTALL_LOCAL_MODEL_RUNNERS`
- `MINDORY_INSTALL_LOCAL_MODEL_PULL_RETRIES`

When auto-install is enabled, supported runner choices are shown with catalog
resource hints. Selecting `mindory-deterministic-local-http` enables the
`local-models` Compose profile and verifies the local HTTP service through
`GET /health`. Selecting `ollama-nomic-embed-text` enables the `ollama` profile,
waits for service health, runs `ollama pull nomic-embed-text`, then verifies
the model runner with `ollama list`.

Installer diagnostics are written under `$MINDORY_HOME/logs/local-model-install.log`
and the structured report lives at
`$MINDORY_HOME/install/local-models/install-report.json`. If a selected runner
fails preflight, pull/download or healthcheck, installation stops before
storage bootstrap and migrations continue.
