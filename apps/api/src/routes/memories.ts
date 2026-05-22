import type { FastifyInstance } from "fastify";
import {
  MemoryService,
  type ExplainMemoryInput,
  type MemoryClaimRecord,
  type MemorySearchHit,
  type RememberMemoryInput,
  type SearchMemoryClaimsInput,
  type SourceRef
} from "@mindory/core/memory";
import { requireProjectPermission, requireProjectPermissionForEach } from "../auth.js";
import { assertRouteDependencies, requireRouteDependency, type RouteDependencyOptions } from "./dependencies.js";

export interface MemoryRouteDependencies extends RouteDependencyOptions {
  memoryService?: MemoryService;
}

type RememberMemoryBody = Omit<RememberMemoryInput, "sourceRefs"> & {
  sourceRefs: SourceRef[];
};

type SearchMemoriesBody = SearchMemoryClaimsInput;

type ExplainMemoryBody = Omit<ExplainMemoryInput, "memoryId">;

interface MemoryRouteParams {
  id: string;
}

interface ProjectQuery {
  projectId: string;
}

const sourceRefSchema = {
  type: "object",
  required: ["type", "id"],
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["session", "message", "document", "chunk", "memory"] },
    id: { type: "string", minLength: 1 }
  }
} as const;

export async function registerMemoryRoutes(app: FastifyInstance, dependencies: MemoryRouteDependencies = {}): Promise<void> {
  assertRouteDependencies("Memory routes", dependencies, [["memoryService", dependencies.memoryService]]);

  app.post<{ Body: RememberMemoryBody }>("/v1/memories", {
    schema: {
      body: {
        type: "object",
        required: ["projectId", "text", "sourceRefs"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 },
          type: { type: "string", enum: ["semantic", "episodic", "preference", "decision", "task", "artifact_reference", "derived"] },
          text: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["candidate", "active", "rejected", "archived"] },
          importance: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sourceRefs: { type: "array", minItems: 1, items: sourceRefSchema },
          createdSource: { type: "object", additionalProperties: true },
          createdByPeerId: { type: ["string", "null"] },
          metadata: { type: "object", additionalProperties: true }
        }
      }
    }
  }, async (request, reply) => {
    const memoryService = requireRouteDependency(dependencies.memoryService, "memoryService");
    requireProjectPermission(request, request.body.projectId, "memory:write");

    const memory = await memoryService.remember(request.body);
    reply.status(201).send(toMemoryResponse(memory));
  });

  app.get<{ Params: MemoryRouteParams; Querystring: ProjectQuery }>("/v1/memories/:id", {
    schema: {
      params: memoryIdParamsSchema,
      querystring: projectQuerySchema
    }
  }, async (request) => {
    const memoryService = requireRouteDependency(dependencies.memoryService, "memoryService");
    requireProjectPermission(request, request.query.projectId, "memory:read");

    return toMemoryResponse(await memoryService.get(request.query.projectId, request.params.id));
  });

  app.post<{ Body: SearchMemoriesBody }>("/v1/memories/search", {
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
          query: { type: "string" },
          statuses: {
            type: "array",
            items: { type: "string", enum: ["candidate", "active", "rejected", "archived"] }
          },
          types: {
            type: "array",
            items: { type: "string", enum: ["semantic", "episodic", "preference", "decision", "task", "artifact_reference", "derived"] }
          },
          limit: { type: "integer", minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request) => {
    const memoryService = requireRouteDependency(dependencies.memoryService, "memoryService");
    requireProjectPermissionForEach(request, request.body.projectIds, "memory:read");

    const hits = await memoryService.search(request.body);
    return {
      hits: hits.map(toMemorySearchHitResponse)
    };
  });

  app.post<{ Params: MemoryRouteParams; Body: ExplainMemoryBody }>("/v1/memories/:id/explain", {
    schema: {
      params: memoryIdParamsSchema,
      body: {
        type: "object",
        required: ["projectId"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request) => {
    const memoryService = requireRouteDependency(dependencies.memoryService, "memoryService");
    requireProjectPermission(request, request.body.projectId, "memory:read");

    return memoryService.explain({
      projectId: request.body.projectId,
      memoryId: request.params.id
    });
  });

  app.delete<{ Params: MemoryRouteParams; Querystring: ProjectQuery }>("/v1/memories/:id", {
    schema: {
      params: memoryIdParamsSchema,
      querystring: projectQuerySchema
    }
  }, async (request) => {
    const memoryService = requireRouteDependency(dependencies.memoryService, "memoryService");
    requireProjectPermission(request, request.query.projectId, "memory:delete");

    return toMemoryResponse(await memoryService.archive(request.query.projectId, request.params.id));
  });
}

const memoryIdParamsSchema = {
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

function toMemorySearchHitResponse(hit: MemorySearchHit): Record<string, unknown> {
  return {
    memory: toMemoryResponse(hit.memory),
    score: hit.score,
    match_reason: hit.matchReason
  };
}

function toMemoryResponse(memory: MemoryClaimRecord): Record<string, unknown> {
  return {
    id: memory.id,
    project_id: memory.projectId,
    type: memory.type,
    text: memory.text,
    status: memory.status,
    importance: memory.importance,
    confidence: memory.confidence,
    source_refs: memory.sourceRefs,
    created_source: memory.createdSource,
    created_by_peer_id: memory.createdByPeerId,
    metadata: memory.metadata,
    created_at: memory.createdAt.toISOString(),
    updated_at: memory.updatedAt.toISOString()
  };
}
