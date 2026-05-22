import type { FastifyInstance } from "fastify";
import type {
  ArtifactSearchHit,
  DerivedArtifactRepository,
  SearchArtifactsInput
} from "@mindory/core/artifacts";
import { requireProjectPermissionForEach } from "../auth.js";
import { assertRouteDependencies, requireRouteDependency, type RouteDependencyOptions } from "./dependencies.js";

export interface ArtifactRouteDependencies extends RouteDependencyOptions {
  artifactRepository?: DerivedArtifactRepository;
}

type SearchArtifactsBody = SearchArtifactsInput;

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

export async function registerArtifactRoutes(app: FastifyInstance, dependencies: ArtifactRouteDependencies = {}): Promise<void> {
  assertRouteDependencies("Artifact routes", dependencies, [["artifactRepository", dependencies.artifactRepository]]);

  app.post<{ Body: SearchArtifactsBody }>("/v1/artifacts/search", {
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
          metadataFilters: {
            type: "array",
            items: metadataFilterSchema
          },
          limit: { type: "integer", minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request) => {
    const artifactRepository = requireRouteDependency(dependencies.artifactRepository, "artifactRepository");
    requireProjectPermissionForEach(request, request.body.projectIds, "document:search");
    const hits = await artifactRepository.searchArtifacts(request.body);
    return {
      hits: hits.map(toArtifactSearchHitResponse)
    };
  });
}

function toArtifactSearchHitResponse(hit: ArtifactSearchHit): Record<string, unknown> {
  return {
    project_id: hit.projectId,
    document_id: hit.documentId,
    artifact_id: hit.artifactId,
    artifact_type: hit.artifactType,
    span_id: hit.spanId,
    span_type: hit.spanType,
    content: hit.content,
    score: hit.score,
    source_refs: hit.sourceRefs,
    source_position: hit.sourcePosition,
    metadata: hit.metadata
  };
}
