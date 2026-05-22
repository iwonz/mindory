import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AntivirusScanner } from "./antivirus.js";
import type { ProcessingJobDispatcher, EnqueuedProcessingJob } from "./queue.js";
import type { ObjectBody, ObjectStorage, StoredObject } from "./storage.js";

export type SourceSnapshotType =
  | "api"
  | "cli"
  | "mcp"
  | "agent"
  | "telegram"
  | "browser_extension"
  | "n8n"
  | "import"
  | "unknown";

export interface SourceSnapshot {
  type: SourceSnapshotType;
  integration?: string;
  external_id?: string;
  external_url?: string;
  actor_peer_id?: string;
  agent_peer_id?: string;
  received_at?: string;
  metadata?: Record<string, unknown>;
}

export type DocumentStatus =
  | "uploaded"
  | "scan_pending"
  | "scan_clean"
  | "scan_infected"
  | "scan_failed"
  | "quarantined"
  | "extract_pending"
  | "extracted"
  | "chunk_pending"
  | "chunked"
  | "embed_pending"
  | "indexed"
  | "failed";

export interface DocumentRecord {
  id: string;
  projectId: string;
  title: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  status: DocumentStatus;
  source: SourceSnapshot;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDocumentInput {
  id: string;
  projectId: string;
  title?: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  status: DocumentStatus;
  source: SourceSnapshot;
  metadata?: Record<string, unknown>;
}

export interface UpdateDocumentStatusInput {
  projectId: string;
  documentId: string;
  status: DocumentStatus;
  metadata?: Record<string, unknown>;
}

export interface ListDocumentsInput {
  projectId: string;
  status?: DocumentStatus;
  limit: number;
}

export interface DocumentRepository {
  createDocument(input: CreateDocumentInput): Promise<DocumentRecord>;
  getDocument(projectId: string, documentId: string): Promise<DocumentRecord>;
  listDocuments(input: ListDocumentsInput): Promise<DocumentRecord[]>;
  updateDocumentStatus(input: UpdateDocumentStatusInput): Promise<DocumentRecord>;
}

export type AntivirusMode = "disabled" | "async_quarantine" | "sync_scan";

export interface DocumentAntivirusPolicy {
  enabled: boolean;
  provider: "clamav" | "disabled" | string;
  mode: AntivirusMode;
  onScanFailure: "block" | "allow_with_warning";
  onInfected: "quarantine" | "delete";
}

export interface UploadDocumentInput {
  projectId: string;
  originalFilename: string;
  mimeType: string;
  body: ObjectBody;
  title?: string;
  source?: SourceSnapshot;
  metadata?: Record<string, unknown>;
}

export interface UploadDocumentResult {
  document: DocumentRecord;
  storedObject: StoredObject;
  scanJob: EnqueuedProcessingJob | null;
  routeJob: EnqueuedProcessingJob | null;
}

export interface DocumentUploadServiceOptions {
  storage: ObjectStorage;
  documents: DocumentRepository;
  jobs: ProcessingJobDispatcher;
  antivirusPolicy: DocumentAntivirusPolicy;
  scanner?: AntivirusScanner;
  idFactory?: () => string;
  scannerVersion?: string;
  routeAfterUpload?: boolean;
  routeProcessorVersion?: string;
}

export class DocumentUploadService {
  readonly storage: ObjectStorage;
  readonly documents: DocumentRepository;
  readonly jobs: ProcessingJobDispatcher;
  readonly antivirusPolicy: DocumentAntivirusPolicy;
  private readonly scanner: AntivirusScanner | undefined;
  private readonly idFactory: () => string;
  private readonly scannerVersion: string;
  private readonly routeAfterUpload: boolean;
  private readonly routeProcessorVersion: string;

  constructor(options: DocumentUploadServiceOptions) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.jobs = options.jobs;
    this.antivirusPolicy = options.antivirusPolicy;
    this.scanner = options.scanner;
    this.idFactory = options.idFactory ?? (() => `doc_${randomUUID()}`);
    this.scannerVersion = options.scannerVersion ?? "clamav-v1";
    this.routeAfterUpload = options.routeAfterUpload ?? true;
    this.routeProcessorVersion = options.routeProcessorVersion ?? "document-route-v1";
  }

  async upload(input: UploadDocumentInput): Promise<UploadDocumentResult> {
    const documentId = this.idFactory();
    const storageKey = buildDocumentStorageKey(input.projectId, documentId, input.originalFilename);
    const storedObject = await this.storage.putObject({
      key: storageKey,
      body: input.body,
      contentType: input.mimeType,
      metadata: {
        project_id: input.projectId,
        document_id: documentId,
        original_filename: input.originalFilename
      }
    });
    const syncScan = await this.runSynchronousScan(storageKey, input.originalFilename);
    if (syncScan.deleteStoredObject) {
      await this.storage.deleteObject(storageKey);
    }

    const initialStatus = this.requiresAsyncScan() ? "scan_pending" : syncScan.status;
    const metadata = {
      ...(input.metadata ?? {}),
      ...syncScan.metadata
    };
    const createDocumentInput: CreateDocumentInput = {
      id: documentId,
      projectId: input.projectId,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: storedObject.sizeBytes,
      storageKey,
      status: initialStatus,
      source: input.source ?? { type: "api" }
    };
    if (input.title !== undefined) {
      createDocumentInput.title = input.title;
    }
    if (Object.keys(metadata).length > 0) {
      createDocumentInput.metadata = metadata;
    }

    const document = await this.documents.createDocument(createDocumentInput);

    const scanJob = this.requiresAsyncScan()
      ? await this.jobs.createAndEnqueue({
        projectId: input.projectId,
        type: "document.scan",
        targetType: "document",
        targetId: document.id,
        idempotencyKey: `document.scan:${document.id}:${this.scannerVersion}`,
        processorVersion: this.scannerVersion,
        metadata: {
          storage_key: storageKey,
          antivirus_provider: this.antivirusPolicy.provider
        }
      })
      : null;
    const routeJob = !this.requiresAsyncScan() && this.routeAfterUpload && this.canRouteAfterUpload(document.status)
      ? await this.enqueueRouteJob(document)
      : null;

    return {
      document,
      storedObject,
      scanJob,
      routeJob
    };
  }

  private requiresAsyncScan(): boolean {
    return this.antivirusPolicy.enabled && this.antivirusPolicy.mode === "async_quarantine";
  }

  private async runSynchronousScan(storageKey: string, filename: string): Promise<{
    status: DocumentStatus;
    metadata: Record<string, unknown>;
    deleteStoredObject: boolean;
  }> {
    if (!this.antivirusPolicy.enabled || this.antivirusPolicy.mode !== "sync_scan") {
      return {
        status: "scan_clean",
        metadata: {},
        deleteStoredObject: false
      };
    }
    if (this.scanner === undefined) {
      throw new DocumentUploadError("sync_scanner_missing", "Synchronous antivirus scanning requires a configured scanner.");
    }

    try {
      const object = await this.storage.getObject(storageKey);
      const result = await this.scanner.scan({
        body: object.body,
        filename
      });
      if (result.verdict === "clean") {
        return {
          status: "scan_clean",
          metadata: {
            antivirus: result
          },
          deleteStoredObject: false
        };
      }
      return {
        status: this.antivirusPolicy.onInfected === "quarantine" ? "quarantined" : "scan_infected",
        metadata: {
          antivirus: result
        },
        deleteStoredObject: this.antivirusPolicy.onInfected === "delete"
      };
    } catch (error) {
      return {
        status: this.antivirusPolicy.onScanFailure === "allow_with_warning" ? "scan_failed" : "quarantined",
        metadata: {
          antivirus_error: error instanceof Error ? error.message : String(error)
        },
        deleteStoredObject: false
      };
    }
  }

  private canRouteAfterUpload(status: DocumentStatus): boolean {
    return status === "scan_clean" || status === "scan_failed";
  }

  private async enqueueRouteJob(document: DocumentRecord): Promise<EnqueuedProcessingJob> {
    return this.jobs.createAndEnqueue({
      projectId: document.projectId,
      type: "document.route",
      targetType: "document",
      targetId: document.id,
      idempotencyKey: `document.route:${document.id}:${this.routeProcessorVersion}`,
      processorVersion: this.routeProcessorVersion,
      metadata: {
        storage_key: document.storageKey
      }
    });
  }
}

export type DocumentUploadErrorCode =
  | "invalid_document_key"
  | "sync_scanner_missing";

export class DocumentUploadError extends Error {
  readonly code: DocumentUploadErrorCode;

  constructor(code: DocumentUploadErrorCode, message: string) {
    super(message);
    this.name = "DocumentUploadError";
    this.code = code;
  }
}

export function buildDocumentStorageKey(projectId: string, documentId: string, originalFilename: string): string {
  const filename = sanitizeFilename(originalFilename);
  return `${sanitizeKeySegment(projectId)}/documents/${sanitizeKeySegment(documentId)}/${filename}`;
}

function sanitizeFilename(filename: string): string {
  const basename = path.basename(filename).replaceAll(/[^A-Za-z0-9._-]/g, "_");
  return basename || "document";
}

function sanitizeKeySegment(segment: string): string {
  const sanitized = segment.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new DocumentUploadError("invalid_document_key", "Document storage key segment is invalid.");
  }
  return sanitized;
}
