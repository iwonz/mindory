import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AuthError,
  authorizedProjectIds,
  dependencyFreeAuthorizationContext,
  parseBearerToken,
  requireProjectPermission as requireProjectPermissionFromContext,
  verifyBearerToken,
  type AccessTokenRepository,
  type AuthorizationContext,
  type MindoryPermission
} from "@mindory/auth";
import { ApiError } from "./errors.js";

export interface ApiAuthDependencies {
  accessTokenRepository?: AccessTokenRepository;
  now?: () => Date;
  allowDependencyFreeRoutes?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    authorizationContext: AuthorizationContext | null;
  }
}

export function buildDependencyFreeAuthorizationContext(request: FastifyRequest): AuthorizationContext {
  return dependencyFreeAuthorizationContext(parseBearerToken(request.headers.authorization) !== null);
}

export async function registerAuth(app: FastifyInstance, dependencies: ApiAuthDependencies = {}): Promise<void> {
  app.decorateRequest("authorizationContext", null);

  app.addHook("onRequest", async (request) => {
    if (!dependencies.accessTokenRepository) {
      if (dependencies.allowDependencyFreeRoutes !== true) {
        throw new Error("API auth requires accessTokenRepository runtime dependency.");
      }
      request.authorizationContext = buildDependencyFreeAuthorizationContext(request);
      return;
    }

    try {
      request.authorizationContext = await verifyBearerToken({
        authorizationHeader: request.headers.authorization,
        repository: dependencies.accessTokenRepository,
        now: dependencies.now?.() ?? new Date()
      });
    } catch (error) {
      throw toApiAuthError(error);
    }
  });
}

export async function registerDependencyFreeAuth(app: FastifyInstance): Promise<void> {
  await registerAuth(app, { allowDependencyFreeRoutes: true });
}

export function requireProjectPermission(request: FastifyRequest, projectId: string, permission: MindoryPermission): void {
  if (shouldBypassAuthorization(request)) {
    return;
  }

  try {
    requireProjectPermissionFromContext(request.authorizationContext, projectId, permission);
  } catch (error) {
    throw toApiAuthError(error);
  }
}

export function requireProjectPermissionForEach(request: FastifyRequest, projectIds: string[], permission: MindoryPermission): void {
  if (shouldBypassAuthorization(request)) {
    return;
  }

  for (const projectId of projectIds) {
    requireProjectPermission(request, projectId, permission);
  }
}

export function authorizedReadableProjectIds(request: FastifyRequest): string[] {
  try {
    return authorizedProjectIds(request.authorizationContext, "project:read");
  } catch (error) {
    throw toApiAuthError(error);
  }
}

export function shouldBypassAuthorization(request: FastifyRequest): boolean {
  return request.authorizationContext?.dependencyFree === true;
}

function toApiAuthError(error: unknown): ApiError {
  if (error instanceof AuthError) {
    if (error.code === "missing_bearer_token" || error.code === "invalid_bearer_token" || error.code === "invalid_access_token") {
      return new ApiError(401, error.code, error.message);
    }
    return new ApiError(403, error.code, error.message);
  }
  if (error instanceof ApiError) {
    return error;
  }
  return new ApiError(500, "auth_error", "Authorization failed.");
}
