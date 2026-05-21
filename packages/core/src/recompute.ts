import { createHash, randomUUID } from "node:crypto";
import type { ProcessingRunRecord } from "./artifacts.js";
import type { DocumentRecord, DocumentRepository } from "./documents.js";
import type { EnqueuedProcessingJob, ProcessingJobDispatcher } from "./queue.js";

export const DOCUMENT_RECOMPUTE_PROCESSOR_VERSION = "document-recompute-v1";

export type DocumentRecomputeStage = "all" | "route" | "text" | "pdf" | "image" | "audio" | "video";

export interface DocumentRecomputeRequestInput {
  projectId: string;
  documentId: string;
  stages?: string[];
  reason?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentRecomputeRequestResult {
  document: DocumentRecord;
  requestId: string;
  processingRunId: string;
  stages: DocumentRecomputeStage[];
  job: EnqueuedProcessingJob;
}

export interface DocumentRecomputeServiceOptions {
  documents: DocumentRepository;
  jobs: ProcessingJobDispatcher;
  requestIdFactory?: () => string;
}

export interface SupersedeDocumentProcessingRunsInput {
  projectId: string;
  documentId: string;
  stages?: DocumentRecomputeStage[];
  excludeRunId?: string;
  supersededByRunId: string;
  reason: string;
  finishedAt?: Date;
}

export interface DocumentProcessingRunRepository {
  listProcessingRuns(projectId: string, documentId: string): Promise<ProcessingRunRecord[]>;
  supersedeDocumentProcessingRuns(input: SupersedeDocumentProcessingRunsInput): Promise<number>;
}

const allowedStages = new Set<DocumentRecomputeStage>(["all", "route", "text", "pdf", "image", "audio", "video"]);

export class DocumentRecomputeService {
  private readonly documents: DocumentRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly requestIdFactory: () => string;

  constructor(options: DocumentRecomputeServiceOptions) {
    this.documents = options.documents;
    this.jobs = options.jobs;
    this.requestIdFactory = options.requestIdFactory ?? (() => `recompute_${randomUUID()}`);
  }

  async requestRecompute(input: DocumentRecomputeRequestInput): Promise<DocumentRecomputeRequestResult> {
    const document = await this.documents.getDocument(input.projectId, input.documentId);
    const stages = normalizeDocumentRecomputeStages(input.stages);
    const requestId = input.requestId ?? this.requestIdFactory();
    const processingRunId = buildProcessingRunId(input.projectId, input.documentId, requestId);
    const job = await this.jobs.createAndEnqueue({
      projectId: input.projectId,
      type: "document.recompute",
      targetType: "document",
      targetId: document.id,
      idempotencyKey: `document.recompute:${document.id}:${requestId}`,
      processorVersion: DOCUMENT_RECOMPUTE_PROCESSOR_VERSION,
      metadata: {
        ...(input.metadata ?? {}),
        recompute_request_id: requestId,
        processing_run_id: processingRunId,
        stages,
        reason: input.reason ?? "manual_recompute",
        source_document_storage_key: document.storageKey,
        raw_original_unchanged: true
      }
    });

    return {
      document,
      requestId,
      processingRunId,
      stages,
      job
    };
  }
}

export function normalizeDocumentRecomputeStages(stages: string[] | undefined): DocumentRecomputeStage[] {
  if (!stages || stages.length === 0) {
    return ["all"];
  }

  const normalized: DocumentRecomputeStage[] = [];
  for (const rawStage of stages) {
    if (!isDocumentRecomputeStage(rawStage)) {
      throw new DocumentRecomputeError("invalid_recompute_stage", `Unsupported recompute stage: ${rawStage}.`);
    }
    if (!normalized.includes(rawStage)) {
      normalized.push(rawStage);
    }
  }

  return normalized.includes("all") ? ["all"] : normalized;
}

export function isDocumentRecomputeStage(value: string): value is DocumentRecomputeStage {
  return allowedStages.has(value as DocumentRecomputeStage);
}

export function buildDocumentRecomputeFingerprint(input: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(input), "utf8").digest("hex");
}

function buildProcessingRunId(projectId: string, documentId: string, requestId: string): string {
  const hash = createHash("sha256").update(`${projectId}:${documentId}:${requestId}`, "utf8").digest("hex");
  return `run_${hash.slice(0, 32)}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortForStableJson(value));
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableJson);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortForStableJson(item)]));
  }
  return value;
}

export type DocumentRecomputeErrorCode = "invalid_recompute_stage";

export class DocumentRecomputeError extends Error {
  readonly code: DocumentRecomputeErrorCode;

  constructor(code: DocumentRecomputeErrorCode, message: string) {
    super(message);
    this.name = "DocumentRecomputeError";
    this.code = code;
  }
}
