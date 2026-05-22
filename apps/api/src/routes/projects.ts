import type { FastifyInstance } from "fastify";
import type { CreateProjectInput, ProjectRecord, ProjectRepository } from "@mindory/core/projects";
import { authorizedReadableProjectIds, requireProjectPermission, shouldBypassAuthorization } from "../auth.js";
import { assertRouteDependencies, requireRouteDependency, type RouteDependencyOptions } from "./dependencies.js";

export interface ProjectRouteDependencies extends RouteDependencyOptions {
  projectRepository?: ProjectRepository;
}

const projectBodySchema = {
  type: "object",
  required: ["id", "name"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    metadata: { type: "object", additionalProperties: true }
  }
} as const;

export async function registerProjectRoutes(app: FastifyInstance, dependencies: ProjectRouteDependencies = {}): Promise<void> {
  assertRouteDependencies("Project routes", dependencies, [["projectRepository", dependencies.projectRepository]]);

  app.post<{ Body: CreateProjectInput }>("/v1/projects", {
    schema: {
      body: projectBodySchema
    }
  }, async (request, reply) => {
    const projectRepository = requireRouteDependency(dependencies.projectRepository, "projectRepository");
    requireProjectPermission(request, request.body.id, "project:read");

    const project = await projectRepository.createProject(request.body);
    reply.status(201).send(toProjectResponse(project));
  });

  app.get<{ Querystring: { limit?: number } }>("/v1/projects", async (request) => {
    const projectRepository = requireRouteDependency(dependencies.projectRepository, "projectRepository");

    const allowedProjectIds = shouldBypassAuthorization(request) ? null : new Set(authorizedReadableProjectIds(request));
    return {
      projects: (await projectRepository.listProjects(request.query.limit ?? 100))
        .filter((project) => allowedProjectIds === null || allowedProjectIds.has(project.id))
        .map(toProjectResponse)
    };
  });

  app.get<{ Params: { id: string } }>("/v1/projects/:id", {
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
    const projectRepository = requireRouteDependency(dependencies.projectRepository, "projectRepository");
    requireProjectPermission(request, request.params.id, "project:read");

    return toProjectResponse(await projectRepository.getProject(request.params.id));
  });
}

function toProjectResponse(project: ProjectRecord): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    metadata: project.metadata,
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString()
  };
}
