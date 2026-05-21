import { createHash, randomUUID } from "node:crypto";
import {
  ConservativeMemoryDeriver,
  type DerivedMemoryCandidate,
  type MemoryRepository,
  type RecentMessageContext
} from "@mindory/core/memory";
import type { ProcessingJobProcessor, ProcessingJobProcessorContext } from "@mindory/core/queue";
import type { MessageRecord, SessionRecord, SessionRepository } from "@mindory/core/sessions";

export interface MemoryRuntimeProcessorOptions {
  sessions: SessionRepository;
  memories: MemoryRepository;
  deriver?: ConservativeMemoryDeriver;
  idFactory?: () => string;
  summaryMessageLimit?: number;
  derivationMessageLimit?: number;
  derivationCandidateLimit?: number;
}

export function buildMemoryRuntimeProcessors(options: MemoryRuntimeProcessorOptions): ProcessingJobProcessor[] {
  return [
    new SessionSummaryProcessor({
      sessions: options.sessions,
      messageLimit: options.summaryMessageLimit ?? 40
    }),
    new MemoryDerivationProcessor({
      sessions: options.sessions,
      memories: options.memories,
      deriver: options.deriver ?? new ConservativeMemoryDeriver(),
      idFactory: options.idFactory ?? (() => `mem_${randomUUID()}`),
      messageLimit: options.derivationMessageLimit ?? 40,
      candidateLimit: options.derivationCandidateLimit ?? 5
    })
  ];
}

class SessionSummaryProcessor implements ProcessingJobProcessor {
  readonly type = "session.summarize" as const;
  readonly processorVersion = "session-summary-v1";
  private readonly sessions: SessionRepository;
  private readonly messageLimit: number;

  constructor(options: { sessions: SessionRepository; messageLimit: number }) {
    this.sessions = options.sessions;
    this.messageLimit = options.messageLimit;
  }

  async process(context: ProcessingJobProcessorContext): Promise<void> {
    const session = await this.sessions.getSession(context.payload.projectId, context.payload.targetId);
    const messages = await this.sessions.listMessages(session.projectId, session.id, this.messageLimit);
    const summary = buildExtractiveSessionSummary(session, messages);

    await this.sessions.updateSessionSummary({
      projectId: session.projectId,
      sessionId: session.id,
      summary,
      metadata: {
        ...session.metadata,
        summary: {
          strategy: this.processorVersion,
          source_message_ids: messages.map((message) => message.id),
          updated_by_job_id: context.payload.jobId,
          updated_at: new Date().toISOString()
        }
      }
    });
  }
}

class MemoryDerivationProcessor implements ProcessingJobProcessor {
  readonly type = "memory.derive" as const;
  readonly processorVersion = "memory-derive-conservative-v1";
  private readonly sessions: SessionRepository;
  private readonly memories: MemoryRepository;
  private readonly deriver: ConservativeMemoryDeriver;
  private readonly idFactory: () => string;
  private readonly messageLimit: number;
  private readonly candidateLimit: number;

  constructor(options: {
    sessions: SessionRepository;
    memories: MemoryRepository;
    deriver: ConservativeMemoryDeriver;
    idFactory: () => string;
    messageLimit: number;
    candidateLimit: number;
  }) {
    this.sessions = options.sessions;
    this.memories = options.memories;
    this.deriver = options.deriver;
    this.idFactory = options.idFactory;
    this.messageLimit = options.messageLimit;
    this.candidateLimit = options.candidateLimit;
  }

  async process(context: ProcessingJobProcessorContext): Promise<void> {
    const session = await this.sessions.getSession(context.payload.projectId, context.payload.targetId);
    const messages = await this.sessions.listMessages(session.projectId, session.id, this.messageLimit);
    const candidates = this.deriver.derive({
      projectId: session.projectId,
      sessionId: session.id,
      messages: messages.map(toRecentMessageContext),
      limit: this.candidateLimit
    });

    for (const candidate of candidates) {
      if (candidate.sourceRefs.length === 0) {
        continue;
      }

      await this.memories.createMemoryClaim({
        id: deterministicCandidateId(session.projectId, session.id, candidate) ?? this.idFactory(),
        projectId: session.projectId,
        type: candidate.type,
        text: candidate.text,
        status: "candidate",
        importance: candidate.importance,
        confidence: candidate.confidence,
        sourceRefs: candidate.sourceRefs,
        createdSource: {
          type: "agent",
          integration: "mindory-memory-derivation",
          external_id: context.payload.jobId,
          received_at: new Date().toISOString()
        },
        createdByPeerId: candidate.createdByPeerId ?? null,
        metadata: {
          ...candidate.metadata,
          derivation_job_id: context.payload.jobId,
          processor_version: this.processorVersion
        }
      });
    }
  }
}

function buildExtractiveSessionSummary(session: SessionRecord, messages: MessageRecord[]): string {
  if (messages.length === 0) {
    return session.summary ?? "No messages recorded yet.";
  }

  const recentMessages = messages.slice(-12);
  const lines = recentMessages.map((message) => {
    const content = truncate(singleLine(message.content), 220);
    return `${message.role}: ${content}`;
  });

  return [
    session.title ? `Title: ${session.title}` : `Session: ${session.id}`,
    `Recent turn count: ${messages.length}`,
    ...lines
  ].join("\n");
}

function toRecentMessageContext(message: MessageRecord): RecentMessageContext {
  return {
    projectId: message.projectId,
    sessionId: message.sessionId,
    messageId: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    sourceRefs: [{ type: "message", id: message.id }],
    metadata: {
      ...message.metadata,
      author_peer_id: message.authorPeerId
    }
  };
}

function deterministicCandidateId(projectId: string, sessionId: string, candidate: DerivedMemoryCandidate): string | null {
  if (candidate.sourceRefs.length === 0) {
    return null;
  }

  const hash = createHash("sha256")
    .update(projectId)
    .update("\0")
    .update(sessionId)
    .update("\0")
    .update(candidate.text)
    .update("\0")
    .update(candidate.sourceRefs.map((sourceRef) => `${sourceRef.type}:${sourceRef.id}`).join("|"))
    .digest("hex")
    .slice(0, 32);
  return `mem_${hash}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
