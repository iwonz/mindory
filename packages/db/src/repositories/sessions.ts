import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  AppendMessageInput,
  CreateSessionInput,
  MessageRecord,
  SessionRecord,
  SessionRepository,
  UpdateSessionSummaryInput
} from "@mindory/core/sessions";
import type { RecentMessageContext, SessionSummaryContext } from "@mindory/core/memory";
import { messages, sessionPeers, sessions } from "../schema.js";
import { firstOrThrow, type MindoryDatabase } from "./types.js";

export class DbSessionRepository implements SessionRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const updateValues: Partial<typeof sessions.$inferInsert> = {
      title: input.title ?? null,
      status: input.status ?? "active",
      source: input.source ?? { type: "api" },
      metadata: input.metadata ?? {},
      updatedAt: new Date()
    };
    if (input.summary !== undefined) {
      updateValues.summary = input.summary;
    }

    const [row] = await this.db.insert(sessions).values({
      id: input.id,
      projectId: input.projectId,
      title: input.title ?? null,
      status: input.status ?? "active",
      source: input.source ?? { type: "api" },
      summary: input.summary ?? null,
      metadata: input.metadata ?? {}
    }).onConflictDoUpdate({
      target: sessions.id,
      set: updateValues
    }).returning();

    if (input.peerIds && input.peerIds.length > 0) {
      await this.db.insert(sessionPeers).values(input.peerIds.map((peerId) => ({
        projectId: input.projectId,
        sessionId: input.id,
        peerId
      }))).onConflictDoNothing();
    }

    return mapSession(firstOrThrow(row ? [row] : [], `Session ${input.id} was not created.`));
  }

  async getSession(projectId: string, sessionId: string): Promise<SessionRecord> {
    const rows = await this.db.select().from(sessions).where(and(eq(sessions.projectId, projectId), eq(sessions.id, sessionId))).limit(1);
    return mapSession(firstOrThrow(rows, `Session ${sessionId} was not found.`));
  }

  async listSessions(projectId: string, limit: number): Promise<SessionRecord[]> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.projectId, projectId)).orderBy(desc(sessions.updatedAt)).limit(limit);
    return rows.map(mapSession);
  }

  async appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    const [row] = await this.db.insert(messages).values({
      id: input.id,
      projectId: input.projectId,
      sessionId: input.sessionId,
      authorPeerId: input.authorPeerId,
      role: input.role,
      content: input.content,
      source: input.source ?? { type: "api" },
      metadata: input.metadata ?? {}
    }).returning();

    await this.db.update(sessions).set({
      updatedAt: new Date()
    }).where(and(eq(sessions.projectId, input.projectId), eq(sessions.id, input.sessionId)));

    return mapMessage(firstOrThrow(row ? [row] : [], `Message ${input.id} was not appended.`));
  }

  async listMessages(projectId: string, sessionId: string, limit: number): Promise<MessageRecord[]> {
    const rows = await this.db.select().from(messages).where(
      and(eq(messages.projectId, projectId), eq(messages.sessionId, sessionId))
    ).orderBy(desc(messages.createdAt)).limit(limit);
    return rows.map(mapMessage).reverse();
  }

  async updateSessionSummary(input: UpdateSessionSummaryInput): Promise<SessionRecord> {
    const update: {
      summary: string;
      updatedAt: Date;
      metadata?: Record<string, unknown>;
    } = {
      summary: input.summary,
      updatedAt: new Date()
    };
    if (input.metadata !== undefined) {
      update.metadata = input.metadata;
    }

    const [row] = await this.db.update(sessions).set(update).where(
      and(eq(sessions.projectId, input.projectId), eq(sessions.id, input.sessionId))
    ).returning();

    return mapSession(firstOrThrow(row ? [row] : [], `Session ${input.sessionId} was not updated.`));
  }

  async getSessionSummary(projectIds: string[], sessionId: string): Promise<SessionSummaryContext | null> {
    const rows = await this.db.select().from(sessions).where(
      and(inArray(sessions.projectId, projectIds), eq(sessions.id, sessionId))
    ).limit(1);
    const row = rows[0];
    if (!row || !row.summary) {
      return null;
    }

    return {
      projectId: row.projectId,
      sessionId: row.id,
      content: row.summary,
      sourceRefs: [{ type: "session", id: row.id }],
      metadata: row.metadata
    };
  }

  async listRecentMessages(projectIds: string[], sessionId: string, limit: number): Promise<RecentMessageContext[]> {
    const rows = await this.db.select().from(messages).where(
      and(inArray(messages.projectId, projectIds), eq(messages.sessionId, sessionId))
    ).orderBy(desc(messages.createdAt)).limit(limit);

    return rows.reverse().map((row) => ({
      projectId: row.projectId,
      sessionId: row.sessionId,
      messageId: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
      sourceRefs: [{ type: "message", id: row.id }],
      metadata: row.metadata
    }));
  }
}

function mapSession(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    status: row.status,
    source: row.source,
    summary: row.summary,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapMessage(row: typeof messages.$inferSelect): MessageRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    authorPeerId: row.authorPeerId,
    role: row.role,
    content: row.content,
    source: row.source,
    metadata: row.metadata,
    createdAt: row.createdAt
  };
}
