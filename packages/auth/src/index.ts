import { createHash } from "node:crypto";

export const MINDORY_PERMISSIONS = [
  "project:read",
  "session:read",
  "session:write",
  "message:read",
  "message:write",
  "document:read",
  "document:write",
  "document:search",
  "memory:read",
  "memory:write",
  "memory:delete",
  "context:build"
] as const;

export type MindoryPermission = typeof MINDORY_PERMISSIONS[number];

export interface ProjectAuthorizationScope {
  projectId: string;
  permissions: MindoryPermission[];
}

export interface AuthorizationContext {
  tokenId: string | null;
  tokenPresented: boolean;
  allowedProjects: ProjectAuthorizationScope[];
  placeholder: boolean;
}

export interface VerifiedAccessToken {
  tokenId: string;
  allowedProjects: ProjectAuthorizationScope[];
}

export interface AccessTokenRepository {
  findActiveTokenByHash(tokenHash: string, now: Date): Promise<VerifiedAccessToken | null>;
  markTokenUsed(tokenId: string, usedAt: Date): Promise<void>;
}

export type AuthErrorCode =
  | "missing_bearer_token"
  | "invalid_bearer_token"
  | "invalid_access_token"
  | "project_access_denied";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export function parseBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token, extra] = header.trim().split(/\s+/, 3);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
    throw new AuthError("invalid_bearer_token", "Authorization header must use Bearer token format.");
  }

  return token;
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function verifyBearerToken(input: {
  authorizationHeader: string | undefined;
  repository: AccessTokenRepository;
  now?: Date;
}): Promise<AuthorizationContext> {
  const token = parseBearerToken(input.authorizationHeader);
  if (!token) {
    return unauthenticatedContext(false);
  }

  const now = input.now ?? new Date();
  const verified = await input.repository.findActiveTokenByHash(hashAccessToken(token), now);
  if (!verified) {
    throw new AuthError("invalid_access_token", "Bearer token is invalid, revoked or expired.");
  }

  await input.repository.markTokenUsed(verified.tokenId, now);

  return {
    tokenId: verified.tokenId,
    tokenPresented: true,
    allowedProjects: verified.allowedProjects,
    placeholder: false
  };
}

export function unauthenticatedContext(placeholder: boolean): AuthorizationContext {
  return {
    tokenId: null,
    tokenPresented: false,
    allowedProjects: [],
    placeholder
  };
}

export function placeholderAuthorizationContext(tokenPresented: boolean): AuthorizationContext {
  return {
    tokenId: tokenPresented ? "placeholder" : null,
    tokenPresented,
    allowedProjects: [],
    placeholder: true
  };
}

export function hasProjectPermission(
  context: AuthorizationContext | null,
  projectId: string,
  permission: MindoryPermission
): boolean {
  return Boolean(context?.allowedProjects.some((scope) =>
    scope.projectId === projectId && scope.permissions.includes(permission)
  ));
}

export function requireProjectPermission(
  context: AuthorizationContext | null,
  projectId: string,
  permission: MindoryPermission
): void {
  if (!context?.tokenPresented) {
    throw new AuthError("missing_bearer_token", "Bearer token is required.");
  }
  if (!hasProjectPermission(context, projectId, permission)) {
    throw new AuthError("project_access_denied", `Token does not grant ${permission} on project ${projectId}.`);
  }
}

export function authorizedProjectIds(
  context: AuthorizationContext | null,
  permission: MindoryPermission
): string[] {
  if (!context?.tokenPresented) {
    throw new AuthError("missing_bearer_token", "Bearer token is required.");
  }

  return context.allowedProjects
    .filter((scope) => scope.permissions.includes(permission))
    .map((scope) => scope.projectId);
}

export function isMindoryPermission(value: string): value is MindoryPermission {
  return (MINDORY_PERMISSIONS as readonly string[]).includes(value);
}
