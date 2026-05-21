import type { FastifyInstance } from "fastify";
import {
  FaceService,
  FaceServiceError,
  type MergeFaceIdentitiesResult
} from "@mindory/core/faces";
import type { FaceIdentityRecord, FaceIdentityStatus, FaceObservationRecord } from "@mindory/core/artifacts";
import { requireProjectPermission } from "../auth.js";
import { ApiError, notImplemented } from "../errors.js";

export interface FaceRouteDependencies {
  faceService?: FaceService;
}

interface FaceIdentityParams {
  id: string;
}

interface ProjectQuery {
  projectId: string;
}

interface ListFaceIdentitiesQuery extends ProjectQuery {
  status?: FaceIdentityStatus;
  limit?: number;
}

interface ListFaceObservationsQuery extends ProjectQuery {
  identityId?: string;
  documentId?: string;
  limit?: number;
}

interface RenameFaceIdentityBody extends ProjectQuery {
  label: string | null;
}

interface MergeFaceIdentityBody extends ProjectQuery {
  targetIdentityId: string;
}

export async function registerFaceRoutes(app: FastifyInstance, dependencies: FaceRouteDependencies = {}): Promise<void> {
  app.get<{ Querystring: ListFaceIdentitiesQuery }>("/v1/faces/identities", {
    schema: {
      querystring: {
        type: "object",
        required: ["projectId"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["candidate", "confirmed", "archived"] },
          limit: { type: "integer", minimum: 1, maximum: 500 }
        }
      }
    }
  }, async (request) => {
    const faceService = requireFaceService(dependencies);
    requireProjectPermission(request, request.query.projectId, "face:read");
    const input = {
      projectId: request.query.projectId,
      ...(request.query.status ? { statuses: [request.query.status] } : {}),
      ...(request.query.limit !== undefined ? { limit: request.query.limit } : {})
    };
    const identities = await faceService.listIdentities(input);
    return {
      identities: identities.map(toFaceIdentityResponse)
    };
  });

  app.get<{ Params: FaceIdentityParams; Querystring: ProjectQuery }>("/v1/faces/identities/:id", {
    schema: {
      params: faceIdentityParamsSchema,
      querystring: projectQuerySchema
    }
  }, async (request) => {
    const faceService = requireFaceService(dependencies);
    requireProjectPermission(request, request.query.projectId, "face:read");
    return toFaceIdentityResponse(await faceService.getIdentity(request.query.projectId, request.params.id));
  });

  app.get<{ Querystring: ListFaceObservationsQuery }>("/v1/faces/observations", {
    schema: {
      querystring: {
        type: "object",
        required: ["projectId"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 },
          identityId: { type: "string", minLength: 1 },
          documentId: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 1000 }
        }
      }
    }
  }, async (request) => {
    const faceService = requireFaceService(dependencies);
    requireProjectPermission(request, request.query.projectId, "face:read");
    const input = {
      projectId: request.query.projectId,
      ...(request.query.identityId !== undefined ? { identityId: request.query.identityId } : {}),
      ...(request.query.documentId !== undefined ? { documentId: request.query.documentId } : {}),
      ...(request.query.limit !== undefined ? { limit: request.query.limit } : {})
    };
    const observations = await faceService.listObservations(input);
    return {
      observations: observations.map(toFaceObservationResponse)
    };
  });

  app.patch<{ Params: FaceIdentityParams; Body: RenameFaceIdentityBody }>("/v1/faces/identities/:id", {
    schema: {
      params: faceIdentityParamsSchema,
      body: {
        type: "object",
        required: ["projectId", "label"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 },
          label: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }
        }
      }
    }
  }, async (request) => {
    const faceService = requireFaceService(dependencies);
    requireProjectPermission(request, request.body.projectId, "face:write");
    const identity = await faceService.renameIdentity({
      projectId: request.body.projectId,
      identityId: request.params.id,
      label: request.body.label
    });
    return toFaceIdentityResponse(identity);
  });

  app.post<{ Params: FaceIdentityParams; Body: MergeFaceIdentityBody }>("/v1/faces/identities/:id/merge", {
    schema: {
      params: faceIdentityParamsSchema,
      body: {
        type: "object",
        required: ["projectId", "targetIdentityId"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 },
          targetIdentityId: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request) => {
    const faceService = requireFaceService(dependencies);
    requireProjectPermission(request, request.body.projectId, "face:write");
    try {
      const result = await faceService.mergeIdentities({
        projectId: request.body.projectId,
        sourceIdentityId: request.params.id,
        targetIdentityId: request.body.targetIdentityId
      });
      return toMergeResponse(result);
    } catch (error) {
      if (error instanceof FaceServiceError) {
        throw new ApiError(400, error.code, error.message);
      }
      throw error;
    }
  });
}

const faceIdentityParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 }
  }
} as const;

const projectQuerySchema = {
  type: "object",
  required: ["projectId"],
  additionalProperties: false,
  properties: {
    projectId: { type: "string", minLength: 1 }
  }
} as const;

function requireFaceService(dependencies: FaceRouteDependencies): FaceService {
  if (!dependencies.faceService) {
    throw notImplemented("Face identity operations require a FaceService runtime dependency.");
  }
  return dependencies.faceService;
}

function toMergeResponse(result: MergeFaceIdentitiesResult): Record<string, unknown> {
  return {
    source: toFaceIdentityResponse(result.source),
    target: toFaceIdentityResponse(result.target),
    reassigned_observations: result.reassignedObservations
  };
}

function toFaceIdentityResponse(identity: FaceIdentityRecord): Record<string, unknown> {
  return {
    id: identity.id,
    project_id: identity.projectId,
    label: identity.label,
    status: identity.status,
    representative_artifact_id: identity.representativeArtifactId,
    metadata: identity.metadata,
    created_at: identity.createdAt.toISOString(),
    updated_at: identity.updatedAt.toISOString()
  };
}

function toFaceObservationResponse(observation: FaceObservationRecord): Record<string, unknown> {
  return {
    id: observation.id,
    project_id: observation.projectId,
    document_id: observation.documentId,
    artifact_id: observation.artifactId,
    processing_run_id: observation.processingRunId,
    face_identity_id: observation.faceIdentityId,
    embedding_id: observation.embeddingId,
    model: observation.model,
    bounding_box: observation.boundingBox,
    confidence: observation.confidence,
    metadata: observation.metadata,
    created_at: observation.createdAt.toISOString()
  };
}
