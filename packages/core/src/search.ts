import type {
  ArtifactSearchHit,
  DerivedArtifactRepository,
  DocumentArtifactType,
  DocumentMetadataFilter,
  FaceIdentityStatus,
  FaceObservationSearchHit
} from "./artifacts.js";
import type { DocumentChunkSearchHit, DocumentChunkSearchRepository, SourceRef } from "./memory.js";

export type UnifiedSearchTarget = "documents" | "artifacts" | "faces";

export interface ArtifactVectorSearchInput {
  projectIds: string[];
  query: string;
  artifactTypes?: DocumentArtifactType[];
  metadataFilters?: DocumentMetadataFilter[];
  limit: number;
}

export interface ArtifactVectorSearchHit {
  projectId: string;
  documentId: string;
  artifactId: string;
  artifactType: DocumentArtifactType;
  content: string;
  score: number;
  sourceRefs: SourceRef[];
  sourcePosition: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ArtifactVectorSearchRepository {
  searchArtifactVectors(input: ArtifactVectorSearchInput): Promise<ArtifactVectorSearchHit[]>;
}

export interface UnifiedSearchInput {
  projectIds: string[];
  query?: string;
  targets?: UnifiedSearchTarget[];
  artifactTypes?: DocumentArtifactType[];
  spanTypes?: string[];
  faceIdentityStatuses?: FaceIdentityStatus[];
  metadataFilters?: DocumentMetadataFilter[];
  limit: number;
}

export type UnifiedSearchHitKind = "document_chunk" | "artifact_span" | "artifact_vector" | "face_observation";

export interface UnifiedSearchHit {
  kind: UnifiedSearchHitKind;
  projectId: string;
  documentId: string;
  content: string;
  score: number;
  sourceRefs: SourceRef[];
  sourcePosition: Record<string, unknown>;
  metadata: Record<string, unknown>;
  chunkId?: string;
  artifactId?: string;
  spanId?: string;
  spanType?: string;
  artifactType?: DocumentArtifactType;
  faceObservationId?: string;
  faceIdentityId?: string | null;
}

export interface UnifiedSearchServiceOptions {
  documentRepository?: DocumentChunkSearchRepository;
  artifactRepository?: DerivedArtifactRepository;
  artifactVectorRepository?: ArtifactVectorSearchRepository;
}

export class UnifiedSearchService {
  private readonly documentRepository: DocumentChunkSearchRepository | undefined;
  private readonly artifactRepository: DerivedArtifactRepository | undefined;
  private readonly artifactVectorRepository: ArtifactVectorSearchRepository | undefined;

  constructor(options: UnifiedSearchServiceOptions = {}) {
    this.documentRepository = options.documentRepository;
    this.artifactRepository = options.artifactRepository;
    this.artifactVectorRepository = options.artifactVectorRepository;
  }

  async search(input: UnifiedSearchInput): Promise<UnifiedSearchHit[]> {
    validateUnifiedSearchInput(input);
    const targets = normalizeTargets(input.targets);
    const query = normalizeQuery(input.query);
    const hits: UnifiedSearchHit[] = [];

    if (targets.includes("documents") && query && this.documentRepository) {
      const documentSearchInput = {
        projectIds: input.projectIds,
        query,
        limit: input.limit
      };
      if (input.metadataFilters !== undefined) {
        Object.assign(documentSearchInput, { metadataFilters: input.metadataFilters });
      }
      hits.push(...(await this.documentRepository.searchDocumentChunks(documentSearchInput)).map(toDocumentChunkHit));
    }

    if (targets.includes("artifacts") && this.artifactRepository && hasArtifactSearchConstraint(input, query)) {
      const artifactSearchInput = {
        projectIds: input.projectIds,
        limit: input.limit
      };
      if (query !== undefined) {
        Object.assign(artifactSearchInput, { query });
      }
      if (input.artifactTypes !== undefined) {
        Object.assign(artifactSearchInput, { artifactTypes: input.artifactTypes });
      }
      if (input.spanTypes !== undefined) {
        Object.assign(artifactSearchInput, { spanTypes: input.spanTypes });
      }
      if (input.metadataFilters !== undefined) {
        Object.assign(artifactSearchInput, { metadataFilters: input.metadataFilters });
      }
      hits.push(...(await this.artifactRepository.searchArtifacts(artifactSearchInput)).map(toArtifactSpanHit));
    }

    if (targets.includes("artifacts") && query && this.artifactVectorRepository) {
      const artifactVectorSearchInput = {
        projectIds: input.projectIds,
        query,
        limit: input.limit
      };
      if (input.artifactTypes !== undefined) {
        Object.assign(artifactVectorSearchInput, { artifactTypes: input.artifactTypes });
      }
      if (input.metadataFilters !== undefined) {
        Object.assign(artifactVectorSearchInput, { metadataFilters: input.metadataFilters });
      }
      hits.push(...(await this.artifactVectorRepository.searchArtifactVectors(artifactVectorSearchInput)).map(toArtifactVectorHit));
    }

    if (targets.includes("faces") && this.artifactRepository && hasFaceSearchConstraint(input, query)) {
      const faceSearchInput = {
        projectIds: input.projectIds,
        limit: input.limit
      };
      if (query !== undefined) {
        Object.assign(faceSearchInput, { query });
      }
      if (input.faceIdentityStatuses !== undefined) {
        Object.assign(faceSearchInput, { statuses: input.faceIdentityStatuses });
      }
      if (input.metadataFilters !== undefined) {
        Object.assign(faceSearchInput, { metadataFilters: input.metadataFilters });
      }
      hits.push(...(await this.artifactRepository.searchFaceObservations(faceSearchInput)).map(toFaceObservationHit));
    }

    return hits
      .sort((left, right) => right.score - left.score || sortKey(left).localeCompare(sortKey(right)))
      .slice(0, input.limit);
  }
}

function validateUnifiedSearchInput(input: UnifiedSearchInput): void {
  if (input.projectIds.length === 0) {
    throw new SearchError("invalid_search_scope", "At least one project id is required for unified search.");
  }
  if (input.limit <= 0) {
    throw new SearchError("invalid_limit", "Unified search limit must be greater than zero.");
  }
  if (!hasSearchConstraint(input, normalizeQuery(input.query))) {
    throw new SearchError("invalid_search_query", "Unified search requires query, metadataFilters or a constrained target/type filter.");
  }
}

function hasSearchConstraint(input: UnifiedSearchInput, query: string | undefined): boolean {
  return Boolean(
    query
    || (input.metadataFilters && input.metadataFilters.length > 0)
    || (input.artifactTypes && input.artifactTypes.length > 0)
    || (input.spanTypes && input.spanTypes.length > 0)
    || (input.faceIdentityStatuses && input.faceIdentityStatuses.length > 0)
  );
}

function hasArtifactSearchConstraint(input: UnifiedSearchInput, query: string | undefined): boolean {
  return Boolean(
    query
    || (input.metadataFilters && input.metadataFilters.length > 0)
    || (input.artifactTypes && input.artifactTypes.length > 0)
    || (input.spanTypes && input.spanTypes.length > 0)
  );
}

function hasFaceSearchConstraint(input: UnifiedSearchInput, query: string | undefined): boolean {
  return Boolean(
    query
    || (input.metadataFilters && input.metadataFilters.length > 0)
    || (input.faceIdentityStatuses && input.faceIdentityStatuses.length > 0)
  );
}

function normalizeTargets(targets: UnifiedSearchTarget[] | undefined): UnifiedSearchTarget[] {
  if (!targets || targets.length === 0) {
    return ["documents", "artifacts", "faces"];
  }
  return Array.from(new Set(targets));
}

function normalizeQuery(query: string | undefined): string | undefined {
  const normalized = query?.trim();
  return normalized ? normalized : undefined;
}

function toDocumentChunkHit(hit: DocumentChunkSearchHit): UnifiedSearchHit {
  const sourceRefs = hit.sourceRefs ?? [{ type: "chunk", id: hit.chunkId }];
  return {
    kind: "document_chunk",
    projectId: hit.projectId,
    documentId: hit.documentId,
    chunkId: hit.chunkId,
    content: hit.content,
    score: hit.score,
    sourceRefs,
    sourcePosition: readRecord(hit.metadata?.source_position),
    metadata: {
      ...(hit.metadata ?? {}),
      search_target: "documents",
      source_refs: sourceRefs
    }
  };
}

function toArtifactSpanHit(hit: ArtifactSearchHit): UnifiedSearchHit {
  return {
    kind: "artifact_span",
    projectId: hit.projectId,
    documentId: hit.documentId,
    artifactId: hit.artifactId,
    artifactType: hit.artifactType,
    spanId: hit.spanId,
    spanType: hit.spanType,
    content: hit.content,
    score: hit.score,
    sourceRefs: hit.sourceRefs,
    sourcePosition: hit.sourcePosition,
    metadata: {
      ...hit.metadata,
      search_target: "artifacts"
    }
  };
}

function toArtifactVectorHit(hit: ArtifactVectorSearchHit): UnifiedSearchHit {
  return {
    kind: "artifact_vector",
    projectId: hit.projectId,
    documentId: hit.documentId,
    artifactId: hit.artifactId,
    artifactType: hit.artifactType,
    content: hit.content,
    score: hit.score,
    sourceRefs: hit.sourceRefs,
    sourcePosition: hit.sourcePosition,
    metadata: {
      ...hit.metadata,
      search_target: "artifacts"
    }
  };
}

function toFaceObservationHit(hit: FaceObservationSearchHit): UnifiedSearchHit {
  const sourceRefs: SourceRef[] = [
    { type: "document", id: hit.documentId },
    { type: "artifact", id: hit.artifactId },
    { type: "processing_run", id: hit.processingRunId },
    { type: "face_observation", id: hit.faceObservationId }
  ];
  if (hit.faceIdentityId) {
    sourceRefs.push({ type: "face_identity", id: hit.faceIdentityId });
  }

  const label = hit.faceIdentityLabel ?? hit.faceIdentityId ?? "unlabeled";
  return {
    kind: "face_observation",
    projectId: hit.projectId,
    documentId: hit.documentId,
    artifactId: hit.artifactId,
    faceObservationId: hit.faceObservationId,
    faceIdentityId: hit.faceIdentityId,
    content: `Face observation for ${label}.`,
    score: hit.score,
    sourceRefs,
    sourcePosition: {
      bounding_box: hit.boundingBox,
      confidence: hit.confidence
    },
    metadata: {
      ...hit.metadata,
      search_target: "faces",
      search_backend: "face_observations",
      face_identity_label: hit.faceIdentityLabel,
      face_identity_status: hit.faceIdentityStatus,
      model: hit.model
    }
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sortKey(hit: UnifiedSearchHit): string {
  return [
    hit.kind,
    hit.projectId,
    hit.documentId,
    hit.artifactId ?? "",
    hit.spanId ?? "",
    hit.chunkId ?? "",
    hit.faceObservationId ?? ""
  ].join(":");
}

export type SearchErrorCode = "invalid_limit" | "invalid_search_query" | "invalid_search_scope";

export class SearchError extends Error {
  readonly code: SearchErrorCode;

  constructor(code: SearchErrorCode, message: string) {
    super(message);
    this.name = "SearchError";
    this.code = code;
  }
}
