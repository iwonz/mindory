# Document Pipeline

Documents are first-class entities. Uploaded files are stored in object storage,
then processed asynchronously.

`TASK-6` adds the object storage abstraction and adapters needed for original
file storage. `TASK-8` adds the document upload service and scan job flow.
`TASK-9` adds text/Markdown extraction, deterministic chunking, embedding
providers and vector index scaffolding. `TASK-19` registers those pieces in the
worker document pipeline.

## MVP Pipeline

```text
upload
store original blob
scan
extract text
chunk
embed
index
derive memory candidates
```

Text and Markdown extraction are required for MVP. PDF extraction should be
supported through an adapter if feasible. OCR, audio and video processing are
outside MVP scope.

Processing status must be durable in PostgreSQL, not only in BullMQ.

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
return Document and scan job ids
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

## Current Worker Processing

`@mindory/core/processing` defines the processing contracts. The built-in text
extractor supports plain text and Markdown inputs, and `FixedSizeTextChunker`
creates deterministic token windows with offset metadata.

Embedding providers exist for OpenAI-compatible `/embeddings` APIs and Ollama
`/api/embed`. `TASK-20` makes pgvector the default MVP vector runtime: worker
indexing upserts chunk embeddings into `chunk_vector_embeddings`, and API
document search uses query embeddings plus pgvector when embeddings are
configured. Qdrant remains an optional future adapter.

`TASK-19` adds `DocumentChunkRepository`, a Drizzle-backed chunk repository and
the worker processor registry. Clean scans enqueue extraction, extraction writes
derived text objects, chunking replaces durable chunk rows, and embedding/index
processors write pgvector rows when embeddings are configured. With
`MINDORY_EMBEDDINGS_PROVIDER=disabled`, the pipeline intentionally stops at
`chunked` and API document search falls back to text chunk search.

`TASK-31` adds strict indexed acceptance: with
`MINDORY_E2E_REQUIRE_INDEXED=true`, the live acceptance script waits for
`indexed` document status and verifies document search returns source-backed
chunk hits.
