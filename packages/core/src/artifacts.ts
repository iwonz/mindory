import type { SourceSnapshot } from "./documents.js";
import type { SourceRef } from "./memory.js";
import type { DocumentProcessingRunRepository } from "./recompute.js";

export type ProcessingRunStatus = "running" | "succeeded" | "failed" | "superseded";

export type DocumentArtifactType =
  | "raw_metadata"
  | "text"
  | "ocr_text"
  | "transcript"
  | "image_caption"
  | "image_analysis"
  | "image_embedding"
  | "object_detection"
  | "pdf_page"
  | "video_keyframe"
  | "face_observation"
  | "metadata";

export type FaceIdentityStatus = "candidate" | "confirmed" | "archived";

export interface ProcessingRunRecord {
  id: string;
  projectId: string;
  documentId: string;
  status: ProcessingRunStatus;
  reason: string;
  processorVersion: string;
  configFingerprint: string;
  modelRuntimeFingerprint: string | null;
  sourceDocumentStorageKey: string;
  sourceDocumentChecksum: string | null;
  metadata: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProcessingRunInput {
  id: string;
  projectId: string;
  documentId: string;
  reason: string;
  processorVersion: string;
  configFingerprint: string;
  modelRuntimeFingerprint?: string | null;
  sourceDocumentStorageKey: string;
  sourceDocumentChecksum?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateProcessingRunStatusInput {
  projectId: string;
  runId: string;
  status: ProcessingRunStatus;
  metadata?: Record<string, unknown>;
  finishedAt?: Date | null;
}

export interface DocumentArtifactRecord {
  id: string;
  projectId: string;
  documentId: string;
  processingRunId: string;
  parentArtifactId: string | null;
  artifactType: DocumentArtifactType;
  artifactIndex: number;
  storageKey: string | null;
  content: string | null;
  contentHash: string | null;
  sourceRefs: SourceRef[];
  source: SourceSnapshot;
  sourcePosition: Record<string, unknown>;
  modelProvider: string | null;
  modelName: string | null;
  modelVersion: string | null;
  configFingerprint: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDocumentArtifactInput {
  id: string;
  projectId: string;
  documentId: string;
  processingRunId: string;
  artifactType: DocumentArtifactType;
  artifactIndex: number;
  parentArtifactId?: string | null;
  storageKey?: string | null;
  content?: string | null;
  contentHash?: string | null;
  sourceRefs?: SourceRef[];
  source?: SourceSnapshot;
  sourcePosition?: Record<string, unknown>;
  modelProvider?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  configFingerprint?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DocumentArtifactTextSpanRecord {
  id: string;
  projectId: string;
  documentId: string;
  artifactId: string;
  spanType: string;
  content: string;
  startOffset: number | null;
  endOffset: number | null;
  pageNumber: number | null;
  frameIndex: number | null;
  timestampMs: number | null;
  boundingBox: Record<string, unknown> | null;
  confidence: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateDocumentArtifactTextSpanInput {
  id: string;
  projectId: string;
  documentId: string;
  artifactId: string;
  spanType: string;
  content: string;
  startOffset?: number | null;
  endOffset?: number | null;
  pageNumber?: number | null;
  frameIndex?: number | null;
  timestampMs?: number | null;
  boundingBox?: Record<string, unknown> | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ReplaceDocumentArtifactTextSpansInput {
  projectId: string;
  documentId: string;
  artifactId: string;
  spans: CreateDocumentArtifactTextSpanInput[];
}

export type DocumentMetadataFilterOperator = "eq" | "lt" | "lte" | "gt" | "gte" | "between";

export interface DocumentMetadataFilter {
  key: string;
  operator?: DocumentMetadataFilterOperator;
  valueText?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueTimestamp?: string;
  minNumber?: number;
  maxNumber?: number;
  unit?: string;
}

export interface DocumentMediaMetadataRecord {
  documentId: string;
  projectId: string;
  mediaType: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  frameCount: number | null;
  codec: string | null;
  container: string | null;
  language: string | null;
  checksumSha256: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertDocumentMediaMetadataInput {
  projectId: string;
  documentId: string;
  mediaType: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  pageCount?: number | null;
  frameCount?: number | null;
  codec?: string | null;
  container?: string | null;
  language?: string | null;
  checksumSha256?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DocumentMetadataIndexRecord {
  id: string;
  projectId: string;
  documentId: string;
  processingRunId: string | null;
  artifactId: string | null;
  key: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueTimestamp: Date | null;
  unit: string | null;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateDocumentMetadataIndexInput {
  id: string;
  projectId: string;
  documentId: string;
  key: string;
  processingRunId?: string | null;
  artifactId?: string | null;
  valueText?: string | null;
  valueNumber?: number | null;
  valueBoolean?: boolean | null;
  valueTimestamp?: Date | null;
  unit?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface ReplaceDocumentMetadataIndexInput {
  projectId: string;
  documentId: string;
  source: string;
  entries: CreateDocumentMetadataIndexInput[];
}

export interface SearchArtifactsInput {
  projectIds: string[];
  query?: string;
  artifactTypes?: DocumentArtifactType[];
  spanTypes?: string[];
  metadataFilters?: DocumentMetadataFilter[];
  limit: number;
}

export interface ArtifactSearchHit {
  projectId: string;
  documentId: string;
  artifactId: string;
  artifactType: DocumentArtifactType;
  spanId: string;
  spanType: string;
  content: string;
  score: number;
  sourceRefs: SourceRef[];
  sourcePosition: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface SearchFaceObservationsInput {
  projectIds: string[];
  query?: string;
  statuses?: FaceIdentityStatus[];
  metadataFilters?: DocumentMetadataFilter[];
  limit: number;
}

export interface FaceObservationSearchHit {
  projectId: string;
  documentId: string;
  artifactId: string;
  processingRunId: string;
  faceObservationId: string;
  faceIdentityId: string | null;
  faceIdentityLabel: string | null;
  faceIdentityStatus: FaceIdentityStatus | null;
  boundingBox: Record<string, unknown>;
  confidence: number | null;
  model: string | null;
  score: number;
  metadata: Record<string, unknown>;
}

export interface FaceIdentityRecord {
  id: string;
  projectId: string;
  label: string | null;
  status: FaceIdentityStatus;
  representativeArtifactId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFaceIdentityInput {
  id: string;
  projectId: string;
  label?: string | null;
  status?: FaceIdentityStatus;
  representativeArtifactId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListFaceIdentitiesInput {
  projectId: string;
  statuses?: FaceIdentityStatus[];
  limit?: number;
}

export interface UpdateFaceIdentityInput {
  projectId: string;
  identityId: string;
  label?: string | null;
  status?: FaceIdentityStatus;
  representativeArtifactId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface FaceObservationRecord {
  id: string;
  projectId: string;
  documentId: string;
  artifactId: string;
  processingRunId: string;
  faceIdentityId: string | null;
  embeddingId: string | null;
  embedding: number[] | null;
  model: string | null;
  boundingBox: Record<string, unknown>;
  confidence: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateFaceObservationInput {
  id: string;
  projectId: string;
  documentId: string;
  artifactId: string;
  processingRunId: string;
  faceIdentityId?: string | null;
  embeddingId?: string | null;
  embedding?: number[] | null;
  model?: string | null;
  boundingBox: Record<string, unknown>;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ListFaceObservationsInput {
  projectId: string;
  identityId?: string | null;
  documentId?: string;
  limit?: number;
}

export interface ReassignFaceObservationsInput {
  projectId: string;
  fromIdentityId: string;
  toIdentityId: string;
}

export interface DerivedArtifactRepository extends DocumentProcessingRunRepository {
  createProcessingRun(input: CreateProcessingRunInput): Promise<ProcessingRunRecord>;
  updateProcessingRunStatus(input: UpdateProcessingRunStatusInput): Promise<ProcessingRunRecord>;
  createDocumentArtifact(input: CreateDocumentArtifactInput): Promise<DocumentArtifactRecord>;
  listDocumentArtifacts(projectId: string, documentId: string): Promise<DocumentArtifactRecord[]>;
  replaceDocumentArtifactTextSpans(input: ReplaceDocumentArtifactTextSpansInput): Promise<DocumentArtifactTextSpanRecord[]>;
  upsertDocumentMediaMetadata(input: UpsertDocumentMediaMetadataInput): Promise<DocumentMediaMetadataRecord>;
  replaceDocumentMetadataIndex(input: ReplaceDocumentMetadataIndexInput): Promise<DocumentMetadataIndexRecord[]>;
  searchArtifacts(input: SearchArtifactsInput): Promise<ArtifactSearchHit[]>;
  searchFaceObservations(input: SearchFaceObservationsInput): Promise<FaceObservationSearchHit[]>;
  createFaceIdentity(input: CreateFaceIdentityInput): Promise<FaceIdentityRecord>;
  getFaceIdentity(projectId: string, identityId: string): Promise<FaceIdentityRecord>;
  listFaceIdentities(input: ListFaceIdentitiesInput): Promise<FaceIdentityRecord[]>;
  updateFaceIdentity(input: UpdateFaceIdentityInput): Promise<FaceIdentityRecord>;
  createFaceObservation(input: CreateFaceObservationInput): Promise<FaceObservationRecord>;
  listFaceObservations(input: ListFaceObservationsInput): Promise<FaceObservationRecord[]>;
  reassignFaceObservations(input: ReassignFaceObservationsInput): Promise<number>;
}
