# Mindory PRD

**Product name:** Mindory  
**Document type:** Product Requirements Document / Engineering Operating Specification  
**Target reader:** Codex or any coding agent/contributor working on the repository  
**Language/runtime target:** Node.js + TypeScript  
**Primary delivery model:** self-hosted Docker Compose deployment  

---

## 1. Purpose of this document

This PRD is the authoritative starting specification for building **Mindory**.

Codex must use this document to understand:

- what Mindory is;
- what the MVP must include;
- what the MVP must explicitly not include;
- how the repository must be structured;
- which technology stack must be used;
- how development tasks must be created and executed;
- how documentation and configuration must be maintained;
- how the system must be designed to scale later without a full rewrite.

This PRD is intentionally both a product document and an engineering operating specification.

---

## 2. Product summary

**Mindory** is a self-hosted, project-scoped, evidence-backed memory backend for AI agents.

It provides a Honcho-like memory core:

- projects;
- peers;
- sessions;
- messages;
- memory claims / conclusions;
- context builder;
- recall across sessions.

But Mindory also adds first-class document and file support:

- uploaded documents/files;
- message attachments;
- original file storage;
- antivirus scanning;
- text extraction;
- chunking;
- embeddings;
- semantic document search;
- memories linked to messages, documents and document chunks.

Mindory is not just a vector database, not just a document management system, not just RAG over files, and not just a Honcho clone.

The core product thesis:

> Mindory is an agent memory backend where every durable memory can be traced back to messages, documents, chunks or other source evidence.

---

## 3. Positioning

Mindory should be understood as:

```text
Project-scoped, source-aware, evidence-backed memory server for agents.
```

Honcho-like core:

```text
Project → Peer → Session → Message → MemoryClaim → ContextBuilder
```

Mindory-specific extension:

```text
Session → Message → Attachment → Document → Chunk → MemoryClaim
```

Mindory must support both:

1. **Agent memory** — facts, decisions, preferences, session summaries and durable claims.
2. **Artifact/document memory** — files, attachments, extracted text, searchable chunks and evidence links.

---

## 4. MVP goals

The MVP must demonstrate that:

1. An agent can persist sessions and messages.
2. An agent can store durable memories/conclusions.
3. An agent can recall memories across sessions.
4. A user or agent can upload files/documents.
5. Uploaded documents are stored as first-class entities.
6. Documents can be scanned, processed, chunked and indexed asynchronously.
7. Memory claims can reference source messages, documents and chunks.
8. Context can be built for an agent using session summary, recent messages, relevant memories and relevant document chunks.
9. The system can be deployed self-hosted with Docker Compose.
10. The system includes HTTP API, MCP server, CLI and one native Hermes adapter.

---

## 5. Non-goals for MVP

The following are not MVP requirements, but the architecture must not prevent them later:

- full provenance graph;
- SourceEvent / SourceConnector / ProvenanceChain model;
- enterprise audit log;
- detailed document-level ACL;
- org/team hierarchy;
- advanced policy engine;
- browser extension;
- Telegram adapter;
- n8n adapter;
- OpenClaw adapter;
- audio transcription;
- video processing;
- full OCR pipeline for images;
- knowledge graph;
- memory decay;
- memory conflict resolution;
- automatic contradiction handling;
- Kafka/NATS event bus;
- billing;
- web UI;
- multi-region deployment.

Do not implement these in MVP unless a later task explicitly requests them.

---

## 6. Primary users and use cases

### 6.1 Individual self-hosted user

A user creates a project such as `homelab` and gives an agent access to it. The agent remembers technical decisions, prior sessions, uploaded notes and documents.

Example:

```text
Project: homelab
Agent: Hermes
User asks later: “What did we decide about ZFS and Immich?”
Mindory returns relevant memories and document chunks with source refs.
```

### 6.2 Work/team user

A team creates a project for a business unit, engineering team or product area. Agents working inside the team can share a scoped memory.

Example:

```text
Project: team-seo
Project: team-notifications
Token: read access to both projects
Agent can build context across both projects.
```

### 6.3 Shared memory across projects

Access tokens can grant access to multiple projects. This allows two users or teams to create a shared memory context without merging project data into one namespace.

Example:

```text
Token can read:
- ivan-personal
- friend-project

context_build searches both projects allowed by the token.
```

---

## 7. Key product principles

1. **Project is the main namespace.**  
   There is no separate Bucket entity in MVP.

2. **Access tokens can span multiple projects.**  
   Shared memory is implemented through token scopes, not through buckets.

3. **Memory must be evidence-backed.**  
   Every `MemoryClaim` must support `SourceRef[]`.

4. **Documents are first-class.**  
   Uploaded files must not be flattened into messages only.

5. **Heavy processing is asynchronous.**  
   Antivirus scan, derived-state recompute, file-type routing, extraction,
   chunking, embeddings and derivation run in workers.

6. **HTTP API is the source of truth.**  
   MCP, CLI and Hermes adapter are interfaces/adapters over the core API.

7. **API is stateless.**  
   API processes must scale horizontally.

8. **PostgreSQL is the canonical source of truth.**  
   Redis/BullMQ is a queue/cache layer, not durable business state.

9. **Original files live in object storage.**  
   Never store original files in PostgreSQL.

10. **Storage, vector index and processors are adapter-based.**  
    The MVP should use simple implementations, but not hardcode them into domain logic.

11. **Documentation is part of the product.**  
    Docs must remain current and non-duplicative.

12. **No change without a task.**  
    Development must follow the Mindory Ralph-cycle from the first commit.

---

## 8. Technology stack

### 8.1 API

- Node.js
- TypeScript
- Fastify
- Stateless service

### 8.2 Database

- PostgreSQL
- Drizzle ORM
- Drizzle schema/migrations in a separate package
- `project_id` must exist on all core tables

### 8.3 Queue and cache

- Redis
- BullMQ
- Redis used for:
  - background job execution;
  - cache;
  - future rate limiting and locks.

Important rule:

```text
Redis/BullMQ is not the canonical business-state store.
PostgreSQL remains the source of truth for document status, job status, chunks, memories and sessions.
```

### 8.4 Object storage

Adapter-based:

- local filesystem adapter;
- S3-compatible adapter.

MVP must support:

```text
storage.provider = local-fs | s3
```

Local filesystem is acceptable for development and simple single-node self-hosted setups. LibreFS or another S3-compatible service is the production-like self-hosted mode.

### 8.5 Vector index

Adapter-based:

- pgvector as the default MVP implementation;
- Qdrant as an optional selectable adapter and docker-compose profile.

Important rule:

```text
Chunks and MemoryClaims are canonical in PostgreSQL.
The vector index is an index that can be rebuilt.
```

### 8.6 MCP

- MCP server must be a separate app/package.
- It exposes tools for agents.
- It must not be the core source of truth.

### 8.7 CLI

- CLI must be a separate app/package.
- CLI must call the HTTP API.
- CLI must not access the database directly.

### 8.8 Workers

Workers must be separate by processing type or configurable by `WORKER_TYPE`.

Worker types:

- virus-scan;
- extraction;
- chunking;
- embedding;
- indexing;
- memory-derivation;
- session-summary.

Each worker type must be independently scalable.

### 8.9 Antivirus

- ClamAV support must be included.
- ClamAV must be available as a Docker Compose profile/service.
- Scanning policy must be configurable.

Default recommended mode:

```text
async_quarantine
```

Meaning:

- upload returns quickly;
- document is quarantined until scan completes;
- read/extract/index are blocked until scan is clean.

### 8.10 Hermes adapter

- MVP must include one deep runtime adapter: Hermes.
- Hermes adapter must be separate from API.
- Hermes adapter must call the Mindory HTTP API.

---

## 9. Repository structure

The repository must be a monorepo.

Target structure:

```text
mindory/
  AGENTS.md
  README.md
  PRD.md          # pointer to docs/PRD.md
  .env.example
  docker-compose.yml
  docker-compose.override.yml

  tasks/
    tasks.json
    TASK-1.json
    TASK-2.json

  docs/
    PRD.md
    DEVELOPMENT_PROCESS.md
    ARCHITECTURE.md
    CONFIGURATION.md
    DEPLOYMENT.md
    API.md
    DATABASE.md
    WORKERS.md
    MCP.md
    CLI.md
    HERMES_ADAPTER.md
    SECURITY.md
    DOCUMENT_PIPELINE.md
    MEMORY_MODEL.md

  apps/
    api/
    mcp/
    cli/
    worker/
    adapters/
      hermes/

  packages/
    core/
    db/
    sdk/
    config/
    llm/
    auth/
    storage/
      local-fs/
      s3/
    queue/
      bullmq/
    vector/
      pgvector/
      qdrant/
    processors/
      antivirus-clamav/
      extractors/
        builtin-text/
        docling/
      embeddings/
        openai-compatible/
        ollama/
    observability/
```

The exact structure may be refined during implementation, but the separation of responsibilities must remain.

---

## 10. Development process: Mindory Ralph-cycle

Development must be task-driven from the first commit.

### 10.1 Mandatory rule

```text
No task → no code change.
```

Every code, documentation, configuration, schema or behavior change must belong to a task in `tasks/`.

### 10.2 Required task files

```text
tasks/tasks.json
```

Global task registry and current task pointer.

```text
tasks/{TASK_ID}.json
```

Task-specific file containing scope, acceptance criteria, verification and status.

### 10.3 `tasks/tasks.json` template

```json
{
  "project": "mindory",
  "process": "mindory-ralph-cycle",
  "current_task_id": "TASK-1",
  "task_id_prefix": "TASK",
  "main_branch": "master",
  "release_strategy": "git-tags",
  "branch_naming": {
    "feature": "task/{TASK_ID}-{short-slug}",
    "fix": "fix/{TASK_ID}-{short-slug}",
    "chore": "chore/{TASK_ID}-{short-slug}",
    "docs": "docs/{TASK_ID}-{short-slug}",
    "hotfix": "hotfix/{TASK_ID}-{short-slug}"
  },
  "statuses": [
    "draft",
    "ready",
    "in_progress",
    "blocked",
    "review",
    "accepted",
    "done",
    "cancelled"
  ],
  "global_acceptance_criteria": [
    "The task has a dedicated tasks/{TASK_ID}.json file.",
    "The implementation satisfies all task-specific acceptance criteria.",
    "The codebase remains consistent with AGENTS.md and docs/ARCHITECTURE.md.",
    "Relevant documentation is updated without duplication.",
    ".env.example is updated if configuration changes.",
    "Database migrations are included if schema changes.",
    "Tests, typecheck and lint pass where applicable.",
    "No unrelated changes are included.",
    "The task status is updated before merge."
  ],
  "tasks": [
    {
      "id": "TASK-1",
      "title": "Bootstrap Mindory repository operating model",
      "status": "ready",
      "branch": "task/TASK-1-bootstrap-repository-operating-model",
      "file": "tasks/TASK-1.json"
    }
  ]
}
```

### 10.4 Task file template

```json
{
  "id": "TASK-1",
  "title": "Bootstrap Mindory repository operating model",
  "status": "ready",
  "type": "chore",
  "priority": "high",
  "branch": "task/TASK-1-bootstrap-repository-operating-model",
  "created_at": "2026-05-21",
  "updated_at": "2026-05-21",
  "context": {
    "summary": "Create the initial repository operating model, process files, documentation skeleton and configuration contract.",
    "background": "Mindory must be developed through the Mindory Ralph-cycle from the first task."
  },
  "scope": {
    "in": [
      "Create AGENTS.md.",
      "Create tasks/tasks.json.",
      "Create tasks/TASK-1.json.",
      "Create docs/PRD.md with the corrected current PRD.",
      "Create root PRD.md as a pointer to docs/PRD.md.",
      "Create docs/DEVELOPMENT_PROCESS.md.",
      "Create documentation skeleton in docs/.",
      "Create .env.example.",
      "Create README.md."
    ],
    "out": [
      "Implement API endpoints.",
      "Implement database schema.",
      "Implement workers.",
      "Implement MCP server.",
      "Implement Hermes adapter."
    ]
  },
  "acceptance_criteria": [
    "Repository contains AGENTS.md with mandatory development rules.",
    "Repository contains tasks/tasks.json with current_task_id set to TASK-1 and task_id_prefix set to TASK.",
    "Repository contains tasks/TASK-1.json.",
    "Repository contains docs/PRD.md with TASK-style task identifiers.",
    "Repository contains root PRD.md pointing to docs/PRD.md.",
    "Repository contains docs/DEVELOPMENT_PROCESS.md describing the Mindory Ralph-cycle.",
    "Repository contains initial docs skeleton for architecture, configuration, deployment, API, database, workers, MCP, CLI, Hermes adapter, security, document pipeline and memory model.",
    "Repository contains .env.example with initial configuration sections.",
    "Repository contains README.md with project purpose and local bootstrap instructions.",
    "No implementation code beyond scaffolding is added in this task."
  ],
  "verification": {
    "commands": [
      "ls AGENTS.md README.md PRD.md .env.example",
      "ls tasks/tasks.json tasks/TASK-1.json",
      "ls docs/PRD.md docs/DEVELOPMENT_PROCESS.md docs/ARCHITECTURE.md"
    ],
    "manual_checks": [
      "Check that docs are not duplicating the same information unnecessarily.",
      "Check that AGENTS.md clearly says no code changes without a task.",
      "Check that .env.example is understandable and does not contain secrets."
    ]
  },
  "dependencies": [],
  "risks": [
    "Over-documenting before implementation may create stale docs. Keep docs structural and update them in later tasks."
  ],
  "definition_of_done": [
    "All acceptance criteria are satisfied.",
    "Task status is changed to accepted or done.",
    "Branch can be merged into master without unrelated changes."
  ]
}
```

### 10.5 Branch convention

`master` is the only long-lived branch.

There are no `dev` or `release` branches.

Examples:

```text
task/TASK-1-bootstrap-repository-operating-model
task/TASK-2-bootstrap-pnpm-monorepo
task/TASK-3-add-base-docker-compose
fix/TASK-10-fix-document-status-transition
docs/TASK-11-update-worker-docs
chore/TASK-12-add-ci
hotfix/TASK-13-fix-broken-migration
```

Rules:

- `master` must always be green and deployable.
- Do not commit directly to `master`.
- One branch = one task.
- Branch name must include `TASK_ID`.
- No unrelated changes.
- Releases are created through git tags.

### 10.6 Commit convention

Preferred format:

```text
feat(TASK-4): add document upload API
fix(TASK-10): fix document status transition
docs(TASK-11): update worker documentation
chore(TASK-1): bootstrap repository operating model
```

Every commit should reference a task id.

---

## 11. Documentation policy

Documentation is part of the product.

Every task that changes behavior, architecture, API, config, schema, workers, MCP tools, CLI or adapters must update the relevant docs in the same task.

Docs must be:

- current;
- non-duplicative;
- consistent with code;
- explicit about constraints and trade-offs;
- concise enough to stay maintainable.

### 11.1 Required docs

```text
docs/PRD.md
```

Canonical product requirements and engineering operating specification. Root `PRD.md` points here to avoid duplicate PRDs.

```text
docs/DEVELOPMENT_PROCESS.md
```

Describes the Mindory Ralph-cycle, tasks, branches, commits, merge and release process.

```text
docs/ARCHITECTURE.md
```

Overall architecture: API, workers, DB, Redis, object storage, vector index, MCP, CLI and adapter.

```text
docs/CONFIGURATION.md
```

All environment variables and configuration modes.

```text
docs/DEPLOYMENT.md
```

Docker Compose deployment, profiles and scaling.

```text
docs/API.md
```

HTTP API contract.

```text
docs/DATABASE.md
```

Tables, migrations, canonical state and project partitioning.

```text
docs/WORKERS.md
```

Worker types, queue, retries, idempotency and scaling.

```text
docs/MCP.md
```

MCP tools and intended usage.

```text
docs/CLI.md
```

CLI commands and examples.

```text
docs/HERMES_ADAPTER.md
```

Hermes integration lifecycle.

```text
docs/SECURITY.md
```

Tokens, permissions, antivirus policy, quarantine and source metadata.

```text
docs/DOCUMENT_PIPELINE.md
```

Upload → scan → extract → chunk → embed → index → derive.

```text
docs/MEMORY_MODEL.md
```

Project, Peer, Session, Message, Document, Chunk, MemoryClaim, SourceRef and SourceSnapshot.

---

## 12. AGENTS.md requirements

The repository must include `AGENTS.md` in the root.

It must instruct Codex and all coding agents to:

1. Read `PRD.md`.
2. Read `tasks/tasks.json`.
3. Read the current `tasks/{TASK_ID}.json`.
4. Never make changes without a task.
5. Keep documentation current.
6. Keep `.env.example` current.
7. Preserve architecture boundaries.
8. Prefer mature libraries and framework capabilities over unnecessary custom code.
9. Avoid duplicate logic and duplicate docs.
10. Check acceptance criteria before finishing.

`AGENTS.md` must also contain the core architecture principles:

```text
- API is stateless.
- PostgreSQL is the source of truth.
- Redis/BullMQ is queue/cache, not durable business state.
- Object storage stores original files.
- Vector index is replaceable.
- Workers perform heavy async processing.
- MCP is an interface, not the core.
- CLI uses HTTP API, not direct DB access.
- Hermes adapter is separate from API.
```

---

## 13. Configuration policy

All runtime configuration must be represented in `.env.example`.

When adding, renaming or removing an environment variable:

1. update `.env.example`;
2. update `docs/CONFIGURATION.md`;
3. ensure Docker Compose still works;
4. never commit real secrets.

### 13.1 Initial `.env.example` content

```env
# -----------------------------------------------------------------------------
# Mindory API
# -----------------------------------------------------------------------------
MINDORY_API_HOST=0.0.0.0
MINDORY_API_PORT=3000
MINDORY_PUBLIC_URL=http://localhost:3000

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------
MINDORY_DATABASE_URL=postgresql://mindory:mindory@postgres:5432/mindory

# -----------------------------------------------------------------------------
# Redis / BullMQ
# -----------------------------------------------------------------------------
MINDORY_REDIS_URL=redis://redis:6379
MINDORY_QUEUE_PREFIX=mindory:queue
MINDORY_CACHE_PREFIX=mindory:cache

# -----------------------------------------------------------------------------
# Object Storage
# local-fs | s3
# -----------------------------------------------------------------------------
MINDORY_STORAGE_PROVIDER=local-fs
MINDORY_STORAGE_LOCAL_PATH=/data/mindory/objects

MINDORY_S3_ENDPOINT=http://librefs:9000
MINDORY_S3_REGION=us-east-1
MINDORY_S3_BUCKET=mindory
MINDORY_S3_ACCESS_KEY_ID=mindory
MINDORY_S3_SECRET_ACCESS_KEY=mindory-secret
MINDORY_S3_FORCE_PATH_STYLE=true

# -----------------------------------------------------------------------------
# Vector Index
# pgvector | qdrant
# -----------------------------------------------------------------------------
MINDORY_VECTOR_PROVIDER=pgvector
MINDORY_QDRANT_URL=http://qdrant:6333
MINDORY_QDRANT_COLLECTION_PREFIX=mindory

# -----------------------------------------------------------------------------
# Antivirus
# disabled | async_quarantine | sync_scan
# -----------------------------------------------------------------------------
MINDORY_AV_ENABLED=true
MINDORY_AV_PROVIDER=clamav
MINDORY_AV_MODE=async_quarantine
MINDORY_AV_REQUIRED_BEFORE_READ=true
MINDORY_AV_REQUIRED_BEFORE_EXTRACTION=true
MINDORY_AV_REQUIRED_BEFORE_INDEXING=true
MINDORY_AV_ON_SCAN_FAILURE=block
MINDORY_AV_ON_INFECTED=quarantine
MINDORY_CLAMAV_HOST=clamav
MINDORY_CLAMAV_PORT=3310

# -----------------------------------------------------------------------------
# Workers
# -----------------------------------------------------------------------------
MINDORY_WORKER_TYPE=all
MINDORY_WORKER_CONCURRENCY=2

# -----------------------------------------------------------------------------
# LLM SDK
# Per-role providers: disabled | openai-compatible | ollama | local-http | local-command
# -----------------------------------------------------------------------------
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
MINDORY_LLM_VISION_CAPTIONING_ENABLED=false
MINDORY_LLM_OCR_ENABLED=false
MINDORY_LLM_OCR_PROVIDER=local-http
MINDORY_LLM_OCR_MODEL=ESLAV__PP-OCRv5_mobile
MINDORY_LLM_FACE_DETECTION_ENABLED=false
MINDORY_LLM_FACE_DETECTION_PROVIDER=local-http
MINDORY_LLM_FACE_DETECTION_MODEL=buffalo_l
MINDORY_LLM_FACE_RECOGNITION_ENABLED=false
MINDORY_LLM_FACE_RECOGNITION_PROVIDER=local-http
MINDORY_LLM_FACE_RECOGNITION_MODEL=buffalo_l
MINDORY_LLM_IMAGE_GENERATION_ENABLED=false
MINDORY_LLM_AUDIO_GENERATION_ENABLED=false
MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL=
MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=none
MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY=
MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN=
MINDORY_LLM_OLLAMA_BASE_URL=http://ollama:11434
MINDORY_LLM_LOCAL_HTTP_BASE_URL=http://llm:8080
MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS=120000
MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND=
MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS=["healthcheck","--role","{role}","--model","{model}"]

# -----------------------------------------------------------------------------
# MCP
# -----------------------------------------------------------------------------
MINDORY_MCP_ENABLED=true
MINDORY_MCP_TRANSPORT=stdio

# -----------------------------------------------------------------------------
# Hermes Adapter
# -----------------------------------------------------------------------------
MINDORY_HERMES_ADAPTER_ENABLED=false
MINDORY_HERMES_DEFAULT_PROJECT=default
MINDORY_HERMES_DEFAULT_USER_PEER=default-user
MINDORY_HERMES_DEFAULT_AGENT_PEER=hermes
```

---

## 14. Core domain model

### 14.1 Project

Project is the top-level namespace, memory space and security boundary.

There is no Bucket entity in MVP.

Examples:

```text
homelab
work
team-seo
friend-shared-memory
company-media-products
```

All core data belongs to a project:

- peers;
- sessions;
- messages;
- documents;
- chunks;
- memory claims;
- processing jobs;
- tokens.

### 14.2 AccessToken

Capability-based token.

A token can grant access to one or many projects.

Example:

```json
{
  "projects": [
    {
      "projectId": "homelab",
      "permissions": [
        "memory:read",
        "memory:write",
        "document:read",
        "document:write",
        "context:build"
      ]
    },
    {
      "projectId": "friend-memory",
      "permissions": [
        "memory:read",
        "document:search",
        "context:build"
      ]
    }
  ]
}
```

Initial permission names:

```text
project:read
token:read
token:write
session:read
session:write
message:read
message:write
document:read
document:write
document:search
memory:read
memory:write
memory:delete
context:build
```

### 14.3 Peer

Peer is any actor in the system.

Peer types:

```text
human
agent
service
automation
group
```

Examples:

```text
ivan
hermes-agent
openclaw-agent
telegram-bot
n8n-workflow
browser-addon
```

### 14.4 Session

Session is a conversation, thread, task run or agent run.

Examples:

- API conversation;
- Telegram thread;
- corporate chat thread;
- n8n workflow execution;
- coding-agent run;
- Hermes conversation.

Session fields:

```text
id
project_id
title
status: active | idle | archived
peer_ids
source
summary
created_at
updated_at
```

### 14.5 Message

Message is a message or event inside a session.

Fields:

```text
id
project_id
session_id
author_peer_id
role: user | assistant | system | tool | event
content
source
created_at
metadata
```

### 14.6 Document

Document is a first-class stored file/document.

Fields:

```text
id
project_id
title
original_filename
mime_type
size_bytes
storage_key
status
source
created_at
updated_at
```

Document statuses:

```text
uploaded
scan_pending
scan_clean
scan_infected
scan_failed
quarantined
extract_pending
extracted
chunk_pending
chunked
embed_pending
indexed
failed
```

### 14.7 Attachment

Attachment links Message and Document.

Fields:

```text
id
project_id
message_id
document_id
source
created_at
```

### 14.8 Chunk

Chunk is a searchable extracted text fragment from a document.

Fields:

```text
id
project_id
document_id
index
content
token_count
embedding_id
metadata
created_at
```

Chunk metadata may include:

```text
page
section
start_offset
end_offset
```

### 14.9 MemoryClaim

MemoryClaim is the Honcho-like conclusion/memory atom, but evidence-backed.

Types:

```text
semantic
episodic
preference
decision
task
artifact_reference
derived
```

Statuses:

```text
candidate
active
rejected
archived
```

Fields:

```text
id
project_id
type
text
status
importance
confidence
source_refs
created_source
created_by_peer_id
created_at
updated_at
```

### 14.10 SourceRef

Reference from MemoryClaim to evidence.

Types:

```text
session
message
document
chunk
memory
```

Example:

```json
{
  "type": "chunk",
  "id": "chunk_123"
}
```

### 14.11 SourceSnapshot

Simple source metadata for MVP.

Do not build full provenance graph in MVP, but keep this structure extensible.

Types:

```text
api
cli
mcp
agent
telegram
browser_extension
n8n
import
unknown
```

Fields:

```text
type
integration
external_id
external_url
actor_peer_id
agent_peer_id
received_at
metadata
```

Later this can evolve into:

```text
SourceConnector
SourceEvent
ProvenanceChain
TrustLevel
AuditLog
```

### 14.12 ProcessingJob

Durable business-state record for async processing.

Job types:

```text
document.scan
document.route
document.extract
document.chunk
document.embed
document.index
document.recompute
memory.derive
session.summarize
```

Text extraction and chunking produce derived artifact rows and text spans before
search/index projections are updated. Search results should carry source refs
for the chunk, artifact and processing run.

Fields:

```text
id
project_id
type
target_type
target_id
status: pending | running | succeeded | failed | dead
idempotency_key
processor_version
attempts
max_attempts
last_error
created_at
updated_at
started_at
finished_at
```

---

## 15. Processing pipelines

### 15.1 Document pipeline

```text
document uploaded
  ↓
store original blob
  ↓
scan_pending
  ↓
AV scan
  ↓
scan_clean / scan_infected / scan_failed
  ↓
extract text
  ↓
split into chunks
  ↓
generate embeddings
  ↓
index chunks
  ↓
derive memory candidates
  ↓
indexed / ready
```

For MVP:

- text extraction is required for `.txt` and `.md`;
- PDF extraction should support native text and scanned-PDF OCR through a model adapter;
- image OCR and vision captioning are optional experimental paths and not
  required for the default MVP;
- audio ASR, video keyframe extraction and face detection/recognition are
  optional experimental paths and not required for the default MVP.

### 15.2 Session/message pipeline

```text
create_session
  ↓
append_message(user)
  ↓
upload attachments if present
  ↓
build_context before agent response
  ↓
append_message(assistant)
  ↓
async update session summary
  ↓
async derive memory candidates
```

### 15.3 Memory derivation pipeline

```text
message/document/chunk created
  ↓
worker analyzes candidate facts
  ↓
creates MemoryClaim(status=candidate)
  ↓
manual accept or simple auto-accept policy
  ↓
active memory available for recall
```

For MVP, manual `memory_remember` is required. Automatic derivation can be basic and conservative.

---

## 16. Idempotency and retries

All workers must be idempotent.

The system should assume at-least-once processing.

Examples of uniqueness/idempotency keys:

```text
document.scan:{document_id}:{scanner_version}
document.route:{document_id}:{router_version}
document.recompute:{document_id}:{request_id}
document.chunk:{document_id}:{chunker_version}
embedding:{chunk_id}:{embedding_model}:{embedding_version}
memory.derive:{source_ref_hash}:{deriver_version}
```

If a worker receives a job twice, it must not create duplicate chunks, embeddings or memory claims.

---

## 17. Context Builder

Context Builder is the central runtime API.

It is more important than a raw search endpoint because agents need prompt-ready context, not just search results.

Endpoint:

```text
POST /v1/context/build
```

Input:

```json
{
  "projectIds": ["homelab"],
  "sessionId": "sess_123",
  "query": "What did we decide about workers?",
  "tokenBudget": 3000,
  "include": {
    "sessionSummary": true,
    "recentMessages": true,
    "memories": true,
    "documents": true
  }
}
```

Output:

```json
{
  "blocks": [
    {
      "type": "session_summary",
      "content": "Discussed Mindory MVP architecture and worker scaling."
    },
    {
      "type": "memory",
      "content": "Workers should be independently scalable by type.",
      "sourceRefs": [
        { "type": "message", "id": "msg_123" }
      ],
      "score": 0.91
    },
    {
      "type": "document_chunk",
      "content": "Document pipeline: scan → extract → chunk → embed → index.",
      "sourceRefs": [
        { "type": "chunk", "id": "chunk_456" }
      ],
      "score": 0.88
    }
  ],
  "debug": {
    "searchedProjects": ["homelab"],
    "memoryHits": 1,
    "documentHits": 1
  }
}
```

Context Builder must respect token permissions and project scopes.

---

## 18. HTTP API MVP

MVP HTTP API should include at least these groups.

### Projects

```text
POST /v1/projects
GET  /v1/projects
GET  /v1/projects/:id
```

### Tokens

```text
POST /v1/tokens
GET  /v1/tokens
POST /v1/tokens/:id/revoke
POST /v1/tokens/:id/rotate
```

### Peers

```text
POST /v1/peers
GET  /v1/peers
GET  /v1/peers/:id
```

### Sessions

```text
POST /v1/sessions
GET  /v1/sessions/:id
GET  /v1/sessions
POST /v1/sessions/:id/messages
GET  /v1/sessions/:id/messages
```

### Documents

```text
POST /v1/documents
GET  /v1/documents/:id
GET  /v1/documents/:id/status
GET  /v1/documents/:id/chunks
POST /v1/documents/search
POST /v1/artifacts/search
POST /v1/search
```

### Memories

```text
POST   /v1/memories
GET    /v1/memories/:id
POST   /v1/memories/search
POST   /v1/memories/:id/explain
DELETE /v1/memories/:id
```

### Context

```text
POST /v1/context/build
```

### Jobs

```text
GET  /v1/jobs/:id
GET  /v1/jobs
POST /v1/jobs/:id/retry
```

---

## 19. MCP tools MVP

MCP tools are for agent-accessible explicit actions.

### Session tools

```text
create_session
append_message
get_session
get_session_messages
get_session_context
```

### Memory tools

```text
memory_remember
memory_recall
memory_explain
memory_forget
memory_list
```

### Document tools

```text
document_upload
document_status
document_search
artifact_search
unified_search
document_read
document_list
```

### Context tools

```text
context_build
```

MCP is not responsible for deterministic automatic session logging in runtime adapters. Hermes adapter should call HTTP API directly for lifecycle hooks.

---

## 20. CLI MVP

CLI must be installable separately and must call HTTP API.

Example commands:

```bash
mindory project create homelab
mindory token create --project homelab --permissions memory:read,memory:write,document:write,context:build
mindory session create --project homelab
mindory message add --session sess_123 --peer ivan --text "..."
mindory document upload ./plan.pdf --project homelab
mindory document status doc_123
mindory document search --project homelab "OCR pipeline"
mindory artifact search --project homelab "passport airport" --artifact-type ocr_text,image_caption
mindory search query --project homelab "passport airport" --target documents,artifacts,faces
mindory memory remember --project homelab "For MVP we keep Project as the only namespace."
mindory memory recall --project homelab "what did we decide about buckets?"
mindory memory explain mem_123
mindory context build --session sess_123 "what is relevant now?"
mindory jobs list
mindory jobs retry job_123
```

---

## 21. Hermes adapter MVP

Hermes adapter is the only deep runtime adapter required for MVP.

It must be separate from API and must call Mindory HTTP API.

### 21.1 Responsibilities

Hermes adapter must:

1. initialize from config;
2. map Hermes user/session/agent identity to Mindory Project/Peer/Session;
3. call `/v1/context/build` before prompt construction;
4. inject context into Hermes prompt;
5. save user and assistant turns to Mindory;
6. upload attachments/documents if Hermes exposes them;
7. expose optional tools:
   - `memor_recall`;
   - `memor_remember`;
   - `memor_document_search`;
   - `memor_document_read`;
   - `memor_explain`.

### 21.2 Identity warning

The adapter must not collapse different external users into one peer unless explicitly configured.

It must preserve stable mappings such as:

```text
external_user_id → Mindory Peer
external_session_id → Mindory Session
agent_id → Mindory Peer
```

### 21.3 MVP flow

```text
Hermes starts or resumes conversation
  ↓
Hermes adapter ensures Project, User Peer, Agent Peer and Session
  ↓
Before prompt build: adapter calls Mindory context_build
  ↓
Mindory returns session summary, relevant memories and document chunks
  ↓
Adapter injects context into Hermes prompt
  ↓
Hermes produces answer
  ↓
Adapter saves user/assistant messages
  ↓
Mindory enqueues async jobs
```

---

## 22. Docker Compose and self-hosted deployment

Mindory must support simple self-hosted deployment in 1–2 commands.

Expected flow:

```bash
git clone <repo>
cd mindory
cp .env.example .env
docker compose up -d
```

### 22.1 Base services

Base compose should include:

```text
postgres
redis
api
mcp
worker
```

### 22.2 Optional profiles

Optional Docker Compose profiles:

```text
minio
clamav
qdrant
docling
ollama
local-models
```

Example:

```bash
docker compose --profile minio --profile clamav --profile qdrant up -d
```

### 22.3 Scaling with Docker Compose

API must support horizontal scaling:

```bash
docker compose up -d --scale api=3
```

Workers must support independent scaling:

```bash
docker compose up -d --scale worker=5
```

If separate worker services are implemented:

```bash
docker compose up -d --scale worker-extraction=3

docker compose up -d --scale worker-embedding=5
```

---

## 23. Scaling requirements

### 23.1 API scaling

API must be stateless.

API must not store:

- session state in memory;
- durable files locally as source of truth;
- queue state in memory;
- worker state in memory.

API state is externalized to:

```text
PostgreSQL
Redis/BullMQ
Object Storage
Vector Index
```

### 23.2 Worker scaling

Workers must be scalable by type.

Each worker must support:

```text
WORKER_TYPE
WORKER_CONCURRENCY
```

Workers must:

1. read jobs from BullMQ;
2. check ProcessingJob in PostgreSQL;
3. transition job to running;
4. execute idempotently;
5. write result to PostgreSQL/ObjectStorage/VectorIndex;
6. mark job succeeded/failed;
7. enqueue next job if needed.

### 23.3 Enterprise path

Architecture must support the future path:

```text
Docker Compose → Kubernetes
single API → many API replicas
single worker → independent worker pools
local-fs → S3-compatible storage
pgvector → Qdrant
SourceSnapshot → SourceEvent/ProvenanceChain
project-level ACL → fine-grained policy engine
basic logs → OpenTelemetry traces/metrics/logs
```

---

## 24. Security and access control MVP

MVP access model:

- access tokens;
- multi-project token scopes;
- permission list per project;
- project-level authorization.

Every request must be evaluated through an authorization context.

Example:

```ts
AuthorizationContext = {
  tokenId: string;
  allowedProjects: Array<{
    projectId: string;
    permissions: string[];
  }>;
}
```

MVP does not require:

- document-level ACL;
- memory-level visibility;
- group/role hierarchy;
- policy engine.

But the architecture must not prevent adding them later.

---

## 25. Antivirus policy

ClamAV must be supported.

Policy fields:

```text
enabled
provider
mode: disabled | async_quarantine | sync_scan
required_before_read
required_before_extraction
required_before_indexing
on_scan_failure: block | allow_with_warning
on_infected: quarantine | delete
```

Recommended default for production-like self-hosted:

```text
async_quarantine
```

Meaning:

- upload returns document id quickly;
- document is marked `scan_pending`;
- original file read is blocked;
- extraction is blocked;
- indexing is blocked;
- after clean scan, pipeline continues;
- if infected, document is quarantined.

---

## 26. Observability

MVP should include structured logging from the start.

Every request/job should include:

```text
request_id
trace_id if available
project_id
job_id when applicable
document_id when applicable
session_id when applicable
```

OpenTelemetry should be architecturally supported and may be implemented early.

At minimum:

- structured logs;
- health endpoints;
- readiness endpoint;
- job status visibility.

---

## 27. Quality gates

Every task must satisfy:

- task-specific acceptance criteria;
- global acceptance criteria from `tasks/tasks.json`;
- typecheck;
- lint;
- relevant tests;
- docs update when needed;
- `.env.example` update when needed;
- migrations when schema changes;
- no unrelated changes.

Recommended scripts:

```json
{
  "scripts": {
    "check": "pnpm lint && pnpm typecheck && pnpm test && pnpm tasks:validate",
    "tasks:validate": "node scripts/validate-tasks.js",
    "env:validate": "node scripts/validate-env-example.js",
    "docs:check": "node scripts/check-docs.js"
  }
}
```

`pnpm test` runs the MVP integration suite against PostgreSQL and Redis. The
suite verifies both disabled embeddings fallback (`chunked`) and configured
OpenAI-compatible embeddings through a local fake provider, pgvector row
persistence, scanned-PDF OCR through a local fake OCR provider and semantic
document search without external provider credentials.

`pnpm mvp:demo --model-profile local --require-indexed` runs a self-contained
strict indexed flow with the deterministic local HTTP embedding service.
`pnpm mvp:acceptance` also supports `MINDORY_E2E_REQUIRE_INDEXED=true` for live
runs where an external embeddings provider is configured and the demo must
prove `indexed` document status plus source-backed document search.

`tasks:validate` should check:

- `tasks/tasks.json` is valid;
- `current_task_id` exists;
- `tasks/{current_task_id}.json` exists;
- task statuses are valid;
- every registered task has a file;
- acceptance criteria are not empty;
- branch names include task ids.

---

## 28. MVP acceptance criteria

The MVP is successful when the following demo can be performed.

### Day 1

1. Start Mindory with Docker Compose.
2. Create project `homelab`.
3. Create access token for `homelab`.
4. Create peer `ivan` and peer `hermes`.
5. Create a session.
6. Add messages about Mindory architecture.
7. Upload a Markdown or PDF document.
8. Document is stored as a `Document`.
9. Document is scanned or scan is explicitly skipped according to config.
10. Document text is extracted, including scanned-PDF OCR when configured.
11. Text is chunked.
12. Chunks are indexed.
13. Create a MemoryClaim:

```text
For MVP, Project is the only namespace; there is no Bucket entity.
```

14. MemoryClaim references source message/document/chunk.

### Day 2

1. Start a new session.
2. Ask:

```text
What did we decide about the MVP architecture?
```

3. `context_build` returns:

- session summary;
- relevant memories;
- relevant document chunks;
- source refs.

4. Ask:

```text
Why do you remember this?
```

5. `memory_explain` returns source message/document/chunk references.

### Hermes demo

1. Configure Hermes adapter.
2. Hermes calls Mindory context before prompt.
3. Hermes receives relevant memories and document chunks.
4. Hermes saves turns into Mindory.
5. A later Hermes session recalls earlier context.

`TASK-33` adds a local Hermes runtime contract fixture dated 2026-05-21 because
no Hermes SDK is vendored in this repository. The fixture documents
`before_prompt`, `after_response` and `completed_turn` hook assumptions and is
validated by `pnpm hermes:contract`. `TASK-83` adds a fake-compatible Hermes
runtime hook harness validated by `pnpm hermes:harness`; official Hermes SDK
certification remains future work until a stable SDK or generated hook contract
is available in the repository.

---

## 29. Initial task roadmap

Codex should not implement everything at once.

Recommended first tasks:

### TASK-1 — Bootstrap repository operating model

Create:

- `docs/PRD.md`;
- root `PRD.md` pointer;
- `AGENTS.md`;
- `tasks/tasks.json`;
- `tasks/TASK-1.json`;
- docs skeleton;
- `.env.example`;
- README.

No product implementation.

### TASK-2 — Bootstrap pnpm monorepo

Create:

- package manager config;
- TypeScript base config;
- workspace packages/apps skeleton;
- basic lint/typecheck scripts.

### TASK-3 — Add Docker Compose base services

Create:

- Postgres;
- Redis;
- API placeholder;
- worker placeholder;
- MCP placeholder;
- optional profiles skeleton.

### TASK-4 — Add database schema MVP

Create Drizzle schema and migrations for:

- projects;
- access tokens;
- peers;
- sessions;
- messages;
- documents;
- attachments;
- chunks;
- memory claims;
- processing jobs.

### TASK-5 — Add API skeleton

Create Fastify app with:

- health/readiness;
- config loading;
- auth middleware placeholder;
- project endpoints;
- basic error handling;
- structured logging.

### TASK-6 — Add object storage adapters

Create:

- `ObjectStorage` interface;
- local-fs adapter;
- S3/MinIO adapter skeleton.

### TASK-7 — Add Redis/BullMQ queue

Create:

- queue interface;
- BullMQ implementation;
- processing job creation flow;
- worker base runner.

### TASK-8 — Add document upload and scan pipeline

Create:

- document upload API;
- document storage;
- processing job;
- ClamAV adapter;
- scan statuses.

### TASK-9 — Add extraction/chunking/indexing

Create:

- text/markdown extraction;
- chunking;
- embeddings interface;
- pgvector index implementation or placeholder depending on task scope.

### TASK-10 — Add MemoryClaim and ContextBuilder

Create:

- manual memory remember;
- memory search;
- memory explain;
- context build.

### TASK-11 — Add MCP server

Create MCP tools over HTTP/core services.

### TASK-12 — Add CLI

Create CLI commands for project/session/document/memory/context/job operations.

### TASK-13 — Add Hermes adapter MVP

Create Hermes integration package that maps Hermes lifecycle to Mindory HTTP API.

---

## 30. Final instruction to Codex

When working on this repository:

1. Do not start implementation until `tasks/` and `AGENTS.md` exist.
2. Always read `tasks/tasks.json` and the current task file first.
3. Implement only the current task scope.
4. Keep `master` green.
5. Keep `.env.example` and docs current.
6. Avoid unnecessary custom code when a mature library or framework feature exists.
7. Keep module boundaries clear.
8. Preserve future scalability without implementing non-MVP features prematurely.

Mindory should start small, but its architecture must be strong enough to grow into a central memory system for agents, teams and eventually enterprise-scale deployments.
