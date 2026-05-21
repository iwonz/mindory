import { and, asc, eq } from "drizzle-orm";
import type {
  CreateDocumentArtifactInput,
  CreateFaceIdentityInput,
  CreateFaceObservationInput,
  CreateProcessingRunInput,
  DerivedArtifactRepository,
  DocumentArtifactRecord,
  DocumentMediaMetadataRecord,
  FaceIdentityRecord,
  FaceObservationRecord,
  ProcessingRunRecord,
  UpdateProcessingRunStatusInput,
  UpsertDocumentMediaMetadataInput
} from "@mindory/core/artifacts";
import type { DocumentRecomputeStage, SupersedeDocumentProcessingRunsInput } from "@mindory/core/recompute";
import {
  documentArtifacts,
  documentMediaMetadata,
  faceIdentities,
  faceObservations,
  processingRuns
} from "../schema.js";
import { firstOrThrow, type MindoryDatabase } from "./types.js";

export class DbDerivedArtifactRepository implements DerivedArtifactRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async createProcessingRun(input: CreateProcessingRunInput): Promise<ProcessingRunRecord> {
    const values = {
      id: input.id,
      projectId: input.projectId,
      documentId: input.documentId,
      status: "running" as const,
      reason: input.reason,
      processorVersion: input.processorVersion,
      configFingerprint: input.configFingerprint,
      modelRuntimeFingerprint: input.modelRuntimeFingerprint ?? null,
      sourceDocumentStorageKey: input.sourceDocumentStorageKey,
      sourceDocumentChecksum: input.sourceDocumentChecksum ?? null,
      metadata: input.metadata ?? {},
      finishedAt: null,
      updatedAt: new Date()
    };
    const [row] = await this.db.insert(processingRuns).values(values).onConflictDoUpdate({
      target: processingRuns.id,
      set: values
    }).returning();

    return mapProcessingRun(firstOrThrow(row ? [row] : [], `Processing run ${input.id} was not created.`));
  }

  async updateProcessingRunStatus(input: UpdateProcessingRunStatusInput): Promise<ProcessingRunRecord> {
    const update: Partial<typeof processingRuns.$inferInsert> = {
      status: input.status,
      updatedAt: new Date()
    };
    if (input.metadata !== undefined) {
      update.metadata = input.metadata;
    }
    if (input.finishedAt !== undefined) {
      update.finishedAt = input.finishedAt;
    }

    const [row] = await this.db.update(processingRuns).set(update).where(and(
      eq(processingRuns.projectId, input.projectId),
      eq(processingRuns.id, input.runId)
    )).returning();

    return mapProcessingRun(firstOrThrow(row ? [row] : [], `Processing run ${input.runId} was not updated.`));
  }

  async listProcessingRuns(projectId: string, documentId: string): Promise<ProcessingRunRecord[]> {
    const rows = await this.db.select().from(processingRuns).where(and(
      eq(processingRuns.projectId, projectId),
      eq(processingRuns.documentId, documentId)
    )).orderBy(asc(processingRuns.createdAt));

    return rows.map(mapProcessingRun);
  }

  async supersedeDocumentProcessingRuns(input: SupersedeDocumentProcessingRunsInput): Promise<number> {
    const rows = await this.db.select().from(processingRuns).where(and(
      eq(processingRuns.projectId, input.projectId),
      eq(processingRuns.documentId, input.documentId)
    ));
    const stages = input.stages?.includes("all") ? undefined : input.stages;
    const finishedAt = input.finishedAt ?? new Date();
    const targets = rows.filter((row) =>
      row.id !== input.excludeRunId
      && row.status !== "superseded"
      && (!stages || stages.includes(readProcessingRunStage(row.metadata)))
    );

    for (const row of targets) {
      await this.db.update(processingRuns).set({
        status: "superseded",
        metadata: {
          ...row.metadata,
          superseded_by_run_id: input.supersededByRunId,
          superseded_at: finishedAt.toISOString(),
          superseded_reason: input.reason
        },
        finishedAt,
        updatedAt: new Date()
      }).where(eq(processingRuns.id, row.id));
    }

    return targets.length;
  }

  async createDocumentArtifact(input: CreateDocumentArtifactInput): Promise<DocumentArtifactRecord> {
    const [row] = await this.db.insert(documentArtifacts).values({
      id: input.id,
      projectId: input.projectId,
      documentId: input.documentId,
      processingRunId: input.processingRunId,
      parentArtifactId: input.parentArtifactId ?? null,
      artifactType: input.artifactType,
      artifactIndex: input.artifactIndex,
      storageKey: input.storageKey ?? null,
      content: input.content ?? null,
      contentHash: input.contentHash ?? null,
      sourceRefs: input.sourceRefs ?? [],
      source: input.source ?? { type: "unknown" },
      sourcePosition: input.sourcePosition ?? {},
      modelProvider: input.modelProvider ?? null,
      modelName: input.modelName ?? null,
      modelVersion: input.modelVersion ?? null,
      configFingerprint: input.configFingerprint ?? null,
      metadata: input.metadata ?? {}
    }).returning();

    return mapDocumentArtifact(firstOrThrow(row ? [row] : [], `Document artifact ${input.id} was not created.`));
  }

  async listDocumentArtifacts(projectId: string, documentId: string): Promise<DocumentArtifactRecord[]> {
    const rows = await this.db.select().from(documentArtifacts).where(and(
      eq(documentArtifacts.projectId, projectId),
      eq(documentArtifacts.documentId, documentId)
    )).orderBy(asc(documentArtifacts.artifactIndex), asc(documentArtifacts.createdAt));

    return rows.map(mapDocumentArtifact);
  }

  async upsertDocumentMediaMetadata(input: UpsertDocumentMediaMetadataInput): Promise<DocumentMediaMetadataRecord> {
    const values = {
      projectId: input.projectId,
      documentId: input.documentId,
      mediaType: input.mediaType,
      durationMs: input.durationMs ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      pageCount: input.pageCount ?? null,
      frameCount: input.frameCount ?? null,
      codec: input.codec ?? null,
      container: input.container ?? null,
      language: input.language ?? null,
      checksumSha256: input.checksumSha256 ?? null,
      metadata: input.metadata ?? {},
      updatedAt: new Date()
    };

    const [row] = await this.db.insert(documentMediaMetadata).values(values).onConflictDoUpdate({
      target: documentMediaMetadata.documentId,
      set: values
    }).returning();

    return mapDocumentMediaMetadata(firstOrThrow(row ? [row] : [], `Document media metadata ${input.documentId} was not upserted.`));
  }

  async createFaceIdentity(input: CreateFaceIdentityInput): Promise<FaceIdentityRecord> {
    const [row] = await this.db.insert(faceIdentities).values({
      id: input.id,
      projectId: input.projectId,
      label: input.label ?? null,
      status: input.status ?? "candidate",
      representativeArtifactId: input.representativeArtifactId ?? null,
      metadata: input.metadata ?? {}
    }).returning();

    return mapFaceIdentity(firstOrThrow(row ? [row] : [], `Face identity ${input.id} was not created.`));
  }

  async createFaceObservation(input: CreateFaceObservationInput): Promise<FaceObservationRecord> {
    const [row] = await this.db.insert(faceObservations).values({
      id: input.id,
      projectId: input.projectId,
      documentId: input.documentId,
      artifactId: input.artifactId,
      processingRunId: input.processingRunId,
      faceIdentityId: input.faceIdentityId ?? null,
      embeddingId: input.embeddingId ?? null,
      embedding: input.embedding ?? null,
      model: input.model ?? null,
      boundingBox: input.boundingBox,
      confidence: input.confidence ?? null,
      metadata: input.metadata ?? {}
    }).returning();

    return mapFaceObservation(firstOrThrow(row ? [row] : [], `Face observation ${input.id} was not created.`));
  }
}

function mapProcessingRun(row: typeof processingRuns.$inferSelect): ProcessingRunRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    status: row.status,
    reason: row.reason,
    processorVersion: row.processorVersion,
    configFingerprint: row.configFingerprint,
    modelRuntimeFingerprint: row.modelRuntimeFingerprint,
    sourceDocumentStorageKey: row.sourceDocumentStorageKey,
    sourceDocumentChecksum: row.sourceDocumentChecksum,
    metadata: row.metadata,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function readProcessingRunStage(metadata: Record<string, unknown>): DocumentRecomputeStage {
  return typeof metadata.stage === "string" && ["all", "route", "text", "pdf", "image", "audio", "video"].includes(metadata.stage)
    ? metadata.stage as DocumentRecomputeStage
    : "all";
}

function mapDocumentArtifact(row: typeof documentArtifacts.$inferSelect): DocumentArtifactRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    processingRunId: row.processingRunId,
    parentArtifactId: row.parentArtifactId,
    artifactType: row.artifactType,
    artifactIndex: row.artifactIndex,
    storageKey: row.storageKey,
    content: row.content,
    contentHash: row.contentHash,
    sourceRefs: row.sourceRefs,
    source: row.source,
    sourcePosition: row.sourcePosition,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    modelVersion: row.modelVersion,
    configFingerprint: row.configFingerprint,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapDocumentMediaMetadata(row: typeof documentMediaMetadata.$inferSelect): DocumentMediaMetadataRecord {
  return {
    documentId: row.documentId,
    projectId: row.projectId,
    mediaType: row.mediaType,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    pageCount: row.pageCount,
    frameCount: row.frameCount,
    codec: row.codec,
    container: row.container,
    language: row.language,
    checksumSha256: row.checksumSha256,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapFaceIdentity(row: typeof faceIdentities.$inferSelect): FaceIdentityRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    status: row.status,
    representativeArtifactId: row.representativeArtifactId,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapFaceObservation(row: typeof faceObservations.$inferSelect): FaceObservationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    artifactId: row.artifactId,
    processingRunId: row.processingRunId,
    faceIdentityId: row.faceIdentityId,
    embeddingId: row.embeddingId,
    embedding: row.embedding,
    model: row.model,
    boundingBox: row.boundingBox,
    confidence: row.confidence,
    metadata: row.metadata,
    createdAt: row.createdAt
  };
}
