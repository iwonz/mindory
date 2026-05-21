CREATE TYPE processing_run_status AS ENUM ('running', 'succeeded', 'failed', 'superseded');
CREATE TYPE document_artifact_type AS ENUM (
  'raw_metadata',
  'text',
  'ocr_text',
  'transcript',
  'image_caption',
  'image_analysis',
  'image_embedding',
  'pdf_page',
  'video_keyframe',
  'face_observation',
  'metadata'
);
CREATE TYPE face_identity_status AS ENUM ('candidate', 'confirmed', 'archived');

CREATE TABLE processing_runs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  status processing_run_status NOT NULL DEFAULT 'running',
  reason text NOT NULL,
  processor_version text NOT NULL,
  config_fingerprint text NOT NULL,
  model_runtime_fingerprint text,
  source_document_storage_key text NOT NULL,
  source_document_checksum text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_artifacts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  processing_run_id text NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  parent_artifact_id text,
  artifact_type document_artifact_type NOT NULL,
  artifact_index integer NOT NULL DEFAULT 0,
  storage_key text,
  content text,
  content_hash text,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  source jsonb NOT NULL DEFAULT '{"type":"unknown"}'::jsonb,
  source_position jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_provider text,
  model_name text,
  model_version text,
  config_fingerprint text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_artifacts_index_nonnegative CHECK (artifact_index >= 0),
  CONSTRAINT document_artifacts_has_payload CHECK (
    storage_key IS NOT NULL OR content IS NOT NULL OR jsonb_array_length(source_refs) > 0 OR metadata <> '{}'::jsonb
  )
);

CREATE TABLE document_artifact_vectors (
  embedding_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  artifact_id text NOT NULL REFERENCES document_artifacts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_artifact_vectors_dimensions_positive CHECK (dimensions > 0)
);

CREATE TABLE document_artifact_text_spans (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  artifact_id text NOT NULL REFERENCES document_artifacts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  span_type text NOT NULL,
  content text NOT NULL,
  start_offset integer,
  end_offset integer,
  page_number integer,
  frame_index integer,
  timestamp_ms integer,
  bounding_box jsonb,
  confidence real,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_artifact_text_spans_offsets_valid CHECK (
    start_offset IS NULL OR end_offset IS NULL OR end_offset >= start_offset
  ),
  CONSTRAINT document_artifact_text_spans_confidence_range CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

CREATE TABLE document_media_metadata (
  document_id text PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  media_type text NOT NULL,
  duration_ms integer,
  width integer,
  height integer,
  page_count integer,
  frame_count integer,
  codec text,
  container text,
  language text,
  checksum_sha256 text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_media_metadata_duration_nonnegative CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT document_media_metadata_dimensions_positive CHECK (
    (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
  ),
  CONSTRAINT document_media_metadata_counts_nonnegative CHECK (
    (page_count IS NULL OR page_count >= 0) AND (frame_count IS NULL OR frame_count >= 0)
  )
);

CREATE TABLE document_metadata_index (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  processing_run_id text REFERENCES processing_runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  artifact_id text REFERENCES document_artifacts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  key text NOT NULL,
  value_text text,
  value_number real,
  value_boolean boolean,
  value_timestamp timestamptz,
  unit text,
  source text NOT NULL DEFAULT 'derived',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_metadata_index_has_value CHECK (
    value_text IS NOT NULL
    OR value_number IS NOT NULL
    OR value_boolean IS NOT NULL
    OR value_timestamp IS NOT NULL
  )
);

CREATE TABLE face_identities (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  label text,
  status face_identity_status NOT NULL DEFAULT 'candidate',
  representative_artifact_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE face_observations (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  artifact_id text NOT NULL REFERENCES document_artifacts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  processing_run_id text NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  face_identity_id text REFERENCES face_identities(id) ON DELETE SET NULL ON UPDATE CASCADE,
  embedding_id text,
  embedding vector(512),
  model text,
  bounding_box jsonb NOT NULL,
  confidence real,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT face_observations_confidence_range CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

CREATE INDEX processing_runs_project_document_idx ON processing_runs (project_id, document_id);
CREATE INDEX processing_runs_project_status_idx ON processing_runs (project_id, status);
CREATE INDEX processing_runs_document_status_idx ON processing_runs (document_id, status);

CREATE UNIQUE INDEX document_artifacts_run_type_index_idx ON document_artifacts (
  processing_run_id,
  artifact_type,
  parent_artifact_id,
  artifact_index
);
CREATE INDEX document_artifacts_project_document_idx ON document_artifacts (project_id, document_id);
CREATE INDEX document_artifacts_document_type_idx ON document_artifacts (document_id, artifact_type);
CREATE INDEX document_artifacts_processing_run_idx ON document_artifacts (processing_run_id);
CREATE INDEX document_artifacts_source_refs_idx ON document_artifacts USING gin (source_refs);

CREATE UNIQUE INDEX document_artifact_vectors_artifact_id_idx ON document_artifact_vectors (artifact_id);
CREATE INDEX document_artifact_vectors_project_id_idx ON document_artifact_vectors (project_id);
CREATE INDEX document_artifact_vectors_document_id_idx ON document_artifact_vectors (document_id);
CREATE INDEX document_artifact_vectors_embedding_hnsw_idx ON document_artifact_vectors USING hnsw (embedding vector_cosine_ops);

CREATE INDEX document_artifact_text_spans_artifact_idx ON document_artifact_text_spans (artifact_id);
CREATE INDEX document_artifact_text_spans_document_idx ON document_artifact_text_spans (document_id);
CREATE INDEX document_artifact_text_spans_project_type_idx ON document_artifact_text_spans (project_id, span_type);

CREATE INDEX document_media_metadata_project_type_idx ON document_media_metadata (project_id, media_type);
CREATE INDEX document_media_metadata_duration_idx ON document_media_metadata (project_id, duration_ms);

CREATE INDEX document_metadata_index_project_key_idx ON document_metadata_index (project_id, key);
CREATE INDEX document_metadata_index_document_key_idx ON document_metadata_index (document_id, key);
CREATE INDEX document_metadata_index_key_number_idx ON document_metadata_index (project_id, key, value_number);
CREATE INDEX document_metadata_index_key_text_idx ON document_metadata_index (project_id, key, value_text);

CREATE INDEX face_identities_project_status_idx ON face_identities (project_id, status);
CREATE UNIQUE INDEX face_identities_project_label_idx ON face_identities (project_id, label);

CREATE INDEX face_observations_project_document_idx ON face_observations (project_id, document_id);
CREATE INDEX face_observations_identity_idx ON face_observations (face_identity_id);
CREATE INDEX face_observations_artifact_idx ON face_observations (artifact_id);
CREATE UNIQUE INDEX face_observations_embedding_id_idx ON face_observations (embedding_id);
CREATE INDEX face_observations_embedding_hnsw_idx ON face_observations USING hnsw (embedding vector_cosine_ops);
