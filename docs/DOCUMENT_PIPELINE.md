# Document Pipeline

Documents are first-class entities. Uploaded files are stored in object storage,
then processed asynchronously.

`TASK-6` adds the object storage abstraction and adapters needed for original
file storage. `TASK-8` adds the document upload service and scan job flow.
`TASK-9` adds text/Markdown extraction, deterministic chunking, embedding
providers and vector index scaffolding. `TASK-19` registers those pieces in the
worker document pipeline. `TASK-38` adds the derived artifact schema that later
multimodal processors will write to. `TASK-39` adds the routing stage that
classifies uploaded files and creates only the enabled downstream jobs.
`TASK-40` adds recompute flow for derived state.
`TASK-41` moves the text pipeline onto the derived artifact model.
`TASK-42` adds typed attachment metadata indexing for search filters.
`TASK-43` adds PDF native text extraction on page-level artifacts.
`TASK-44` adds the first image semantic extraction path.
`TASK-46` adds the first audio transcript extraction path.
`TASK-47` adds the first video keyframe extraction path.

## MVP Pipeline

```text
upload
store original blob
scan
route by file type
extract text
chunk
embed
index
derive memory candidates
```

Text, Markdown, PDF native text, image semantic extraction, audio transcript
extraction and video keyframe extraction are the currently implemented routes.

Processing status must be durable in PostgreSQL, not only in BullMQ.

## Current Support Level

| Modality or stage | Status |
| --- | --- |
| Text and Markdown | Supported local MVP. Extracts text, chunks it, stores spans and can search through full-text or pgvector when embeddings are enabled. |
| Native-text PDF | Supported local MVP. Extracts page-level native text and source refs. |
| Scanned PDF OCR | Future model-backed work. OCR configuration is recorded, but no real OCR adapter runs by default. |
| Image | Supported deterministic fallback. Stores derived caption/analysis text from file metadata and embedded text signals. Future work adds real OCR, vision labels, image embeddings and object detection. |
| Face observations | Supported deterministic fallback only when explicit people-count signals are present. Future work adds real face detection and recognition adapters. |
| Audio | Supported deterministic fallback for WAV metadata and embedded `INFO/ICMT` transcript text. Future work adds real ASR. |
| Video | Supported deterministic fallback through embedded `MINDORY_VIDEO_MANIFEST`. Future work adds real ffmpeg keyframe extraction and frame bitmap artifacts. |
| Embeddings and vector search | Supported for text chunks through `@mindory/llm` and pgvector when a compatible 1536-dimensional provider is configured. Full-text fallback is supported when embeddings are disabled. |

## Derived Artifact State

RAW originals remain immutable in object storage. Post-upload processors write
only derived state:

- `processing_runs` records why a derived run happened, which processor/config
  version produced it and which original storage key/checksum it read.
- `document_artifacts` stores semantic outputs such as extracted text, OCR text,
  transcripts, captions, page artifacts and video keyframes.
- `document_artifact_text_spans` stores source-local text spans with optional
  page, frame, time and bounding-box coordinates.
- `document_media_metadata` and `document_metadata_index` store typed metadata
  used by structured metadata search filters.
- `face_identities` and `face_observations` keep face matching workspace-scoped.

This schema is designed so any derived run can be superseded and recomputed for
one document without changing the RAW object.

Original files stay out of PostgreSQL. Upload stores the blob through
`ObjectStorage`, then persists only document metadata and the storage key in the
database.

## Current TASK-8 Flow

The upload service flow is:

```text
receive upload
store blob through ObjectStorage
create Document metadata through DocumentRepository
if async_quarantine, enqueue document.scan through ProcessingJobDispatcher
otherwise enqueue document.route through ProcessingJobDispatcher
return Document, scan job and route job ids
```

`TASK-18` wires the API server runtime to local filesystem object storage,
`DocumentRepository`, `DbProcessingJobStore` and BullMQ dispatch. The bare app
factory still returns a structured `501` until concrete dependencies are
injected.

## Scan Processor

`@mindory/processor-antivirus-clamav` uses the clamd `INSTREAM` protocol. The
processor reads the original object by `storage_key`, scans it, then updates
document status:

- clean: `scan_clean`
- infected with quarantine policy: `quarantined`
- infected with delete policy: `scan_infected`
- scan failure with warning policy: `scan_failed`
- scan failure with block policy: `quarantined`

After a clean asynchronous scan, the processor enqueues `document.route` instead
of reaching directly into extraction. This keeps antivirus verdicts separate
from modality planning.

## Routing Stage

`@mindory/core/document-routing` classifies files by MIME type, extension and a
small magic-byte sample. The worker `document.route` processor records routing
metadata on the document and then enqueues only the supported, enabled
downstream jobs.

The bare runtime default route configuration is conservative:

- text: enabled, creates `document.extract`;
- PDF: disabled by default, creates `document.extract` when enabled;
- image: disabled by default, creates `document.extract` when enabled;
- audio: disabled by default, creates `document.extract` when enabled;
- video: disabled by default, creates `document.extract` when enabled;
- video keyframe limit: `10`.

Disabling a modality means no job is created for that file type. If a future
modality is added to configuration before its processor exists, routing records
a skipped route with `processor_not_implemented`; it does not enqueue a missing
processor.

For the local MVP path, `.env.example`, Docker Compose and `pnpm mvp:demo`
enable text, PDF, image, audio and video routers while keeping model-backed
capabilities disabled/non-blocking by default.

## Attachment Metadata Index

`document.route` reads the RAW object only to classify and derive metadata. It
does not rewrite or replace the original storage object. The route stage writes:

- `document_media_metadata` for media type, MIME, extension, checksum, container
  and best-effort header metadata such as image dimensions, PDF page count and
  WAV duration/codec.
- `document_metadata_index` typed rows for filterable fields including
  `size_bytes`, `mime_type`, `extension`, `checksum_sha256`, `media_type`,
  `container`, `duration_ms`, `width`, `height`, `page_count` and `codec`.

Search accepts structured metadata filters. Examples:

```json
{ "key": "size_bytes", "operator": "lte", "valueNumber": 104857600, "unit": "bytes" }
{ "key": "duration_ms", "operator": "between", "minNumber": 10000, "maxNumber": 15000, "unit": "ms" }
```

The PostgreSQL full-text fallback and pgvector search both enforce these
filters through `document_metadata_index`.

## PDF Processing

When `MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED=true`, routing sends PDF uploads
to `document.extract`. The `@mindory/extractor-docling` MVP extractor reads
native PDF text streams without mutating the RAW object. It writes:

- a top-level extracted text artifact;
- one `pdf_page` artifact per extracted page;
- one page-level `pdf_native_text` span per page with `page_number` metadata;
- chunk metadata and source refs that point back to overlapping page artifacts.

OCR configuration is recorded in extraction metadata. The default runtime keeps
OCR disabled. Scanned-PDF OCR is future model-backed work; native-text PDFs are
searchable now.

## Image Processing

When `MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED=true`, routing sends image
uploads to `document.extract`. The `@mindory/extractor-image-semantic` MVP
extractor reads the RAW object only to derive searchable metadata text and
artifact-backed spans. It writes:

- a top-level extracted text artifact;
- `image_caption` and `image_analysis` artifacts with text spans;
- an `image_embedding` artifact that records image-embedding capability state;
- an `ocr_text` artifact and span when embedded PNG `tEXt` metadata is present;
- `face_observation` artifacts and `face_observations` rows when face detection
  is enabled and the fallback extractor can infer people count;
- chunk metadata and source refs that point back to semantic image artifacts.

The current extractor is deterministic and does not call cloud or local vision
models. It records configured OCR, vision-captioning and image-embedding
capability state from `@mindory/llm` so a future concrete adapter can replace
derived outputs without changing RAW originals.

When face detection is enabled, the same fallback extractor can create
workspace-scoped face observations from explicit people-count signals in the
filename or embedded image text. The worker records deterministic
512-dimensional face embeddings, auto-matches them against existing project
observations through `FaceService`, creates candidate identities when no match
reaches the threshold and keeps the RAW image unchanged.

## Audio Processing

When `MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED=true`, routing sends audio
uploads to `document.extract`. The `@mindory/extractor-audio-transcript` MVP
extractor reads WAV metadata and embedded RIFF `INFO/ICMT` transcript text
without mutating the RAW object. It writes:

- a top-level extracted text artifact;
- a `transcript` artifact with transcript text;
- time-coded `transcript_segment` spans with `start_ms` and `end_ms` metadata;
- chunk metadata and source refs that point back to transcript artifacts and
  time ranges.

The default runtime records ASR capability state from `@mindory/llm`.
Real cloud/local ASR execution is future adapter work; current local tests use
deterministic embedded transcript fallback text.

## Video Processing

When `MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED=true`, routing sends video
uploads to `document.extract`. The `@mindory/extractor-video-keyframe` MVP
extractor reads an embedded `MINDORY_VIDEO_MANIFEST` fallback and respects
`MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES`, default `10`. It writes:

- a top-level extracted text artifact containing keyframe descriptions;
- one `video_keyframe` artifact per selected frame;
- one `video_keyframe_description` span per frame with `frame_index` and
  `timestamp_ms` metadata;
- chunk metadata and source refs that point back to keyframe artifacts.

The route stage can index fallback video `duration_ms`, `codec` and
`frame_count` metadata from the manifest. Real ffmpeg keyframe extraction and
bitmap storage are future adapter work; current tests use deterministic
manifest-derived frame descriptions.

## Recompute Flow

`POST /v1/documents/:id/recompute` creates a durable `document.recompute` job.
The worker reads the RAW object only to calculate the source checksum, creates a
new `processing_run`, marks previous runs for the requested stage as
`superseded`, and then enqueues `document.route` with the new
`processing_run_id`.

The RAW storage key is not changed. Existing derived rows stay attached to their
old `processing_run`; the current run is the latest non-superseded version.
Current implemented stages are `all`, `route`, `text`, `pdf`, `image`, `audio`
and `video`, with all listed stages reaching concrete extractors when enabled.

## Current Worker Processing

`@mindory/core/processing` defines the processing contracts. The built-in text
extractor supports plain text and Markdown inputs, `@mindory/extractor-docling`
supports native-text PDF inputs, `@mindory/extractor-image-semantic` supports
image semantic fallback extraction, `@mindory/extractor-audio-transcript`
supports embedded-transcript audio fallback extraction,
`@mindory/extractor-video-keyframe` supports manifest-derived keyframe
fallback extraction, and `FixedSizeTextChunker` creates
deterministic token windows with offset metadata. Text/PDF/image extraction
writes a `text` artifact plus an `extracted_text` span; PDF extraction also
writes `pdf_page` artifacts and page-level spans; image extraction also writes
semantic image artifacts, spans and optional face observation artifacts.
Audio extraction also writes transcript artifacts and time-coded segment spans.
Video extraction writes keyframe artifacts and frame description spans.
Chunking writes one child `text` artifact
and one `text_chunk` span per chunk. Legacy `chunks` rows remain the
compatibility table for context and embeddings, but their metadata points back
to `processing_run_id`, `text_artifact_id`, chunk `artifact_id`, page artifact
ids when applicable, semantic artifact ids when applicable and artifact source
refs.

Text embedding providers are selected through the shared
`@mindory/llm` module. Low-level adapters exist for
OpenAI-compatible `/embeddings` APIs and Ollama `/api/embed`. `TASK-20` makes
pgvector the default MVP vector runtime: worker indexing upserts chunk
embeddings into `chunk_vector_embeddings`, and API document search uses query
embeddings plus pgvector when text embeddings are configured. Qdrant remains an
optional future adapter.

When embeddings are disabled, document search uses PostgreSQL full-text search
over `document_artifact_text_spans` and ignores artifacts attached to
`superseded` processing runs. Search hits include source refs for the chunk,
artifact and processing run.

`POST /v1/artifacts/search` searches the same derived text span store directly
across artifact types. It is the unified MVP search surface for OCR text,
transcripts, captions, video keyframe descriptions and face observation spans,
with source refs and source positions returned per hit.

`TASK-19` adds `DocumentChunkRepository`, a Drizzle-backed chunk repository and
the worker processor registry. Clean scans enqueue routing, routing enqueues
extraction for text/Markdown/PDF/image/audio/video documents when the modality is enabled,
extraction writes derived text objects, chunking replaces durable chunk rows,
and embedding/index processors write pgvector rows when text embeddings are
configured. With
`MINDORY_LLM_TEXT_EMBEDDING_ENABLED=false`, the pipeline
intentionally stops at `chunked` and API document search falls back to text
chunk search.

`TASK-49` makes those worker transitions observable through job stage graph
metadata. Route jobs record skipped or disabled modality handlers, scan-blocked
documents return `blocked_by_scan`, required skipped stages can surface
`partial_failed`, and each processor can report stage progress and child jobs in
the Jobs API `details` response.

`TASK-75` keeps strict indexed acceptance self-contained for local testing:
`pnpm mvp:demo --model-profile local --require-indexed` starts the deterministic
local HTTP embedding service, waits for `indexed` document status and verifies
document search returns source-backed chunk hits.
