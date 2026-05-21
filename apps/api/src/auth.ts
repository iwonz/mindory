import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AuthError,
  authorizedProjectIds,
  parseBearerToken,
  placeholderAuthorizationContext,
  requireProjectPermission as requireProjectPermissionFromContext,
  unauthenticatedContext,
  verifyBearerToken,
  type AccessTokenRepository,
  type AuthorizationContext,
  type MindoryPermission
} from "@mindory/auth";
import { ApiError } from "./errors.js";

export interface ApiAuthDependencies {
  accessTokenRepository?: AccessTokenRepository;
  now?: () => Date;
}

declare module "fastify" {
  interface FastifyRequest {
    authorizationContext: AuthorizationContext | null;
  }
}

export function buildPlaceholderAuthorizationContext(request: FastifyRequest): AuthorizationContext {
  return placeholderAuthorizationContext(parseBearerToken(request.headers.authorization) !== null);
}

export async function registerAuth(app: FastifyInstance, dependencies: ApiAuthDependencies = {}): Promise<void> {
  app.decorateRequest("authorizationContext", null);

  app.addHook("onRequest", async (request) => {
    if (!dependencies.accessTokenRepository) {
      request.authorizationContext = buildPlaceholderAuthorizationContext(request);
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

export async function registerAuthPlaceholder(app: FastifyInstance): Promise<void> {
  await registerAuth(app);
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
  return request.authorizationContext?.placeholder === true;
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
