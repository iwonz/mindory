import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  AccessTokenRecord,
  AccessTokenRepository,
  CreateAccessTokenInput,
  ListAccessTokensInput,
  MindoryPermission,
  ProjectAuthorizationScope,
  RotateAccessTokenInput,
  VerifiedAccessToken
} from "@mindory/auth";
import { isMindoryPermission } from "@mindory/auth";
import { accessTokenProjectScopes, accessTokens } from "../schema.js";
import { firstOrThrow, type MindoryDatabase } from "./types.js";

export class DbAccessTokenRepository implements AccessTokenRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async findActiveTokenByHash(tokenHash: string, now: Date): Promise<VerifiedAccessToken | null> {
    const rows = await this.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.tokenHash, tokenHash))
      .limit(1);
    const token = rows[0];
    if (!token || token.status !== "active") {
      return null;
    }
    if (token.expiresAt !== null && token.expiresAt <= now) {
      return null;
    }

    const scopes = await this.db
      .select()
      .from(accessTokenProjectScopes)
      .where(eq(accessTokenProjectScopes.tokenId, token.id));

    return {
      tokenId: token.id,
      allowedProjects: scopes.map((scope): ProjectAuthorizationScope => ({
        projectId: scope.projectId,
        permissions: scope.permissions.filter(isMindoryPermission) as MindoryPermission[]
      }))
    };
  }

  async markTokenUsed(tokenId: string, usedAt: Date): Promise<void> {
    await this.db.update(accessTokens).set({
      lastUsedAt: usedAt,
      updatedAt: usedAt
    }).where(eq(accessTokens.id, tokenId));
  }

  async createAccessToken(input: CreateAccessTokenInput): Promise<AccessTokenRecord> {
    const [token] = await this.db.insert(accessTokens).values({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      tokenHash: input.tokenHash,
      status: "active",
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {}
    }).returning();

    const row = firstOrThrow(token ? [token] : [], `Access token ${input.id} was not created.`);
    await this.db.insert(accessTokenProjectScopes).values({
      tokenId: row.id,
      projectId: input.projectId,
      permissions: input.permissions
    }).onConflictDoUpdate({
      target: [accessTokenProjectScopes.tokenId, accessTokenProjectScopes.projectId],
      set: {
        permissions: input.permissions
      }
    });

    return mapAccessToken(row, input.permissions);
  }

  async listAccessTokens(input: ListAccessTokensInput): Promise<AccessTokenRecord[]> {
    const rows = await this.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.projectId, input.projectId))
      .orderBy(desc(accessTokens.createdAt))
      .limit(input.limit);

    const permissionsByTokenId = await this.permissionsByTokenId(rows.map((row) => row.id), input.projectId);
    return rows.map((row) => mapAccessToken(row, permissionsByTokenId.get(row.id) ?? []));
  }

  async revokeAccessToken(projectId: string, tokenId: string): Promise<AccessTokenRecord> {
    const [row] = await this.db.update(accessTokens).set({
      status: "revoked",
      updatedAt: new Date()
    }).where(and(
      eq(accessTokens.projectId, projectId),
      eq(accessTokens.id, tokenId)
    )).returning();

    const token = firstOrThrow(row ? [row] : [], `Access token ${tokenId} was not found.`);
    return mapAccessToken(token, await this.permissionsForToken(token.id, projectId));
  }

  async rotateAccessToken(input: RotateAccessTokenInput): Promise<AccessTokenRecord> {
    const set: Partial<typeof accessTokens.$inferInsert> = {
      tokenHash: input.tokenHash,
      status: "active",
      lastUsedAt: null,
      updatedAt: new Date()
    };
    if ("expiresAt" in input) {
      set.expiresAt = input.expiresAt ?? null;
    }

    const [row] = await this.db.update(accessTokens).set(set).where(and(
      eq(accessTokens.projectId, input.projectId),
      eq(accessTokens.id, input.tokenId)
    )).returning();

    const token = firstOrThrow(row ? [row] : [], `Access token ${input.tokenId} was not found.`);
    return mapAccessToken(token, await this.permissionsForToken(token.id, input.projectId));
  }

  private async permissionsForToken(tokenId: string, projectId: string): Promise<MindoryPermission[]> {
    const scopes = await this.db
      .select()
      .from(accessTokenProjectScopes)
      .where(and(
        eq(accessTokenProjectScopes.tokenId, tokenId),
        eq(accessTokenProjectScopes.projectId, projectId)
      ));
    return scopes.flatMap((scope) => scope.permissions.filter(isMindoryPermission) as MindoryPermission[]);
  }

  private async permissionsByTokenId(tokenIds: string[], projectId: string): Promise<Map<string, MindoryPermission[]>> {
    const permissions = new Map<string, MindoryPermission[]>();
    if (tokenIds.length === 0) {
      return permissions;
    }

    const scopes = await this.db
      .select()
      .from(accessTokenProjectScopes)
      .where(and(
        inArray(accessTokenProjectScopes.tokenId, tokenIds),
        eq(accessTokenProjectScopes.projectId, projectId)
      ));

    for (const scope of scopes) {
      permissions.set(scope.tokenId, scope.permissions.filter(isMindoryPermission) as MindoryPermission[]);
    }
    return permissions;
  }
}

function mapAccessToken(row: typeof accessTokens.$inferSelect, permissions: MindoryPermission[]): AccessTokenRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    permissions,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
