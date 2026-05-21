# Memory Model

Mindory combines Honcho-like agent memory with first-class document evidence.

## Core Entities

- Project: top-level namespace and security boundary.
- Peer: human, agent, service, automation or group actor.
- Session: conversation, thread, task run or agent run.
- Message: event or message inside a session.
- Document: first-class stored file.
- Attachment: link between message and document.
- Chunk: searchable extracted text fragment.
- MemoryClaim: durable conclusion or memory atom.
- SourceRef: evidence pointer to session, message, document, chunk or memory.
- SourceSnapshot: simple source metadata for MVP.

Every durable memory must support source references so agents can explain why a
claim is remembered.

## Database Mapping

`TASK-4` maps the MVP model to PostgreSQL tables:

- `projects` is the namespace root.
- `peers`, `sessions`, `messages`, `documents`, `chunks`, `memory_claims` and
  `processing_jobs` are project-scoped.
- `attachments` links messages to documents.
- `session_peers` links sessions to participant peers.
- `access_token_project_scopes` links access tokens to project permission sets.

`MemoryClaim.sourceRefs` is stored as `memory_claims.source_refs` JSONB and must
point to source evidence such as messages, documents, chunks or other memories.

## Runtime Boundary

`@mindory/core/memory` now defines the runtime memory contracts:

- `SourceRef` points to session, message, document, chunk or memory evidence.
- `MemoryService.remember` creates manual memory claims through an injected
  repository and requires source refs.
- `MemoryService.search` delegates to a repository and defaults to `active`
  claims.
- `MemoryService.explain` returns the claim, source refs and creation metadata.
- `ContextBuilder` combines session summary, recent messages, memory hits and
  document chunk hits into prompt-ready blocks while respecting a token budget.

`TASK-14` adds `DbMemoryRepository`, which persists and searches memory claims
through Drizzle. Search is currently text-based and ordered by importance,
confidence and update time. Vector-backed memory search is still a future task.

`TASK-22` adds the MVP memory/context runtime:

- `SessionRepository.updateSessionSummary` lets workers refresh `sessions.summary`.
- Message append enqueues `session.summarize` and `memory.derive` jobs when the
  API runtime dispatcher is wired.
- `session.summarize` builds an extractive recent-turn summary for context
  assembly.
- `memory.derive` uses only explicit user cues such as "remember that" or
  "I prefer" and creates `candidate` claims only.
- Derived claims must include source refs to the source message and session.
- Manual `memory_remember` remains the required path for active durable memory.
