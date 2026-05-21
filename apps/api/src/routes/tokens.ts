import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  generateAccessTokenSecret,
  hashAccessToken,
  isMindoryPermission,
  MINDORY_PERMISSIONS,
  type AccessTokenRecord,
  type AccessTokenRepository,
  type CreateAccessTokenInput,
  type MindoryPermission,
  type RotateAccessTokenInput
} from "@mindory/auth";
import { requireProjectPermission } from "../auth.js";
import { ApiError, notImplemented } from "../errors.js";

export interface TokenRouteDependencies {
  accessTokenRepository?: AccessTokenRepository;
  idFactory?: () => string;
  tokenFactory?: () => string;
  now?: () => Date;
}

interface CreateTokenBody {
  projectId: string;
  name: string;
  permissions: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

interface TokenListQuery {
  projectId: string;
  limit?: number | string;
}

interface TokenParams {
  id: string;
}

interface TokenProjectBody {
  projectId: string;
}

interface RotateTokenBody extends TokenProjectBody {
  expiresAt?: string | null;
}

const tokenResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    project_id: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["active", "revoked", "expired"] },
    permissions: {
      type: "array",
      items: { type: "string", enum: [...MINDORY_PERMISSIONS] }
    },
    expires_at: { type: ["string", "null"] },
    last_used_at: { type: ["string", "null"] },
    metadata: { type: "object", additionalProperties: true },
    created_at: { type: "string" },
    updated_at: { type: "string" }
  }
} as const;

export async function registerTokenRoutes(app: FastifyInstance, dependencies: TokenRouteDependencies = {}): Promise<void> {
  const idFactory = dependencies.idFactory ?? (() => randomUUID());
  const tokenFactory = dependencies.tokenFactory ?? generateAccessTokenSecret;
  const nowFactory = dependencies.now ?? (() => new Date());

  app.post<{ Body: CreateTokenBody }>("/v1/tokens", {
    schema: {
      body: {
        type: "object",
        required: ["projectId", "name", "permissions"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          permissions: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", enum: [...MINDORY_PERMISSIONS] }
          },
          expiresAt: { type: ["string", "null"] },
          metadata: { type: "object", additionalProperties: true }
        }
      },
      response: {
        201: {
          type: "object",
          additionalProperties: false,
          properties: {
            token: { type: "string" },
            access_token: tokenResponseSchema
          }
        }
      }
    }
  }, async (request, reply) => {
    const repository = requireAccessTokenRepository(dependencies.accessTokenRepository);
    requireProjectPermission(request, request.body.projectId, "token:write");

    const rawToken = tokenFactory();
    const input: CreateAccessTokenInput = {
      id: `tok_${idFactory()}`,
      projectId: request.body.projectId,
      name: request.body.name,
      tokenHash: hashAccessToken(rawToken),
      permissions: normalizePermissions(request.body.permissions)
    };
    const expiresAt = parseOptionalExpiry(request.body.expiresAt, nowFactory());
    if (expiresAt !== undefined) {
      input.expiresAt = expiresAt;
    }
    if (request.body.metadata !== undefined) {
      input.metadata = request.body.metadata;
    }

    const accessToken = await repository.createAccessToken(input);
    reply.status(201).send({
      token: rawToken,
      access_token: toAccessTokenResponse(accessToken)
    });
  });

  app.get<{ Querystring: TokenListQuery }>("/v1/tokens", {
    schema: {
      querystring: {
        type: "object",
        required: ["projectId"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request) => {
    const repository = requireAccessTokenRepository(dependencies.accessTokenRepository);
    requireProjectPermission(request, request.query.projectId, "token:read");

    return {
      tokens: (await repository.listAccessTokens({
        projectId: request.query.projectId,
        limit: normalizeLimit(request.query.limit)
      })).map(toAccessTokenResponse)
    };
  });

  app.post<{ Params: TokenParams; Body: TokenProjectBody }>("/v1/tokens/:id/revoke", {
    schema: {
      params: tokenParamsSchema,
      body: tokenProjectBodySchema
    }
  }, async (request) => {
    const repository = requireAccessTokenRepository(dependencies.accessTokenRepository);
    requireProjectPermission(request, request.body.projectId, "token:write");

    return {
      access_token: toAccessTokenResponse(await repository.revokeAccessToken(request.body.projectId, request.params.id))
    };
  });

  app.post<{ Params: TokenParams; Body: RotateTokenBody }>("/v1/tokens/:id/rotate", {
    schema: {
      params: tokenParamsSchema,
      body: {
        type: "object",
        required: ["projectId"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 },
          expiresAt: { type: ["string", "null"] }
        }
      }
    }
  }, async (request) => {
    const repository = requireAccessTokenRepository(dependencies.accessTokenRepository);
    requireProjectPermission(request, request.body.projectId, "token:write");

    const rawToken = tokenFactory();
    const input: RotateAccessTokenInput = {
      projectId: request.body.projectId,
      tokenId: request.params.id,
      tokenHash: hashAccessToken(rawToken)
    };
    if ("expiresAt" in request.body) {
      const expiresAt = parseOptionalExpiry(request.body.expiresAt, nowFactory());
      if (expiresAt !== undefined) {
        input.expiresAt = expiresAt;
      }
    }

    return {
      token: rawToken,
      access_token: toAccessTokenResponse(await repository.rotateAccessToken(input))
    };
  });
}

const tokenParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 }
  }
} as const;

const tokenProjectBodySchema = {
  type: "object",
  required: ["projectId"],
  additionalProperties: false,
  properties: {
    projectId: { type: "string", minLength: 1 }
  }
} as const;

function requireAccessTokenRepository(repository: AccessTokenRepository | undefined): AccessTokenRepository {
  if (!repository) {
    throw notImplemented("Token operations require access token repository runtime dependencies.");
  }
  return repository;
}

function normalizePermissions(values: string[]): MindoryPermission[] {
  const permissions = values.filter(isMindoryPermission);
  if (permissions.length !== values.length || permissions.length === 0) {
    throw new ApiError(400, "invalid_permissions", "Token permissions must be known Mindory permissions.");
  }
  return permissions;
}

function parseOptionalExpiry(value: string | null | undefined, now: Date): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new ApiError(400, "invalid_expires_at", "expiresAt must be an ISO timestamp or null.");
  }
  if (expiresAt <= now) {
    throw new ApiError(400, "expires_at_must_be_future", "expiresAt must be in the future.");
  }
  return expiresAt;
}

function normalizeLimit(value: number | string | undefined): number {
  if (value === undefined) {
    return 100;
  }
  const limit = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, "invalid_limit", "limit must be an integer between 1 and 100.");
  }
  return limit;
}

function toAccessTokenResponse(token: AccessTokenRecord): Record<string, unknown> {
  return {
    id: token.id,
    project_id: token.projectId,
    name: token.name,
    status: token.status,
    permissions: token.permissions,
    expires_at: token.expiresAt?.toISOString() ?? null,
    last_used_at: token.lastUsedAt?.toISOString() ?? null,
    metadata: token.metadata,
    created_at: token.createdAt.toISOString(),
    updated_at: token.updatedAt.toISOString()
  };
}
