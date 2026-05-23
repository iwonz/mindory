export interface UiConfig {
  apiUrl: string;
}

export interface StoredConnection {
  apiUrl: string;
  token: string;
}

export interface HealthResponse {
  status?: string;
  service?: string;
  uptime_ms?: number;
  timestamp?: string;
  message?: string;
  checks?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface Peer {
  id: string;
  project_id: string;
  type: string;
  name: string;
  external_id?: string | null;
}

export interface Session {
  id: string;
  project_id: string;
  title?: string | null;
  status?: string;
  source?: Record<string, unknown>;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Message {
  id: string;
  project_id: string;
  session_id: string;
  author_peer_id: string;
  role: string;
  content: string;
  source?: Record<string, unknown>;
  created_at?: string;
}

export type DocumentStatus =
  | "uploaded"
  | "scanning"
  | "quarantined"
  | "clean"
  | "processing"
  | "indexed"
  | "failed";

export interface DocumentRecord {
  id: string;
  project_id: string;
  title?: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  status: DocumentStatus | string;
  source?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface UploadDocumentResponse {
  request_id: string;
  document: DocumentRecord;
  scan_job: UploadJobRef | null;
  route_job: UploadJobRef | null;
}

export interface UploadJobRef {
  id: string;
  queue_job_id: string;
  queue_name: string;
}

export type ProcessingRunStatus = "running" | "succeeded" | "failed" | "superseded" | string;

export interface ProcessingRun {
  id: string;
  project_id: string;
  document_id: string;
  status: ProcessingRunStatus;
  reason: string;
  processor_version: string;
  config_fingerprint: string;
  model_runtime_fingerprint: string | null;
  source_document_storage_key: string;
  source_document_checksum: string | null;
  metadata?: Record<string, unknown>;
  started_at?: string;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentArtifact {
  id: string;
  project_id: string;
  document_id: string;
  processing_run_id: string;
  parent_artifact_id: string | null;
  artifact_type: string;
  artifact_index: number;
  storage_key: string | null;
  content: string | null;
  content_hash: string | null;
  source_refs: SourceRef[];
  source?: Record<string, unknown>;
  source_position?: Record<string, unknown>;
  model_provider: string | null;
  model_name: string | null;
  model_version: string | null;
  config_fingerprint: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ProcessingJob {
  id: string;
  project_id: string;
  type: string;
  target_type: string;
  target_id: string;
  status: string;
  idempotency_key: string;
  processor_version: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface RecomputeDocumentResponse {
  request_id: string;
  recompute_request_id: string;
  processing_run_id: string;
  stages: string[];
  document: DocumentRecord;
  job: UploadJobRef;
}

export interface JobRetryResponse {
  job: ProcessingJob;
  retry: {
    queue_name: string;
    queue_job_id: string;
    processing_job_id: string;
  };
}

export interface SourceRef {
  type: string;
  id: string;
}

export type UnifiedSearchTarget = "documents" | "artifacts" | "faces";

export interface MetadataFilter {
  key: string;
  operator?: "eq" | "lt" | "lte" | "gt" | "gte" | "between";
  valueText?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueTimestamp?: string;
  minNumber?: number;
  maxNumber?: number;
  unit?: string;
}

export interface UnifiedSearchHit {
  kind: string;
  project_id: string;
  document_id: string;
  chunk_id: string | null;
  artifact_id: string | null;
  artifact_type: string | null;
  span_id: string | null;
  span_type: string | null;
  face_observation_id: string | null;
  face_identity_id: string | null;
  content: string;
  score: number;
  source_refs: SourceRef[];
  source_position?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ContextBlock {
  type: string;
  content: string;
  source_refs: SourceRef[];
  score: number | null;
  metadata?: Record<string, unknown>;
}

export interface ContextBuildResult {
  blocks: ContextBlock[];
  debug: {
    searchedProjects: string[];
    memoryHits: number;
    documentHits: number;
    recentMessageHits: number;
    sessionSummaryIncluded: boolean;
    tokenBudget: number;
    usedTokens: number;
  };
}

export interface MemoryClaim {
  id: string;
  project_id: string;
  type: string;
  text: string;
  status: string;
  importance: number;
  confidence: number;
  source_refs: SourceRef[];
  created_source?: Record<string, unknown>;
  created_by_peer_id: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface MemorySearchHit {
  memory: MemoryClaim;
  score: number;
  match_reason: string | null;
}

export interface FaceIdentity {
  id: string;
  project_id: string;
  label: string | null;
  status: string;
  representative_artifact_id: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface FaceObservation {
  id: string;
  project_id: string;
  document_id: string;
  artifact_id: string;
  processing_run_id: string;
  face_identity_id: string | null;
  embedding_id: string | null;
  model: string | null;
  bounding_box?: Record<string, unknown>;
  confidence: number | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface FaceMergeResponse {
  source: FaceIdentity;
  target: FaceIdentity;
  reassigned_observations: number;
}

declare global {
  interface Window {
    __MINDORY_UI_CONFIG__?: UiConfig;
  }
}
