import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type {
  ArtifactSearchHit,
  CreateDocumentArtifactInput,
  CreateDocumentArtifactTextSpanInput,
  CreateDocumentMetadataIndexInput,
  CreateFaceIdentityInput,
  CreateFaceObservationInput,
  CreateProcessingRunInput,
  DerivedArtifactRepository,
  DocumentArtifactRecord,
  DocumentArtifactTextSpanRecord,
  DocumentMetadataIndexRecord,
  DocumentMediaMetadataRecord,
  FaceIdentityRecord,
  FaceObservationRecord,
  ListFaceIdentitiesInput,
  ListFaceObservationsInput,
  ProcessingRunRecord,
  ReassignFaceObservationsInput,
  ReplaceDocumentMetadataIndexInput,
  ReplaceDocumentArtifactTextSpansInput,
  SearchArtifactsInput,
  UpdateFaceIdentityInput,
  UpdateProcessingRunStatusInput,
  UpsertDocumentMediaMetadataInput
} from "@mindory/core/artifacts";
import type { DocumentRecomputeStage, SupersedeDocumentProcessingRunsInput } from "@mindory/core/recompute";
import {
  documentArtifacts,
  documentArtifactTextSpans,
  documentMediaMetadata,
  documentMetadataIndex,
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
    const values = {
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
      metadata: input.metadata ?? {},
      updatedAt: new Date()
    };
    const [row] = await this.db.insert(documentArtifacts).values(values).onConflictDoUpdate({
      target: documentArtifacts.id,
      set: values
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

  async replaceDocumentArtifactTextSpans(input: ReplaceDocumentArtifactTextSpansInput): Promise<DocumentArtifactTextSpanRecord[]> {
    await this.db.delete(documentArtifactTextSpans).where(and(
      eq(documentArtifactTextSpans.projectId, input.projectId),
      eq(documentArtifactTextSpans.documentId, input.documentId),
      eq(documentArtifactTextSpans.artifactId, input.artifactId)
    ));

    if (input.spans.length === 0) {
      return [];
    }

    const rows = await this.db.insert(documentArtifactTextSpans).values(input.spans.map(mapTextSpanInsert)).returning();
    return rows.map(mapDocumentArtifactTextSpan);
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

  async replaceDocumentMetadataIndex(input: ReplaceDocumentMetadataIndexInput): Promise<DocumentMetadataIndexRecord[]> {
    await this.db.delete(documentMetadataIndex).where(and(
      eq(documentMetadataIndex.projectId, input.projectId),
      eq(documentMetadataIndex.documentId, input.documentId),
      eq(documentMetadataIndex.source, input.source)
    ));

    if (input.entries.length === 0) {
      return [];
    }

    const rows = await this.db.insert(documentMetadataIndex).values(input.entries.map((entry) =>
      mapMetadataIndexInsert({
        ...entry,
        source: entry.source ?? input.source
      })
    )).returning();

    return rows.map(mapDocumentMetadataIndex);
  }

  async searchArtifacts(input: SearchArtifactsInput): Promise<ArtifactSearchHit[]> {
    if (input.projectIds.length === 0 || !input.query || input.query.trim() === "") {
      return [];
    }

    const projectFilters = sql.join(input.projectIds.map((projectId) => sql`${projectId}`), sql`, `);
    const artifactTypeFilter = input.artifactTypes && input.artifactTypes.length > 0
      ? sql`and artifacts.artifact_type in (${sql.join(input.artifactTypes.map((type) => sql`${type}`), sql`, `)})`
      : sql``;
    const spanTypeFilter = input.spanTypes && input.spanTypes.length > 0
      ? sql`and spans.span_type in (${sql.join(input.spanTypes.map((type) => sql`${type}`), sql`, `)})`
      : sql``;
    const result = await this.db.execute(sql`
      select
        spans.project_id,
        spans.document_id,
        spans.id as span_id,
        spans.span_type,
        spans.content,
        spans.metadata as span_metadata,
        spans.page_number,
        spans.frame_index,
        spans.timestamp_ms,
        spans.bounding_box,
        spans.confidence,
        artifacts.id as artifact_id,
        artifacts.artifact_type,
        artifacts.source_refs,
        artifacts.source_position,
        artifacts.metadata as artifact_metadata,
        ts_rank_cd(to_tsvector('simple', spans.content), plainto_tsquery('simple', ${input.query})) as score
      from document_artifact_text_spans spans
      inner join document_artifacts artifacts
        on artifacts.id = spans.artifact_id
        and artifacts.project_id = spans.project_id
        and artifacts.document_id = spans.document_id
      inner join processing_runs runs
        on runs.id = artifacts.processing_run_id
        and runs.project_id = artifacts.project_id
        and runs.document_id = artifacts.document_id
      where spans.project_id in (${projectFilters})
        and runs.status <> 'superseded'
        ${artifactTypeFilter}
        ${spanTypeFilter}
        and to_tsvector('simple', spans.content) @@ plainto_tsquery('simple', ${input.query})
        and ${artifactMetadataFiltersSql(sql.raw("spans.project_id"), sql.raw("spans.document_id"), input.metadataFilters)}
      order by score desc, spans.created_at desc
      limit ${input.limit}
    `);

    return readRows(result).map((row) => {
      const spanMetadata = readMetadata(row.span_metadata);
      const artifactMetadata = readMetadata(row.artifact_metadata);
      const sourceRefs = readSourceRefs(spanMetadata.source_refs, readSourceRefs(row.source_refs, [
        { type: "artifact", id: String(row.artifact_id) }
      ]));
      return {
        projectId: String(row.project_id),
        documentId: String(row.document_id),
        artifactId: String(row.artifact_id),
        artifactType: String(row.artifact_type) as ArtifactSearchHit["artifactType"],
        spanId: String(row.span_id),
        spanType: String(row.span_type),
        content: String(row.content),
        score: Number(row.score),
        sourceRefs,
        sourcePosition: readSearchSourcePosition(row),
        metadata: {
          ...artifactMetadata,
          ...spanMetadata,
          page_number: row.page_number === null ? null : Number(row.page_number),
          frame_index: row.frame_index === null ? null : Number(row.frame_index),
          timestamp_ms: row.timestamp_ms === null ? null : Number(row.timestamp_ms),
          bounding_box: readNullableMetadata(row.bounding_box),
          confidence: row.confidence === null ? null : Number(row.confidence),
          search_backend: "artifact_text_spans_full_text"
        }
      };
    });
  }

  async createFaceIdentity(input: CreateFaceIdentityInput): Promise<FaceIdentityRecord> {
    const [row] = await this.db.insert(faceIdentities).values({
      id: input.id,
      projectId: input.projectId,
      label: input.label ?? null,
      status: input.status ?? "candidate",
      representativeArtifactId: input.representativeArtifactId ?? null,
      metadata: input.metadata ?? {}
    }).onConflictDoNothing().returning();

    return row ? mapFaceIdentity(row) : this.getFaceIdentity(input.projectId, input.id);
  }

  async getFaceIdentity(projectId: string, identityId: string): Promise<FaceIdentityRecord> {
    const rows = await this.db.select().from(faceIdentities).where(and(
      eq(faceIdentities.projectId, projectId),
      eq(faceIdentities.id, identityId)
    ));

    return mapFaceIdentity(firstOrThrow(rows, `Face identity ${identityId} was not found.`));
  }

  async listFaceIdentities(input: ListFaceIdentitiesInput): Promise<FaceIdentityRecord[]> {
    const conditions = [eq(faceIdentities.projectId, input.projectId)];
    if (input.statuses && input.statuses.length > 0) {
      conditions.push(inArray(faceIdentities.status, input.statuses));
    }
    const rows = await this.db.select().from(faceIdentities)
      .where(and(...conditions))
      .orderBy(asc(faceIdentities.createdAt))
      .limit(input.limit ?? 100);

    return rows.map(mapFaceIdentity);
  }

  async updateFaceIdentity(input: UpdateFaceIdentityInput): Promise<FaceIdentityRecord> {
    const update: Partial<typeof faceIdentities.$inferInsert> = {
      updatedAt: new Date()
    };
    if (input.label !== undefined) {
      update.label = input.label;
    }
    if (input.status !== undefined) {
      update.status = input.status;
    }
    if (input.representativeArtifactId !== undefined) {
      update.representativeArtifactId = input.representativeArtifactId;
    }
    if (input.metadata !== undefined) {
      update.metadata = input.metadata;
    }

    const [row] = await this.db.update(faceIdentities).set(update).where(and(
      eq(faceIdentities.projectId, input.projectId),
      eq(faceIdentities.id, input.identityId)
    )).returning();

    return mapFaceIdentity(firstOrThrow(row ? [row] : [], `Face identity ${input.identityId} was not updated.`));
  }

  async createFaceObservation(input: CreateFaceObservationInput): Promise<FaceObservationRecord> {
    const values = {
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
    };
    const [row] = await this.db.insert(faceObservations).values(values).onConflictDoUpdate({
      target: faceObservations.id,
      set: values
    }).returning();

    return mapFaceObservation(firstOrThrow(row ? [row] : [], `Face observation ${input.id} was not created.`));
  }

  async listFaceObservations(input: ListFaceObservationsInput): Promise<FaceObservationRecord[]> {
    const conditions = [eq(faceObservations.projectId, input.projectId)];
    if (input.identityId !== undefined) {
      conditions.push(input.identityId === null
        ? isNull(faceObservations.faceIdentityId)
        : eq(faceObservations.faceIdentityId, input.identityId));
    }
    if (input.documentId !== undefined) {
      conditions.push(eq(faceObservations.documentId, input.documentId));
    }
    const rows = await this.db.select().from(faceObservations)
      .where(and(...conditions))
      .orderBy(asc(faceObservations.createdAt))
      .limit(input.limit ?? 100);

    return rows.map(mapFaceObservation);
  }

  async reassignFaceObservations(input: ReassignFaceObservationsInput): Promise<number> {
    const rows = await this.db.update(faceObservations).set({
      faceIdentityId: input.toIdentityId
    }).where(and(
      eq(faceObservations.projectId, input.projectId),
      eq(faceObservations.faceIdentityId, input.fromIdentityId)
    )).returning();

    return rows.length;
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

function mapTextSpanInsert(input: CreateDocumentArtifactTextSpanInput): typeof documentArtifactTextSpans.$inferInsert {
  return {
    id: input.id,
    projectId: input.projectId,
    documentId: input.documentId,
    artifactId: input.artifactId,
    spanType: input.spanType,
    content: input.content,
    startOffset: input.startOffset ?? null,
    endOffset: input.endOffset ?? null,
    pageNumber: input.pageNumber ?? null,
    frameIndex: input.frameIndex ?? null,
    timestampMs: input.timestampMs ?? null,
    boundingBox: input.boundingBox ?? null,
    confidence: input.confidence ?? null,
    metadata: input.metadata ?? {}
  };
}

function mapDocumentArtifactTextSpan(row: typeof documentArtifactTextSpans.$inferSelect): DocumentArtifactTextSpanRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    artifactId: row.artifactId,
    spanType: row.spanType,
    content: row.content,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    pageNumber: row.pageNumber,
    frameIndex: row.frameIndex,
    timestampMs: row.timestampMs,
    boundingBox: row.boundingBox,
    confidence: row.confidence,
    metadata: row.metadata,
    createdAt: row.createdAt
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

function mapMetadataIndexInsert(input: CreateDocumentMetadataIndexInput): typeof documentMetadataIndex.$inferInsert {
  return {
    id: input.id,
    projectId: input.projectId,
    documentId: input.documentId,
    processingRunId: input.processingRunId ?? null,
    artifactId: input.artifactId ?? null,
    key: input.key,
    valueText: input.valueText ?? null,
    valueNumber: input.valueNumber ?? null,
    valueBoolean: input.valueBoolean ?? null,
    valueTimestamp: input.valueTimestamp ?? null,
    unit: input.unit ?? null,
    source: input.source ?? "derived",
    metadata: input.metadata ?? {}
  };
}

function mapDocumentMetadataIndex(row: typeof documentMetadataIndex.$inferSelect): DocumentMetadataIndexRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    processingRunId: row.processingRunId,
    artifactId: row.artifactId,
    key: row.key,
    valueText: row.valueText,
    valueNumber: row.valueNumber,
    valueBoolean: row.valueBoolean,
    valueTimestamp: row.valueTimestamp,
    unit: row.unit,
    source: row.source,
    metadata: row.metadata,
    createdAt: row.createdAt
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

type Row = Record<string, unknown>;

function readRows(result: unknown): Row[] {
  if (typeof result === "object" && result !== null && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
}

function readMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNullableMetadata(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readSourceRefs(value: unknown, fallback: ArtifactSearchHit["sourceRefs"]): ArtifactSearchHit["sourceRefs"] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const refs = value.filter((item): item is { type: ArtifactSearchHit["sourceRefs"][number]["type"]; id: string } =>
    typeof item === "object"
    && item !== null
    && typeof (item as { type?: unknown }).type === "string"
    && typeof (item as { id?: unknown }).id === "string"
  );
  return refs.length > 0 ? refs : fallback;
}

function readSearchSourcePosition(row: Row): Record<string, unknown> {
  const sourcePosition = readMetadata(row.source_position);
  if (row.page_number !== null && row.page_number !== undefined) {
    sourcePosition.page_number = Number(row.page_number);
  }
  if (row.frame_index !== null && row.frame_index !== undefined) {
    sourcePosition.frame_index = Number(row.frame_index);
  }
  if (row.timestamp_ms !== null && row.timestamp_ms !== undefined) {
    sourcePosition.timestamp_ms = Number(row.timestamp_ms);
  }
  const boundingBox = readNullableMetadata(row.bounding_box);
  if (boundingBox) {
    sourcePosition.bounding_box = boundingBox;
  }
  if (row.confidence !== null && row.confidence !== undefined) {
    sourcePosition.confidence = Number(row.confidence);
  }
  return sourcePosition;
}

function artifactMetadataFiltersSql(projectIdExpression: SQL, documentIdExpression: SQL, filters: SearchArtifactsInput["metadataFilters"]): SQL {
  if (!filters || filters.length === 0) {
    return sql`true`;
  }

  return sql.join(filters.map((filter) => sql`
    exists (
      select 1
      from document_metadata_index metadata_filter
      where metadata_filter.project_id = ${projectIdExpression}
        and metadata_filter.document_id = ${documentIdExpression}
        and metadata_filter.key = ${filter.key}
        ${filter.unit === undefined ? sql`` : sql`and metadata_filter.unit = ${filter.unit}`}
        and ${artifactMetadataFilterValueSql(filter)}
    )
  `), sql` and `);
}

function artifactMetadataFilterValueSql(filter: NonNullable<SearchArtifactsInput["metadataFilters"]>[number]): SQL {
  const operator = filter.operator ?? "eq";

  if (operator === "between") {
    return typeof filter.minNumber === "number" && typeof filter.maxNumber === "number"
      ? sql`metadata_filter.value_number between ${filter.minNumber} and ${filter.maxNumber}`
      : sql`false`;
  }
  if (operator === "lt" || operator === "lte" || operator === "gt" || operator === "gte") {
    if (typeof filter.valueNumber !== "number") {
      return sql`false`;
    }
    switch (operator) {
      case "lt":
        return sql`metadata_filter.value_number < ${filter.valueNumber}`;
      case "lte":
        return sql`metadata_filter.value_number <= ${filter.valueNumber}`;
      case "gt":
        return sql`metadata_filter.value_number > ${filter.valueNumber}`;
      case "gte":
        return sql`metadata_filter.value_number >= ${filter.valueNumber}`;
    }
  }

  if (typeof filter.valueNumber === "number") {
    return sql`metadata_filter.value_number = ${filter.valueNumber}`;
  }
  if (typeof filter.valueText === "string") {
    return sql`metadata_filter.value_text = ${filter.valueText}`;
  }
  if (typeof filter.valueBoolean === "boolean") {
    return sql`metadata_filter.value_boolean = ${filter.valueBoolean}`;
  }
  if (typeof filter.valueTimestamp === "string") {
    return sql`metadata_filter.value_timestamp = ${filter.valueTimestamp}`;
  }
  return sql`false`;
}
