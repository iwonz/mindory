import type { SourceSnapshot } from "./documents.js";
import type { ContextSessionRepository, RecentMessageContext, SessionSummaryContext } from "./memory.js";

export type SessionStatus =
  | "active"
  | "idle"
  | "archived";

export type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "event";

export interface SessionRecord {
  id: string;
  projectId: string;
  title: string | null;
  status: SessionStatus;
  source: SourceSnapshot;
  summary: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionInput {
  id: string;
  projectId: string;
  title?: string | null;
  status?: SessionStatus;
  peerIds?: string[];
  source?: SourceSnapshot;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MessageRecord {
  id: string;
  projectId: string;
  sessionId: string;
  authorPeerId: string;
  role: MessageRole;
  content: string;
  source: SourceSnapshot;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AppendMessageInput {
  id: string;
  projectId: string;
  sessionId: string;
  authorPeerId: string;
  role: MessageRole;
  content: string;
  source?: SourceSnapshot;
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionSummaryInput {
  projectId: string;
  sessionId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface SessionRepository extends ContextSessionRepository {
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  getSession(projectId: string, sessionId: string): Promise<SessionRecord>;
  listSessions(projectId: string, limit: number): Promise<SessionRecord[]>;
  appendMessage(input: AppendMessageInput): Promise<MessageRecord>;
  listMessages(projectId: string, sessionId: string, limit: number): Promise<MessageRecord[]>;
  updateSessionSummary(input: UpdateSessionSummaryInput): Promise<SessionRecord>;
  getSessionSummary(projectIds: string[], sessionId: string): Promise<SessionSummaryContext | null>;
  listRecentMessages(projectIds: string[], sessionId: string, limit: number): Promise<RecentMessageContext[]>;
}

export type SessionErrorCode =
  | "message_not_found"
  | "session_not_found";

export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}
