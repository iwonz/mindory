import type { FastifyInstance } from "fastify";
import type { UnifiedSearchHit, UnifiedSearchInput, UnifiedSearchService } from "@mindory/core/search";
import { SearchError } from "@mindory/core/search";
import { requireProjectPermissionForEach } from "../auth.js";
import { ApiError } from "../errors.js";
import { assertRouteDependencies, requireRouteDependency, type RouteDependencyOptions } from "./dependencies.js";

export interface SearchRouteDependencies extends RouteDependencyOptions {
  unifiedSearchService?: UnifiedSearchService;
}

type SearchBody = UnifiedSearchInput;

const metadataFilterSchema = {
  type: "object",
  required: ["key"],
  additionalProperties: false,
  properties: {
    key: { type: "string", minLength: 1 },
    operator: { type: "string", enum: ["eq", "lt", "lte", "gt", "gte", "between"] },
    valueText: { type: "string" },
    valueNumber: { type: "number" },
    valueBoolean: { type: "boolean" },
    valueTimestamp: { type: "string" },
    minNumber: { type: "number" },
    maxNumber: { type: "number" },
    unit: { type: "string" }
  }
} as const;

export async function registerSearchRoutes(app: FastifyInstance, dependencies: SearchRouteDependencies = {}): Promise<void> {
  assertRouteDependencies("Search routes", dependencies, [["unifiedSearchService", dependencies.unifiedSearchService]]);

  app.post<{ Body: SearchBody }>("/v1/search", {
    schema: {
      body: {
        type: "object",
        required: ["projectIds", "limit"],
        additionalProperties: false,
        properties: {
          projectIds: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 }
          },
          query: { type: "string", minLength: 1 },
          targets: {
            type: "array",
            items: { type: "string", enum: ["documents", "artifacts", "faces"] }
          },
          artifactTypes: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "raw_metadata",
                "text",
                "ocr_text",
                "transcript",
                "image_caption",
                "image_analysis",
                "image_embedding",
                "object_detection",
                "pdf_page",
                "video_keyframe",
                "face_observation",
                "metadata"
              ]
            }
          },
          spanTypes: {
            type: "array",
            items: { type: "string", minLength: 1 }
          },
          faceIdentityStatuses: {
            type: "array",
            items: { type: "string", enum: ["candidate", "confirmed", "archived"] }
          },
          metadataFilters: {
            type: "array",
            items: metadataFilterSchema
          },
          limit: { type: "integer", minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request) => {
    const unifiedSearchService = requireRouteDependency(dependencies.unifiedSearchService, "unifiedSearchService");
    requireProjectPermissionForEach(request, request.body.projectIds, "document:search");

    try {
      const hits = await unifiedSearchService.search(request.body);
      return {
        hits: hits.map(toUnifiedSearchHitResponse)
      };
    } catch (error) {
      if (error instanceof SearchError) {
        throw new ApiError(400, error.code, error.message);
      }
      throw error;
    }
  });
}

function toUnifiedSearchHitResponse(hit: UnifiedSearchHit): Record<string, unknown> {
  return {
    kind: hit.kind,
    project_id: hit.projectId,
    document_id: hit.documentId,
    chunk_id: hit.chunkId ?? null,
    artifact_id: hit.artifactId ?? null,
    artifact_type: hit.artifactType ?? null,
    span_id: hit.spanId ?? null,
    span_type: hit.spanType ?? null,
    face_observation_id: hit.faceObservationId ?? null,
    face_identity_id: hit.faceIdentityId ?? null,
    content: hit.content,
    score: hit.score,
    source_refs: hit.sourceRefs,
    source_position: hit.sourcePosition,
    metadata: hit.metadata
  };
}
