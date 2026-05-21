# Workers

Workers handle heavy asynchronous processing. API processes must remain
stateless and horizontally scalable.

## Worker Types

- `virus-scan`
- `recompute`
- `routing`
- `extraction`
- `chunking`
- `embedding`
- `indexing`
- `memory-derivation`
- `session-summary`

Workers should be independently scalable by `WORKER_TYPE` and
`WORKER_CONCURRENCY`.

`TASK-3` includes a `worker` Docker Compose placeholder. `TASK-18` makes API
uploads enqueue durable document jobs through BullMQ. `TASK-19` adds the
concrete worker runtime builder and document processor registry, and `TASK-39`
adds route planning between scan and modality-specific processing.

`TASK-4` adds the canonical `processing_jobs` table. Workers added later must use
that table for durable job state and BullMQ only for execution scheduling.

`TASK-7` adds the queue and runner scaffolding:

- `@mindory/core` defines `ProcessingJobQueue`, `ProcessingJobStore`,
  `ProcessingJobDispatcher`, `ProcessingJobRunner` and processor contracts.
- `@mindory/queue-bullmq` implements BullMQ enqueue and worker adapters.
- `apps/worker` exposes a base runner builder that combines the BullMQ worker
  with the generic `ProcessingJobRunner`.

The dispatcher persists a pending job through `ProcessingJobStore` before
enqueueing the BullMQ job. BullMQ uses the job idempotency key as `jobId` so
duplicate enqueue attempts are coalesced by Redis while PostgreSQL remains
canonical.

The document pipeline processors now include:

- `document.scan` via ClamAV, which enqueues routing after a clean scan.
- `document.recompute`, which creates a new processing run, supersedes older
  derived runs for the requested stage, and enqueues routing without changing
  the RAW object.
- `document.route`, which classifies the file and plans only enabled downstream
  jobs for the file type.
- `document.extract`, which writes extracted text back to object storage.
- `document.chunk`, which replaces durable PostgreSQL chunk rows.
- `document.embed` and `document.index`, which are registered and skip safely
  when embeddings or vector index runtime are not configured.

The current concrete pieces are the built-in text/Markdown extractor, the
Docling PDF native text extractor, image semantic fallback extractor,
fixed-size chunker, OpenAI-compatible embeddings provider, Ollama embeddings
provider, and explicit pgvector/Qdrant vector index scaffolds.

Routing is intentionally separate from antivirus and extraction. When antivirus
is disabled, upload enqueues `document.route` directly. When asynchronous
ClamAV is enabled, scan must finish cleanly before route planning runs.

`TASK-22` wires memory/context processors into the same worker runtime:

- `session.summarize` refreshes `sessions.summary` with a bounded extractive
  recent-turn summary.
- `memory.derive` creates conservative `candidate` memory claims from explicit
  user memory cues only.
- Automatic derivation never creates active memories; manual `memory_remember`
  remains the active-memory path.
- Candidate claims include source refs to the source message and session so
  explanations remain evidence-backed.

## Processing Rules

- Workers assume at-least-once execution.
- Processing must be idempotent.
- PostgreSQL records durable job state.
- BullMQ schedules execution but is not canonical business state.
- `TASK-21` exposes job status, listing and manual retry through the HTTP API.
