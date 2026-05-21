CREATE TYPE access_token_status AS ENUM ('active', 'revoked', 'expired');
CREATE TYPE peer_type AS ENUM ('human', 'agent', 'service', 'automation', 'group');
CREATE TYPE session_status AS ENUM ('active', 'idle', 'archived');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system', 'tool', 'event');
CREATE TYPE document_status AS ENUM (
  'uploaded',
  'scan_pending',
  'scan_clean',
  'scan_infected',
  'scan_failed',
  'quarantined',
  'extract_pending',
  'extracted',
  'chunk_pending',
  'chunked',
  'embed_pending',
  'indexed',
  'failed'
);
CREATE TYPE memory_claim_type AS ENUM (
  'semantic',
  'episodic',
  'preference',
  'decision',
  'task',
  'artifact_reference',
  'derived'
);
CREATE TYPE memory_claim_status AS ENUM ('candidate', 'active', 'rejected', 'archived');
CREATE TYPE processing_job_type AS ENUM (
  'document.scan',
  'document.extract',
  'document.chunk',
  'document.embed',
  'document.index',
  'memory.derive',
  'session.summarize'
);
CREATE TYPE processing_job_status AS ENUM ('pending', 'running', 'succeeded', 'failed', 'dead');

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_tokens (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL,
  status access_token_status NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  last_used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_token_project_scopes (
  token_id text NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE ON UPDATE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  permissions text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_token_project_scopes_pkey PRIMARY KEY (token_id, project_id)
);

CREATE TABLE peers (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  type peer_type NOT NULL,
  name text NOT NULL,
  external_id text,
  source jsonb NOT NULL DEFAULT '{"type":"unknown"}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  title text,
  status session_status NOT NULL DEFAULT 'active',
  source jsonb NOT NULL DEFAULT '{"type":"unknown"}'::jsonb,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session_peers (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  peer_id text NOT NULL REFERENCES peers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_peers_pkey PRIMARY KEY (session_id, peer_id)
);

CREATE TABLE messages (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  author_peer_id text NOT NULL REFERENCES peers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  role message_role NOT NULL,
  content text NOT NULL,
  source jsonb NOT NULL DEFAULT '{"type":"unknown"}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  title text,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  status document_status NOT NULL DEFAULT 'uploaded',
  source jsonb NOT NULL DEFAULT '{"type":"unknown"}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_size_bytes_nonnegative CHECK (size_bytes >= 0)
);

CREATE TABLE attachments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  source jsonb NOT NULL DEFAULT '{"type":"unknown"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_count integer,
  embedding_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chunks_chunk_index_nonnegative CHECK (chunk_index >= 0),
  CONSTRAINT chunks_token_count_nonnegative CHECK (token_count IS NULL OR token_count >= 0)
);

CREATE TABLE chunk_vector_embeddings (
  embedding_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  chunk_id text NOT NULL REFERENCES chunks(id) ON DELETE CASCADE ON UPDATE CASCADE,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chunk_vector_embeddings_dimensions_positive CHECK (dimensions > 0)
);

CREATE TABLE memory_claims (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  type memory_claim_type NOT NULL,
  text text NOT NULL,
  status memory_claim_status NOT NULL DEFAULT 'candidate',
  importance real NOT NULL DEFAULT 0,
  confidence real NOT NULL DEFAULT 0,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_source jsonb NOT NULL DEFAULT '{"type":"unknown"}'::jsonb,
  created_by_peer_id text REFERENCES peers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_claims_importance_range CHECK (importance >= 0 AND importance <= 1),
  CONSTRAINT memory_claims_confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE processing_jobs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  type processing_job_type NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  status processing_job_status NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  processor_version text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT processing_jobs_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT processing_jobs_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE UNIQUE INDEX projects_name_idx ON projects (name);

CREATE UNIQUE INDEX access_tokens_token_hash_idx ON access_tokens (token_hash);
CREATE INDEX access_tokens_project_id_idx ON access_tokens (project_id);
CREATE INDEX access_tokens_status_idx ON access_tokens (status);
CREATE INDEX access_token_project_scopes_project_id_idx ON access_token_project_scopes (project_id);

CREATE INDEX peers_project_id_idx ON peers (project_id);
CREATE INDEX peers_project_type_idx ON peers (project_id, type);
CREATE UNIQUE INDEX peers_project_external_id_idx ON peers (project_id, external_id);

CREATE INDEX sessions_project_id_idx ON sessions (project_id);
CREATE INDEX sessions_project_status_idx ON sessions (project_id, status);
CREATE INDEX sessions_project_updated_at_idx ON sessions (project_id, updated_at);

CREATE INDEX session_peers_project_id_idx ON session_peers (project_id);
CREATE INDEX session_peers_peer_id_idx ON session_peers (peer_id);

CREATE INDEX messages_project_id_idx ON messages (project_id);
CREATE INDEX messages_session_created_at_idx ON messages (session_id, created_at);
CREATE INDEX messages_author_peer_id_idx ON messages (author_peer_id);

CREATE INDEX documents_project_id_idx ON documents (project_id);
CREATE INDEX documents_project_status_idx ON documents (project_id, status);
CREATE UNIQUE INDEX documents_storage_key_idx ON documents (storage_key);

CREATE UNIQUE INDEX attachments_message_document_idx ON attachments (message_id, document_id);
CREATE INDEX attachments_project_id_idx ON attachments (project_id);
CREATE INDEX attachments_document_id_idx ON attachments (document_id);

CREATE UNIQUE INDEX chunks_document_chunk_index_idx ON chunks (document_id, chunk_index);
CREATE INDEX chunks_project_id_idx ON chunks (project_id);
CREATE INDEX chunks_document_id_idx ON chunks (document_id);

CREATE UNIQUE INDEX chunk_vector_embeddings_chunk_id_idx ON chunk_vector_embeddings (chunk_id);
CREATE INDEX chunk_vector_embeddings_project_id_idx ON chunk_vector_embeddings (project_id);
CREATE INDEX chunk_vector_embeddings_document_id_idx ON chunk_vector_embeddings (document_id);
CREATE INDEX chunk_vector_embeddings_embedding_hnsw_idx ON chunk_vector_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE INDEX memory_claims_project_status_idx ON memory_claims (project_id, status);
CREATE INDEX memory_claims_created_by_peer_id_idx ON memory_claims (created_by_peer_id);
CREATE INDEX memory_claims_source_refs_idx ON memory_claims USING gin (source_refs);

CREATE UNIQUE INDEX processing_jobs_idempotency_key_idx ON processing_jobs (idempotency_key);
CREATE INDEX processing_jobs_project_status_idx ON processing_jobs (project_id, status);
CREATE INDEX processing_jobs_type_status_idx ON processing_jobs (type, status);
CREATE INDEX processing_jobs_target_idx ON processing_jobs (target_type, target_id);
