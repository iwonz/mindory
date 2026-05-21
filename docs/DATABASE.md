# Database

PostgreSQL is the canonical source of truth for Mindory business state.

## Principles

- All core tables include `project_id`.
- Original files are not stored in PostgreSQL.
- Redis/BullMQ is not durable business state.
- Vector indexes are rebuildable from canonical rows.
- Migrations must be included with schema changes.

## Schema Location

The Drizzle schema lives in:

```text
packages/db/src/schema.ts
packages/db/src/relations.ts
packages/db/drizzle/0000_initial_schema.sql
packages/db/drizzle.config.ts
```

The initial migration is checked in as SQL so the schema is visible before any
runtime migration runner exists.

## MVP Tables

- `projects`
- `access_tokens`
- `access_token_project_scopes`
- `peers`
- `sessions`
- `session_peers`
- `messages`
- `documents`
- `attachments`
- `chunks`
- `memory_claims`
- `processing_jobs`

`access_tokens.project_id` records the issuing/default project. Multi-project
access is represented by `access_token_project_scopes`, where each row stores a
project and its permission list.

`session_peers` normalizes session participants while preserving
`sessions.project_id` as the session namespace.

## Types and Evidence

MVP status and type fields use PostgreSQL enums for stable domain values.
`SourceSnapshot`, `SourceRef[]` and flexible metadata are stored as `jsonb`.
`memory_claims.source_refs` has a GIN index because memory explanation and
source-backed recall will query evidence references.

## Indexing

Foreign-key and common project-scope columns are indexed in the initial
migration. This includes session/message traversal, document status lookup,
chunk lookup by document, memory lookup by project/status and processing job
lookup by status/type/idempotency key.

## Current Limits

`TASK-4` defines schema only. It does not apply migrations to a live database and
does not add repositories, API handlers, worker execution or vector search.

`TASK-7` adds interfaces that will write `processing_jobs` state, but no concrete
PostgreSQL repository is implemented yet.

`TASK-20` adds the pgvector MVP storage path: the initial migration enables the
`vector` extension and creates `chunk_vector_embeddings` with `vector(1536)`,
chunk/project/document indexes and an HNSW cosine index for semantic search.

`TASK-38` adds the derived artifact schema in `0001_derived_artifact_schema`.
The migration is intentionally separate from `0000_initial_schema` so existing
databases with the baseline checksum can upgrade safely. It adds:

- `processing_runs` for recomputable derived-state runs with config and model
  runtime fingerprints.
- `document_artifacts`, `document_artifact_vectors` and
  `document_artifact_text_spans` for text, OCR, transcripts, captions, frames
  and other semantic outputs.
- `document_media_metadata` and `document_metadata_index` for typed metadata
  filters such as size, duration, pages and dimensions.
- `face_identities` and `face_observations` for workspace-scoped face matching.

These tables are derived state. They reference documents and projects with
cascading deletes, but they do not replace or mutate the original document blob
stored behind `documents.storage_key`.

## Repository Layer

`TASK-14` adds Drizzle-backed repository skeletons in:

```text
packages/db/src/repositories/
```

Current repositories:

- `DbProjectRepository`
- `DbPeerRepository`
- `DbSessionRepository`
- `DbDocumentRepository`
- `DbDocumentChunkSearchRepository`
- `DbDerivedArtifactRepository`
- `DbMemoryRepository`
- `DbProcessingJobStore`

The repository layer implements existing core contracts where available:
`DocumentRepository`, `MemoryRepository`, `ProcessingJobStore` and
`ContextSessionRepository`. It also adds core contracts for projects, peers,
sessions and messages.

The repositories are exported by `@mindory/db/repositories`. They have not been
executed against a live database in the current bootstrap environment.

`TASK-15` adds `@mindory/db/client` for creating a PostgreSQL pool and Drizzle
database. The API server uses it to build runtime repositories from
`MINDORY_DATABASE_URL`.

`TASK-17` adds `DbAccessTokenRepository`, which reads active non-expired access
tokens by `token_hash`, loads project scopes from
`access_token_project_scopes`, and updates `last_used_at` after successful
verification.

`TASK-29` extends `DbAccessTokenRepository` with token lifecycle operations:
create, list, revoke and rotate. Create and rotate receive only token hashes
from the API layer; raw bearer tokens are never persisted. List/revoke/rotate
responses are metadata-only and preserve permissions through
`access_token_project_scopes`.

`TASK-19` adds `DbDocumentChunkRepository` for worker chunk persistence. It
replaces a document's chunk rows idempotently, lists chunks in document order and
can attach vector embedding ids after indexing.

`TASK-20` wires pgvector indexing through `@mindory/vector-pgvector`. The table
is an indexable projection of canonical chunk rows and can be rebuilt from
documents/chunks plus embeddings.

`TASK-38` adds `DbDerivedArtifactRepository`, which can create processing runs,
write document artifacts, store media metadata and record face identities or
observations. Later modality processors should use this repository rather than
writing derived artifact tables directly.

`TASK-41` extends that repository with idempotent text span replacement for
artifact-backed text chunks. The text search path now uses a full-text GIN index
on `document_artifact_text_spans` and filters out spans from `superseded`
processing runs.

`TASK-22` extends `DbSessionRepository` with `updateSessionSummary` so
`session.summarize` jobs can refresh `sessions.summary` and metadata. It also
uses `DbMemoryRepository` from workers to write derived memory candidates with
source refs.

The runtime wiring is still not a migration runner and has not been tested
against a live database in the current bootstrap environment.
