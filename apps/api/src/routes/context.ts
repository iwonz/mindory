import type { FastifyInstance } from "fastify";
import { ContextBuilder, type BuildContextInput } from "@mindory/core/memory";
import { requireProjectPermissionForEach } from "../auth.js";
import { assertRouteDependencies, requireRouteDependency, type RouteDependencyOptions } from "./dependencies.js";

export interface ContextRouteDependencies extends RouteDependencyOptions {
  contextBuilder?: ContextBuilder;
}

export async function registerContextRoutes(app: FastifyInstance, dependencies: ContextRouteDependencies = {}): Promise<void> {
  assertRouteDependencies("Context routes", dependencies, [["contextBuilder", dependencies.contextBuilder]]);

  app.post<{ Body: BuildContextInput }>("/v1/context/build", {
    schema: {
      body: {
        type: "object",
        required: ["projectIds", "tokenBudget"],
        additionalProperties: false,
        properties: {
          projectIds: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 }
          },
          sessionId: { type: "string", minLength: 1 },
          query: { type: "string" },
          tokenBudget: { type: "integer", minimum: 1 },
          include: {
            type: "object",
            additionalProperties: false,
            properties: {
              sessionSummary: { type: "boolean" },
              recentMessages: { type: "boolean" },
              memories: { type: "boolean" },
              documents: { type: "boolean" }
            }
          }
        }
      }
    }
  }, async (request) => {
    const contextBuilder = requireRouteDependency(dependencies.contextBuilder, "contextBuilder");
    requireProjectPermissionForEach(request, request.body.projectIds, "context:build");

    return contextBuilder.build(request.body);
  });
}
