import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core/columns/vector_extension/vector";

export type SourceRef = {
  type: "session" | "message" | "document" | "chunk" | "artifact" | "processing_run" | "face_identity" | "face_observation" | "memory";
  id: string;
};

export type SourceSnapshot = {
  type: "api" | "cli" | "mcp" | "agent" | "telegram" | "browser_extension" | "n8n" | "import" | "unknown";
  integration?: string;
  external_id?: string;
  external_url?: string;
  actor_peer_id?: string;
  agent_peer_id?: string;
  received_at?: string;
  metadata?: Record<string, unknown>;
};

export const accessTokenStatusEnum = pgEnum("access_token_status", [
  "active",
  "revoked",
  "expired"
]);

export const peerTypeEnum = pgEnum("peer_type", [
  "human",
  "agent",
  "service",
  "automation",
  "group"
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "idle",
  "archived"
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
  "tool",
  "event"
]);

export const documentStatusEnum = pgEnum("document_status", [
  "uploaded",
  "scan_pending",
  "scan_clean",
  "scan_infected",
  "scan_failed",
  "quarantined",
  "extract_pending",
  "extracted",
  "chunk_pending",
  "chunked",
  "embed_pending",
  "indexed",
  "failed"
]);

export const memoryClaimTypeEnum = pgEnum("memory_claim_type", [
  "semantic",
  "episodic",
  "preference",
  "decision",
  "task",
  "artifact_reference",
  "derived"
]);

export const memoryClaimStatusEnum = pgEnum("memory_claim_status", [
  "candidate",
  "active",
  "rejected",
  "archived"
]);

export const processingJobTypeEnum = pgEnum("processing_job_type", [
  "document.scan",
  "document.extract",
  "document.chunk",
  "document.embed",
  "document.index",
  "memory.derive",
  "session.summarize"
]);

export const processingJobStatusEnum = pgEnum("processing_job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "dead"
]);

export const processingRunStatusEnum = pgEnum("processing_run_status", [
  "running",
  "succeeded",
  "failed",
  "superseded"
]);

export const documentArtifactTypeEnum = pgEnum("document_artifact_type", [
  "raw_metadata",
  "text",
  "ocr_text",
  "transcript",
  "image_caption",
  "image_analysis",
  "image_embedding",
  "pdf_page",
  "video_keyframe",
  "face_observation",
  "metadata"
]);

export const faceIdentityStatusEnum = pgEnum("face_identity_status", [
  "candidate",
  "confirmed",
  "archived"
]);

const metadataDefault = sql`'{}'::jsonb`;
const sourceSnapshotDefault = sql`'{"type":"unknown"}'::jsonb`;
const sourceRefsDefault = sql`'[]'::jsonb`;

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("projects_name_idx").on(table.name)
  ]
);

export const accessTokens = pgTable(
  "access_tokens",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: accessTokenStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("access_tokens_token_hash_idx").on(table.tokenHash),
    index("access_tokens_project_id_idx").on(table.projectId),
    index("access_tokens_status_idx").on(table.status)
  ]
);

export const accessTokenProjectScopes = pgTable(
  "access_token_project_scopes",
  {
    tokenId: text("token_id").notNull().references(() => accessTokens.id, { onDelete: "cascade", onUpdate: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    permissions: text("permissions").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.tokenId, table.projectId], name: "access_token_project_scopes_pkey" }),
    index("access_token_project_scopes_project_id_idx").on(table.projectId)
  ]
);

export const peers = pgTable(
  "peers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    type: peerTypeEnum("type").notNull(),
    name: text("name").notNull(),
    externalId: text("external_id"),
    source: jsonb("source").$type<SourceSnapshot>().notNull().default(sourceSnapshotDefault),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("peers_project_id_idx").on(table.projectId),
    index("peers_project_type_idx").on(table.projectId, table.type),
    uniqueIndex("peers_project_external_id_idx").on(table.projectId, table.externalId)
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    title: text("title"),
    status: sessionStatusEnum("status").notNull().default("active"),
    source: jsonb("source").$type<SourceSnapshot>().notNull().default(sourceSnapshotDefault),
    summary: text("summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("sessions_project_id_idx").on(table.projectId),
    index("sessions_project_status_idx").on(table.projectId, table.status),
    index("sessions_project_updated_at_idx").on(table.projectId, table.updatedAt)
  ]
);

export const sessionPeers = pgTable(
  "session_peers",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade", onUpdate: "cascade" }),
    peerId: text("peer_id").notNull().references(() => peers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.peerId], name: "session_peers_pkey" }),
    index("session_peers_project_id_idx").on(table.projectId),
    index("session_peers_peer_id_idx").on(table.peerId)
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade", onUpdate: "cascade" }),
    authorPeerId: text("author_peer_id").notNull().references(() => peers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    source: jsonb("source").$type<SourceSnapshot>().notNull().default(sourceSnapshotDefault),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("messages_project_id_idx").on(table.projectId),
    index("messages_session_created_at_idx").on(table.sessionId, table.createdAt),
    index("messages_author_peer_id_idx").on(table.authorPeerId)
  ]
);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    title: text("title"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    status: documentStatusEnum("status").notNull().default("uploaded"),
    source: jsonb("source").$type<SourceSnapshot>().notNull().default(sourceSnapshotDefault),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("documents_project_id_idx").on(table.projectId),
    index("documents_project_status_idx").on(table.projectId, table.status),
    uniqueIndex("documents_storage_key_idx").on(table.storageKey),
    check("documents_size_bytes_nonnegative", sql`${table.sizeBytes} >= 0`)
  ]
);

export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    source: jsonb("source").$type<SourceSnapshot>().notNull().default(sourceSnapshotDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("attachments_message_document_idx").on(table.messageId, table.documentId),
    index("attachments_project_id_idx").on(table.projectId),
    index("attachments_document_id_idx").on(table.documentId)
  ]
);

export const chunks = pgTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    embeddingId: text("embedding_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("chunks_document_chunk_index_idx").on(table.documentId, table.chunkIndex),
    index("chunks_project_id_idx").on(table.projectId),
    index("chunks_document_id_idx").on(table.documentId),
    check("chunks_chunk_index_nonnegative", sql`${table.chunkIndex} >= 0`),
    check("chunks_token_count_nonnegative", sql`${table.tokenCount} is null or ${table.tokenCount} >= 0`)
  ]
);

export const chunkVectorEmbeddings = pgTable(
  "chunk_vector_embeddings",
  {
    embeddingId: text("embedding_id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    chunkId: text("chunk_id").notNull().references(() => chunks.id, { onDelete: "cascade", onUpdate: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("chunk_vector_embeddings_chunk_id_idx").on(table.chunkId),
    index("chunk_vector_embeddings_project_id_idx").on(table.projectId),
    index("chunk_vector_embeddings_document_id_idx").on(table.documentId),
    check("chunk_vector_embeddings_dimensions_positive", sql`${table.dimensions} > 0`)
  ]
);

export const memoryClaims = pgTable(
  "memory_claims",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    type: memoryClaimTypeEnum("type").notNull(),
    text: text("text").notNull(),
    status: memoryClaimStatusEnum("status").notNull().default("candidate"),
    importance: real("importance").notNull().default(0),
    confidence: real("confidence").notNull().default(0),
    sourceRefs: jsonb("source_refs").$type<SourceRef[]>().notNull().default(sourceRefsDefault),
    createdSource: jsonb("created_source").$type<SourceSnapshot>().notNull().default(sourceSnapshotDefault),
    createdByPeerId: text("created_by_peer_id").references(() => peers.id, { onDelete: "set null", onUpdate: "cascade" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("memory_claims_project_status_idx").on(table.projectId, table.status),
    index("memory_claims_created_by_peer_id_idx").on(table.createdByPeerId),
    index("memory_claims_source_refs_idx").using("gin", table.sourceRefs),
    check("memory_claims_importance_range", sql`${table.importance} >= 0 and ${table.importance} <= 1`),
    check("memory_claims_confidence_range", sql`${table.confidence} >= 0 and ${table.confidence} <= 1`)
  ]
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    type: processingJobTypeEnum("type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    status: processingJobStatusEnum("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    processorVersion: text("processor_version").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("processing_jobs_idempotency_key_idx").on(table.idempotencyKey),
    index("processing_jobs_project_status_idx").on(table.projectId, table.status),
    index("processing_jobs_type_status_idx").on(table.type, table.status),
    index("processing_jobs_target_idx").on(table.targetType, table.targetId),
    check("processing_jobs_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check("processing_jobs_max_attempts_positive", sql`${table.maxAttempts} > 0`)
  ]
);

export const processingRuns = pgTable(
  "processing_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    status: processingRunStatusEnum("status").notNull().default("running"),
    reason: text("reason").notNull(),
    processorVersion: text("processor_version").notNull(),
    configFingerprint: text("config_fingerprint").notNull(),
    modelRuntimeFingerprint: text("model_runtime_fingerprint"),
    sourceDocumentStorageKey: text("source_document_storage_key").notNull(),
    sourceDocumentChecksum: text("source_document_checksum"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("processing_runs_project_document_idx").on(table.projectId, table.documentId),
    index("processing_runs_project_status_idx").on(table.projectId, table.status),
    index("processing_runs_document_status_idx").on(table.documentId, table.status)
  ]
);

export const documentArtifacts = pgTable(
  "document_artifacts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    processingRunId: text("processing_run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade", onUpdate: "cascade" }),
    parentArtifactId: text("parent_artifact_id"),
    artifactType: documentArtifactTypeEnum("artifact_type").notNull(),
    artifactIndex: integer("artifact_index").notNull().default(0),
    storageKey: text("storage_key"),
    content: text("content"),
    contentHash: text("content_hash"),
    sourceRefs: jsonb("source_refs").$type<SourceRef[]>().notNull().default(sourceRefsDefault),
    source: jsonb("source").$type<SourceSnapshot>().notNull().default(sourceSnapshotDefault),
    sourcePosition: jsonb("source_position").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    modelVersion: text("model_version"),
    configFingerprint: text("config_fingerprint"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("document_artifacts_run_type_index_idx").on(table.processingRunId, table.artifactType, table.parentArtifactId, table.artifactIndex),
    index("document_artifacts_project_document_idx").on(table.projectId, table.documentId),
    index("document_artifacts_document_type_idx").on(table.documentId, table.artifactType),
    index("document_artifacts_processing_run_idx").on(table.processingRunId),
    index("document_artifacts_source_refs_idx").using("gin", table.sourceRefs),
    check("document_artifacts_index_nonnegative", sql`${table.artifactIndex} >= 0`),
    check("document_artifacts_has_payload", sql`${table.storageKey} is not null or ${table.content} is not null or jsonb_array_length(${table.sourceRefs}) > 0 or ${table.metadata} <> '{}'::jsonb`)
  ]
);

export const documentArtifactVectors = pgTable(
  "document_artifact_vectors",
  {
    embeddingId: text("embedding_id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    artifactId: text("artifact_id").notNull().references(() => documentArtifacts.id, { onDelete: "cascade", onUpdate: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("document_artifact_vectors_artifact_id_idx").on(table.artifactId),
    index("document_artifact_vectors_project_id_idx").on(table.projectId),
    index("document_artifact_vectors_document_id_idx").on(table.documentId),
    check("document_artifact_vectors_dimensions_positive", sql`${table.dimensions} > 0`)
  ]
);

export const documentArtifactTextSpans = pgTable(
  "document_artifact_text_spans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    artifactId: text("artifact_id").notNull().references(() => documentArtifacts.id, { onDelete: "cascade", onUpdate: "cascade" }),
    spanType: text("span_type").notNull(),
    content: text("content").notNull(),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    pageNumber: integer("page_number"),
    frameIndex: integer("frame_index"),
    timestampMs: integer("timestamp_ms"),
    boundingBox: jsonb("bounding_box").$type<Record<string, unknown>>(),
    confidence: real("confidence"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("document_artifact_text_spans_artifact_idx").on(table.artifactId),
    index("document_artifact_text_spans_document_idx").on(table.documentId),
    index("document_artifact_text_spans_project_type_idx").on(table.projectId, table.spanType),
    check("document_artifact_text_spans_offsets_valid", sql`${table.startOffset} is null or ${table.endOffset} is null or ${table.endOffset} >= ${table.startOffset}`),
    check("document_artifact_text_spans_confidence_range", sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`)
  ]
);

export const documentMediaMetadata = pgTable(
  "document_media_metadata",
  {
    documentId: text("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    mediaType: text("media_type").notNull(),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    pageCount: integer("page_count"),
    frameCount: integer("frame_count"),
    codec: text("codec"),
    container: text("container"),
    language: text("language"),
    checksumSha256: text("checksum_sha256"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("document_media_metadata_project_type_idx").on(table.projectId, table.mediaType),
    index("document_media_metadata_duration_idx").on(table.projectId, table.durationMs),
    check("document_media_metadata_duration_nonnegative", sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
    check("document_media_metadata_dimensions_positive", sql`(${table.width} is null or ${table.width} > 0) and (${table.height} is null or ${table.height} > 0)`),
    check("document_media_metadata_counts_nonnegative", sql`(${table.pageCount} is null or ${table.pageCount} >= 0) and (${table.frameCount} is null or ${table.frameCount} >= 0)`)
  ]
);

export const documentMetadataIndex = pgTable(
  "document_metadata_index",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    processingRunId: text("processing_run_id").references(() => processingRuns.id, { onDelete: "cascade", onUpdate: "cascade" }),
    artifactId: text("artifact_id").references(() => documentArtifacts.id, { onDelete: "cascade", onUpdate: "cascade" }),
    key: text("key").notNull(),
    valueText: text("value_text"),
    valueNumber: real("value_number"),
    valueBoolean: boolean("value_boolean"),
    valueTimestamp: timestamp("value_timestamp", { withTimezone: true }),
    unit: text("unit"),
    source: text("source").notNull().default("derived"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("document_metadata_index_project_key_idx").on(table.projectId, table.key),
    index("document_metadata_index_document_key_idx").on(table.documentId, table.key),
    index("document_metadata_index_key_number_idx").on(table.projectId, table.key, table.valueNumber),
    index("document_metadata_index_key_text_idx").on(table.projectId, table.key, table.valueText),
    check("document_metadata_index_has_value", sql`${table.valueText} is not null or ${table.valueNumber} is not null or ${table.valueBoolean} is not null or ${table.valueTimestamp} is not null`)
  ]
);

export const faceIdentities = pgTable(
  "face_identities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    label: text("label"),
    status: faceIdentityStatusEnum("status").notNull().default("candidate"),
    representativeArtifactId: text("representative_artifact_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("face_identities_project_status_idx").on(table.projectId, table.status),
    uniqueIndex("face_identities_project_label_idx").on(table.projectId, table.label)
  ]
);

export const faceObservations = pgTable(
  "face_observations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade", onUpdate: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    artifactId: text("artifact_id").notNull().references(() => documentArtifacts.id, { onDelete: "cascade", onUpdate: "cascade" }),
    processingRunId: text("processing_run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade", onUpdate: "cascade" }),
    faceIdentityId: text("face_identity_id").references(() => faceIdentities.id, { onDelete: "set null", onUpdate: "cascade" }),
    embeddingId: text("embedding_id"),
    embedding: vector("embedding", { dimensions: 512 }),
    model: text("model"),
    boundingBox: jsonb("bounding_box").$type<Record<string, unknown>>().notNull(),
    confidence: real("confidence"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(metadataDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("face_observations_project_document_idx").on(table.projectId, table.documentId),
    index("face_observations_identity_idx").on(table.faceIdentityId),
    index("face_observations_artifact_idx").on(table.artifactId),
    uniqueIndex("face_observations_embedding_id_idx").on(table.embeddingId),
    check("face_observations_confidence_range", sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`)
  ]
);
