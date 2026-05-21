import fastifyMultipart, { type MultipartFile } from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { DerivedArtifactRepository, DocumentMetadataFilter, ProcessingRunRecord } from "@mindory/core/artifacts";
import { DocumentUploadService, type DocumentRecord, type DocumentRepository, type DocumentStatus, type ListDocumentsInput, type UploadDocumentInput, type UploadDocumentResult } from "@mindory/core/documents";
import type { DocumentChunkSearchRepository } from "@mindory/core/memory";
import { DocumentRecomputeError, DocumentRecomputeService } from "@mindory/core/recompute";
import { requireProjectPermission, requireProjectPermissionForEach } from "../auth.js";
import { ApiError, notImplemented } from "../errors.js";

export interface DocumentRouteDependencies {
  uploadService?: DocumentUploadService;
  documentRepository?: DocumentRepository;
  chunkSearchRepository?: DocumentChunkSearchRepository;
  artifactRepository?: DerivedArtifactRepository;
  recomputeService?: DocumentRecomputeService;
}

interface MultipartFieldValue {
  value?: unknown;
}

interface RecomputeDocumentBody {
  projectId: string;
  stages?: string[];
  reason?: string;
  requestId?: string;
}

interface SearchDocumentsBody {
  projectIds: string[];
  query: string;
  limit: number;
  metadataFilters?: DocumentMetadataFilter[];
}

export async function registerDocumentRoutes(app: FastifyInstance, dependencies: DocumentRouteDependencies = {}): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: {
      files: 1
    }
  });

  app.post("/v1/documents", async (request, reply) => {
    if (!dependencies.uploadService) {
      throw notImplemented("Document upload requires storage, repository and queue runtime dependencies from a later task.");
    }

    const file = await request.file();
    if (!file) {
      throw new ApiError(400, "document_file_required", "Multipart field file is required.");
    }

    const projectId = readMultipartField(file, "projectId");
    if (!projectId) {
      throw new ApiError(400, "project_id_required", "Multipart field projectId is required.");
    }
    requireProjectPermission(request, projectId, "document:write");

    const uploadInput: UploadDocumentInput = {
      projectId,
      originalFilename: file.filename,
      mimeType: file.mimetype,
      body: file.file,
      source: {
        type: "api",
        received_at: new Date().toISOString(),
        metadata: {
          request_id: request.id
        }
      }
    };
    const title = readMultipartField(file, "title");
    if (title !== undefined) {
      uploadInput.title = title;
    }

    const result = await dependencies.uploadService.upload(uploadInput);

    reply.status(202).send(toUploadResponse(result, request.id));
  });

  app.get<{ Querystring: { projectId: string; status?: DocumentStatus; limit?: number } }>("/v1/documents", async (request) => {
    if (!dependencies.documentRepository) {
      throw notImplemented("Document listing requires persistence repositories from a later task.");
    }
    requireProjectPermission(request, request.query.projectId, "document:read");

    const listInput: ListDocumentsInput = {
      projectId: request.query.projectId,
      limit: request.query.limit ?? 100
    };
    if (request.query.status !== undefined) {
      listInput.status = request.query.status;
    }

    return {
      documents: (await dependencies.documentRepository.listDocuments(listInput)).map(toDocumentResponse)
    };
  });

  app.get<{ Params: { id: string }; Querystring: { projectId: string } }>("/v1/documents/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request) => {
    if (!dependencies.documentRepository) {
      throw notImplemented("Document lookup requires persistence repositories from a later task.");
    }
    requireProjectPermission(request, request.query.projectId, "document:read");

    return toDocumentResponse(await dependencies.documentRepository.getDocument(request.query.projectId, request.params.id));
  });

  app.get<{ Params: { id: string }; Querystring: { projectId: string } }>("/v1/documents/:id/status", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request) => {
    if (!dependencies.documentRepository) {
      throw notImplemented("Document status lookup requires persistence repositories from a later task.");
    }
    requireProjectPermission(request, request.query.projectId, "document:read");

    const document = await dependencies.documentRepository.getDocument(request.query.projectId, request.params.id);
    return {
      id: document.id,
      project_id: document.projectId,
      status: document.status,
      updated_at: document.updatedAt.toISOString()
    };
  });

  app.get<{ Params: { id: string }; Querystring: { projectId: string } }>("/v1/documents/:id/processing-runs", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request) => {
    if (!dependencies.artifactRepository) {
      throw notImplemented("Processing run listing requires derived artifact repository dependencies.");
    }
    requireProjectPermission(request, request.query.projectId, "document:read");

    return {
      processing_runs: (await dependencies.artifactRepository.listProcessingRuns(request.query.projectId, request.params.id)).map(toProcessingRunResponse)
    };
  });

  app.post<{ Params: { id: string }; Body: RecomputeDocumentBody }>("/v1/documents/:id/recompute", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    if (!dependencies.recomputeService) {
      throw notImplemented("Document recompute requires job dispatcher runtime dependencies.");
    }
    requireProjectPermission(request, request.body.projectId, "document:write");

    try {
      const recomputeInput = {
        projectId: request.body.projectId,
        documentId: request.params.id,
        metadata: {
          request_id: request.id,
          source: "api"
        }
      };
      if (request.body.stages !== undefined) {
        Object.assign(recomputeInput, { stages: request.body.stages });
      }
      if (request.body.reason !== undefined) {
        Object.assign(recomputeInput, { reason: request.body.reason });
      }
      if (request.body.requestId !== undefined) {
        Object.assign(recomputeInput, { requestId: request.body.requestId });
      }
      const result = await dependencies.recomputeService.requestRecompute(recomputeInput);

      reply.status(202).send({
        request_id: request.id,
        recompute_request_id: result.requestId,
        processing_run_id: result.processingRunId,
        stages: result.stages,
        document: toDocumentResponse(result.document),
        job: {
          id: result.job.processingJobId,
          queue_job_id: result.job.queueJobId,
          queue_name: result.job.queueName
        }
      });
    } catch (error) {
      if (error instanceof DocumentRecomputeError) {
        throw new ApiError(400, error.code, error.message);
      }
      throw error;
    }
  });

  app.post<{ Body: SearchDocumentsBody }>("/v1/documents/search", async (request) => {
    if (!dependencies.chunkSearchRepository) {
      throw notImplemented("Document search requires chunk search repositories from a later task.");
    }
    requireProjectPermissionForEach(request, request.body.projectIds, "document:search");

    return {
      hits: await dependencies.chunkSearchRepository.searchDocumentChunks(request.body)
    };
  });
}

function readMultipartField(file: MultipartFile, fieldName: string): string | undefined {
  const field = file.fields[fieldName] as MultipartFieldValue | undefined;
  return typeof field?.value === "string" && field.value.length > 0 ? field.value : undefined;
}

function toUploadResponse(result: UploadDocumentResult, requestId: string): Record<string, unknown> {
  return {
    request_id: requestId,
    document: {
      id: result.document.id,
      project_id: result.document.projectId,
      title: result.document.title,
      original_filename: result.document.originalFilename,
      mime_type: result.document.mimeType,
      size_bytes: result.document.sizeBytes,
      storage_key: result.document.storageKey,
      status: result.document.status
    },
    scan_job: result.scanJob
      ? {
        id: result.scanJob.processingJobId,
        queue_job_id: result.scanJob.queueJobId,
        queue_name: result.scanJob.queueName
      }
      : null,
    route_job: result.routeJob
      ? {
        id: result.routeJob.processingJobId,
        queue_job_id: result.routeJob.queueJobId,
        queue_name: result.routeJob.queueName
      }
      : null
  };
}

function toDocumentResponse(document: DocumentRecord): Record<string, unknown> {
  return {
    id: document.id,
    project_id: document.projectId,
    title: document.title,
    original_filename: document.originalFilename,
    mime_type: document.mimeType,
    size_bytes: document.sizeBytes,
    storage_key: document.storageKey,
    status: document.status,
    source: document.source,
    metadata: document.metadata,
    created_at: document.createdAt.toISOString(),
    updated_at: document.updatedAt.toISOString()
  };
}

function toProcessingRunResponse(run: ProcessingRunRecord): Record<string, unknown> {
  return {
    id: run.id,
    project_id: run.projectId,
    document_id: run.documentId,
    status: run.status,
    reason: run.reason,
    processor_version: run.processorVersion,
    config_fingerprint: run.configFingerprint,
    model_runtime_fingerprint: run.modelRuntimeFingerprint,
    source_document_storage_key: run.sourceDocumentStorageKey,
    source_document_checksum: run.sourceDocumentChecksum,
    metadata: run.metadata,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt?.toISOString() ?? null,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString()
  };
}
