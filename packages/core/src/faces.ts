import { createHash, randomUUID } from "node:crypto";
import type {
  CreateFaceObservationInput,
  DerivedArtifactRepository,
  FaceIdentityRecord,
  FaceIdentityStatus,
  FaceObservationRecord,
  ListFaceIdentitiesInput,
  ListFaceObservationsInput
} from "./artifacts.js";

export interface FaceMatchPolicy {
  similarityThreshold: number;
  candidateStatus: FaceIdentityStatus;
}

export interface FaceServiceOptions {
  repository: DerivedArtifactRepository;
  idFactory?: () => string;
  matchPolicy?: Partial<FaceMatchPolicy>;
}

export interface RecordFaceObservationInput extends Omit<CreateFaceObservationInput, "faceIdentityId"> {
  faceIdentityId?: string | null;
  autoMatch?: boolean;
}

export interface RecordFaceObservationResult {
  identity: FaceIdentityRecord;
  observation: FaceObservationRecord;
  match: {
    matched: boolean;
    similarity: number | null;
    threshold: number;
  };
}

export interface RenameFaceIdentityInput {
  projectId: string;
  identityId: string;
  label: string | null;
}

export interface MergeFaceIdentitiesInput {
  projectId: string;
  sourceIdentityId: string;
  targetIdentityId: string;
}

export interface MergeFaceIdentitiesResult {
  source: FaceIdentityRecord;
  target: FaceIdentityRecord;
  reassignedObservations: number;
}

const defaultMatchPolicy: FaceMatchPolicy = {
  similarityThreshold: 0.9,
  candidateStatus: "candidate"
};

export class FaceService {
  private readonly repository: DerivedArtifactRepository;
  private readonly idFactory: () => string;
  private readonly matchPolicy: FaceMatchPolicy;

  constructor(options: FaceServiceOptions) {
    this.repository = options.repository;
    this.idFactory = options.idFactory ?? randomUUID;
    this.matchPolicy = {
      ...defaultMatchPolicy,
      ...(options.matchPolicy ?? {})
    };
  }

  listIdentities(input: ListFaceIdentitiesInput): Promise<FaceIdentityRecord[]> {
    return this.repository.listFaceIdentities(input);
  }

  listObservations(input: ListFaceObservationsInput): Promise<FaceObservationRecord[]> {
    return this.repository.listFaceObservations(input);
  }

  getIdentity(projectId: string, identityId: string): Promise<FaceIdentityRecord> {
    return this.repository.getFaceIdentity(projectId, identityId);
  }

  async renameIdentity(input: RenameFaceIdentityInput): Promise<FaceIdentityRecord> {
    const identity = await this.repository.getFaceIdentity(input.projectId, input.identityId);
    return this.repository.updateFaceIdentity({
      projectId: input.projectId,
      identityId: input.identityId,
      label: input.label,
      metadata: {
        ...identity.metadata,
        renamed_at: new Date().toISOString()
      }
    });
  }

  async mergeIdentities(input: MergeFaceIdentitiesInput): Promise<MergeFaceIdentitiesResult> {
    if (input.sourceIdentityId === input.targetIdentityId) {
      throw new FaceServiceError("invalid_face_merge", "Source and target face identities must differ.");
    }

    const [source, target] = await Promise.all([
      this.repository.getFaceIdentity(input.projectId, input.sourceIdentityId),
      this.repository.getFaceIdentity(input.projectId, input.targetIdentityId)
    ]);
    const reassignedObservations = await this.repository.reassignFaceObservations({
      projectId: input.projectId,
      fromIdentityId: source.id,
      toIdentityId: target.id
    });
    const archivedSource = await this.repository.updateFaceIdentity({
      projectId: input.projectId,
      identityId: source.id,
      status: "archived",
      metadata: {
        ...source.metadata,
        merged_into_identity_id: target.id,
        merged_at: new Date().toISOString()
      }
    });

    return {
      source: archivedSource,
      target,
      reassignedObservations
    };
  }

  async recordObservation(input: RecordFaceObservationInput): Promise<RecordFaceObservationResult> {
    const match = input.faceIdentityId
      ? await this.matchExplicitIdentity(input.projectId, input.faceIdentityId)
      : input.autoMatch === false
        ? {
            identity: await this.createCandidateIdentity(input),
            matched: false,
            similarity: null
          }
        : await this.matchOrCreateIdentity(input);

    const observation = await this.repository.createFaceObservation({
      ...input,
      faceIdentityId: match.identity.id,
      metadata: {
        ...(input.metadata ?? {}),
        auto_match: {
          matched: match.matched,
          similarity: match.similarity,
          threshold: this.matchPolicy.similarityThreshold
        }
      }
    });

    return {
      identity: match.identity,
      observation,
      match: {
        matched: match.matched,
        similarity: match.similarity,
        threshold: this.matchPolicy.similarityThreshold
      }
    };
  }

  private async matchExplicitIdentity(projectId: string, identityId: string): Promise<FaceIdentityMatchResult> {
    return {
      identity: await this.repository.getFaceIdentity(projectId, identityId),
      matched: true,
      similarity: 1
    };
  }

  private async matchOrCreateIdentity(input: RecordFaceObservationInput): Promise<FaceIdentityMatchResult> {
    const embedding = input.embedding;
    if (!embedding || embedding.length === 0) {
      const identity = await this.createCandidateIdentity(input);
      return {
        identity,
        matched: false,
        similarity: null
      };
    }

    const observations = await this.repository.listFaceObservations({
      projectId: input.projectId,
      limit: 1000
    });
    const best = observations
      .filter((observation) => observation.faceIdentityId && observation.embedding && observation.embedding.length === embedding.length)
      .map((observation) => ({
        identityId: observation.faceIdentityId as string,
        similarity: cosineSimilarity(embedding, observation.embedding as number[])
      }))
      .sort((left, right) => right.similarity - left.similarity)[0];

    if (best && best.similarity >= this.matchPolicy.similarityThreshold) {
      return {
        identity: await this.repository.getFaceIdentity(input.projectId, best.identityId),
        matched: true,
        similarity: best.similarity
      };
    }

    const identity = await this.createCandidateIdentity(input);
    return {
      identity,
      matched: false,
      similarity: best?.similarity ?? null
    };
  }

  private async createCandidateIdentity(input: RecordFaceObservationInput): Promise<FaceIdentityRecord> {
    const id = deterministicIdentityId(input.projectId, input.embedding, this.idFactory);
    const representativeArtifactId = input.artifactId;
    return this.repository.createFaceIdentity({
      id,
      projectId: input.projectId,
      status: this.matchPolicy.candidateStatus,
      representativeArtifactId,
      metadata: {
        created_by: "face.auto_match",
        model: input.model ?? null,
        created_from_observation_id: input.id
      }
    });
  }
}

export class FaceServiceError extends Error {
  readonly code: "invalid_face_merge";

  constructor(code: "invalid_face_merge", message: string) {
    super(message);
    this.name = "FaceServiceError";
    this.code = code;
  }
}

function deterministicIdentityId(projectId: string, embedding: number[] | null | undefined, fallbackIdFactory: () => string): string {
  if (!embedding || embedding.length === 0) {
    return `face_${fallbackIdFactory()}`;
  }
  const fingerprint = embedding.map((value) => value.toFixed(6)).join(",");
  return `face_${hashIdentifier(`${projectId}:${fingerprint}`).slice(0, 32)}`;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

interface FaceIdentityMatchResult {
  identity: FaceIdentityRecord;
  matched: boolean;
  similarity: number | null;
}
