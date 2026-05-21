import { eq } from "drizzle-orm";
import type { AccessTokenRepository, MindoryPermission, ProjectAuthorizationScope, VerifiedAccessToken } from "@mindory/auth";
import { isMindoryPermission } from "@mindory/auth";
import { accessTokenProjectScopes, accessTokens } from "../schema.js";
import type { MindoryDatabase } from "./types.js";

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
}
