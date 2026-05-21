import fastifyMultipart, { type MultipartFile } from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { DocumentUploadService, type DocumentRecord, type DocumentRepository, type DocumentStatus, type ListDocumentsInput, type UploadDocumentInput, type UploadDocumentResult } from "@mindory/core/documents";
import type { DocumentChunkSearchRepository } from "@mindory/core/memory";
import { requireProjectPermission, requireProjectPermissionForEach } from "../auth.js";
import { ApiError, notImplemented } from "../errors.js";

export interface DocumentRouteDependencies {
  uploadService?: DocumentUploadService;
  documentRepository?: DocumentRepository;
  chunkSearchRepository?: DocumentChunkSearchRepository;
}

interface MultipartFieldValue {
  value?: unknown;
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

  app.post<{ Body: { projectIds: string[]; query: string; limit: number } }>("/v1/documents/search", async (request) => {
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
