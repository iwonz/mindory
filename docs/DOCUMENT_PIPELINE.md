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

Text and Markdown extraction are the currently implemented route. PDF, image,
audio and video can be enabled in configuration, but their handlers intentionally
skip as `processor_not_implemented` until the corresponding tasks add concrete
processors.

Processing status must be durable in PostgreSQL, not only in BullMQ.

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
  used by future filters.
- `face_identities` and `face_observations` keep face matching workspace-scoped.

This schema is designed so any derived run can be superseded and recomputed for
one document without changing the RAW object.

Original files must stay out of PostgreSQL. The future upload path should store
the blob through `ObjectStorage`, then persist only document metadata and the
storage key in the database.

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

The default route configuration is conservative:

- text: enabled, creates `document.extract`;
- PDF/image/audio/video: disabled until their processors exist;
- video keyframe limit: `10`.

Disabling a modality means no job is created for that file type. Enabling a
future modality before its processor exists records a skipped route with
`processor_not_implemented`; it does not enqueue a missing processor.

## Recompute Flow

`POST /v1/documents/:id/recompute` creates a durable `document.recompute` job.
The worker reads the RAW object only to calculate the source checksum, creates a
new `processing_run`, marks previous runs for the requested stage as
`superseded`, and then enqueues `document.route` with the new
`processing_run_id`.

The RAW storage key is not changed. Existing derived rows stay attached to their
old `processing_run`; the current run is the latest non-superseded version.
Current implemented stages are `all`, `route`, `text`, `pdf`, `image`, `audio`
and `video`, with only `text` reaching a concrete extractor today.

## Current Worker Processing

`@mindory/core/processing` defines the processing contracts. The built-in text
extractor supports plain text and Markdown inputs, and `FixedSizeTextChunker`
creates deterministic token windows with offset metadata.

Text embedding providers are selected through the shared
`@mindory/model-runtime` module. Low-level adapters exist for
OpenAI-compatible `/embeddings` APIs and Ollama `/api/embed`. `TASK-20` makes
pgvector the default MVP vector runtime: worker indexing upserts chunk
embeddings into `chunk_vector_embeddings`, and API document search uses query
embeddings plus pgvector when text embeddings are configured. Qdrant remains an
optional future adapter.

`TASK-19` adds `DocumentChunkRepository`, a Drizzle-backed chunk repository and
the worker processor registry. Clean scans enqueue routing, routing enqueues
extraction for text/Markdown documents, extraction writes derived text objects,
chunking replaces durable chunk rows, and embedding/index processors write
pgvector rows when text embeddings are configured. With
`MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED=false`, the pipeline
intentionally stops at `chunked` and API document search falls back to text
chunk search.

`TASK-31` adds strict indexed acceptance: with
`MINDORY_E2E_REQUIRE_INDEXED=true`, the live acceptance script waits for
`indexed` document status and verifies document search returns source-backed
chunk hits.
