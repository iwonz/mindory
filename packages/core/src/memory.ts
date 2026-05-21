import { randomUUID } from "node:crypto";
import type { SourceSnapshot } from "./documents.js";

export type SourceRefType = "session" | "message" | "document" | "chunk" | "memory";

export interface SourceRef {
  type: SourceRefType;
  id: string;
}

export type MemoryClaimType =
  | "semantic"
  | "episodic"
  | "preference"
  | "decision"
  | "task"
  | "artifact_reference"
  | "derived";

export type MemoryClaimStatus =
  | "candidate"
  | "active"
  | "rejected"
  | "archived";

export interface MemoryClaimRecord {
  id: string;
  projectId: string;
  type: MemoryClaimType;
  text: string;
  status: MemoryClaimStatus;
  importance: number;
  confidence: number;
  sourceRefs: SourceRef[];
  createdSource: SourceSnapshot;
  createdByPeerId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemoryClaimInput {
  id: string;
  projectId: string;
  type: MemoryClaimType;
  text: string;
  status: MemoryClaimStatus;
  importance: number;
  confidence: number;
  sourceRefs: SourceRef[];
  createdSource: SourceSnapshot;
  createdByPeerId: string | null;
  metadata: Record<string, unknown>;
}

export interface RememberMemoryInput {
  projectId: string;
  type?: MemoryClaimType;
  text: string;
  status?: MemoryClaimStatus;
  importance?: number;
  confidence?: number;
  sourceRefs: SourceRef[];
  createdSource?: SourceSnapshot;
  createdByPeerId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SearchMemoryClaimsInput {
  projectIds: string[];
  query?: string;
  statuses?: MemoryClaimStatus[];
  types?: MemoryClaimType[];
  limit: number;
}

export interface MemorySearchHit {
  memory: MemoryClaimRecord;
  score: number;
  matchReason: string | null;
}

export interface UpdateMemoryClaimStatusInput {
  projectId: string;
  memoryId: string;
  status: MemoryClaimStatus;
  metadata?: Record<string, unknown>;
}

export interface ExplainMemoryInput {
  projectId: string;
  memoryId: string;
}

export interface MemoryExplanation {
  memory: MemoryClaimRecord;
  sourceRefs: SourceRef[];
  createdSource: SourceSnapshot;
  createdByPeerId: string | null;
  metadata: Record<string, unknown>;
}

export interface MemoryRepository {
  createMemoryClaim(input: CreateMemoryClaimInput): Promise<MemoryClaimRecord>;
  getMemoryClaim(projectId: string, memoryId: string): Promise<MemoryClaimRecord>;
  searchMemoryClaims(input: SearchMemoryClaimsInput): Promise<MemorySearchHit[]>;
  updateMemoryClaimStatus(input: UpdateMemoryClaimStatusInput): Promise<MemoryClaimRecord>;
}

export interface MemoryServiceOptions {
  repository: MemoryRepository;
  idFactory?: () => string;
}

export class MemoryService {
  readonly repository: MemoryRepository;
  private readonly idFactory: () => string;

  constructor(options: MemoryServiceOptions) {
    this.repository = options.repository;
    this.idFactory = options.idFactory ?? (() => `mem_${randomUUID()}`);
  }

  async remember(input: RememberMemoryInput): Promise<MemoryClaimRecord> {
    validateSourceRefs(input.sourceRefs);

    return this.repository.createMemoryClaim({
      id: this.idFactory(),
      projectId: input.projectId,
      type: input.type ?? "semantic",
      text: input.text,
      status: input.status ?? "active",
      importance: clampScore(input.importance ?? 0.5, "importance"),
      confidence: clampScore(input.confidence ?? 0.5, "confidence"),
      sourceRefs: input.sourceRefs,
      createdSource: input.createdSource ?? { type: "api" },
      createdByPeerId: input.createdByPeerId ?? null,
      metadata: input.metadata ?? {}
    });
  }

  async get(projectId: string, memoryId: string): Promise<MemoryClaimRecord> {
    return this.repository.getMemoryClaim(projectId, memoryId);
  }

  async search(input: SearchMemoryClaimsInput): Promise<MemorySearchHit[]> {
    if (input.projectIds.length === 0) {
      throw new MemoryError("invalid_search_scope", "At least one project id is required for memory search.");
    }
    if (input.limit <= 0) {
      throw new MemoryError("invalid_limit", "Memory search limit must be greater than zero.");
    }

    return this.repository.searchMemoryClaims({
      ...input,
      statuses: input.statuses ?? ["active"]
    });
  }

  async explain(input: ExplainMemoryInput): Promise<MemoryExplanation> {
    const memory = await this.repository.getMemoryClaim(input.projectId, input.memoryId);
    return {
      memory,
      sourceRefs: memory.sourceRefs,
      createdSource: memory.createdSource,
      createdByPeerId: memory.createdByPeerId,
      metadata: memory.metadata
    };
  }

  async archive(projectId: string, memoryId: string): Promise<MemoryClaimRecord> {
    return this.repository.updateMemoryClaimStatus({
      projectId,
      memoryId,
      status: "archived"
    });
  }
}

export interface SessionSummaryContext {
  projectId: string;
  sessionId: string;
  content: string;
  sourceRefs?: SourceRef[];
  metadata?: Record<string, unknown>;
}

export interface RecentMessageContext {
  projectId: string;
  sessionId: string;
  messageId: string;
  role: string;
  content: string;
  createdAt: Date;
  sourceRefs?: SourceRef[];
  metadata?: Record<string, unknown>;
}

export interface DerivedMemoryCandidate {
  type: MemoryClaimType;
  text: string;
  importance: number;
  confidence: number;
  sourceRefs: SourceRef[];
  metadata: Record<string, unknown>;
  createdByPeerId?: string | null;
}

export interface DeriveMemoryCandidatesInput {
  projectId: string;
  sessionId: string;
  messages: RecentMessageContext[];
  limit?: number;
}

export class ConservativeMemoryDeriver {
  readonly strategy = "explicit-memory-cues-v1";
  private readonly minCharacters: number;
  private readonly maxCharacters: number;

  constructor(options: { minCharacters?: number; maxCharacters?: number } = {}) {
    this.minCharacters = options.minCharacters ?? 12;
    this.maxCharacters = options.maxCharacters ?? 280;
  }

  derive(input: DeriveMemoryCandidatesInput): DerivedMemoryCandidate[] {
    const seen = new Set<string>();
    const candidates: DerivedMemoryCandidate[] = [];
    const limit = input.limit ?? 5;

    for (const message of input.messages) {
      if (message.role !== "user") {
        continue;
      }

      for (const candidate of this.deriveFromMessage(input, message)) {
        const key = normalizeMemoryCandidateKey(candidate.text);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        candidates.push(candidate);
        if (candidates.length >= limit) {
          return candidates;
        }
      }
    }

    return candidates;
  }

  private deriveFromMessage(input: DeriveMemoryCandidatesInput, message: RecentMessageContext): DerivedMemoryCandidate[] {
    const lines = message.content.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const candidates: DerivedMemoryCandidate[] = [];

    for (const line of lines) {
      for (const pattern of EXPLICIT_MEMORY_PATTERNS) {
        const match = pattern.regex.exec(line);
        if (!match?.[1]) {
          continue;
        }

        const text = normalizeCandidateText(match[1]);
        if (!this.isAcceptableCandidate(text)) {
          continue;
        }

        candidates.push({
          type: pattern.type,
          text,
          importance: pattern.type === "preference" ? 0.65 : 0.55,
          confidence: 0.7,
          sourceRefs: [
            { type: "message", id: message.messageId },
            { type: "session", id: input.sessionId }
          ],
          metadata: {
            derivation_strategy: this.strategy,
            source_message_id: message.messageId,
            session_id: input.sessionId
          }
        });
      }
    }

    return candidates;
  }

  private isAcceptableCandidate(text: string): boolean {
    if (text.length < this.minCharacters || text.length > this.maxCharacters) {
      return false;
    }
    if (text.endsWith("?")) {
      return false;
    }
    const lowered = text.toLowerCase();
    return !UNCERTAIN_MEMORY_MARKERS.some((marker) => lowered.includes(marker));
  }
}

export interface ContextSessionRepository {
  getSessionSummary(projectIds: string[], sessionId: string): Promise<SessionSummaryContext | null>;
  listRecentMessages(projectIds: string[], sessionId: string, limit: number): Promise<RecentMessageContext[]>;
}

export interface DocumentChunkSearchInput {
  projectIds: string[];
  query: string;
  limit: number;
}

export interface DocumentChunkSearchHit {
  projectId: string;
  documentId: string;
  chunkId: string;
  content: string;
  score: number;
  sourceRefs?: SourceRef[];
  metadata?: Record<string, unknown>;
}

export interface DocumentChunkSearchRepository {
  searchDocumentChunks(input: DocumentChunkSearchInput): Promise<DocumentChunkSearchHit[]>;
}

export interface ContextBuildInclude {
  sessionSummary?: boolean;
  recentMessages?: boolean;
  memories?: boolean;
  documents?: boolean;
}

export interface BuildContextInput {
  projectIds: string[];
  sessionId?: string;
  query?: string;
  tokenBudget: number;
  include?: ContextBuildInclude;
}

export type ContextBlockType =
  | "session_summary"
  | "recent_message"
  | "memory"
  | "document_chunk";

export interface ContextBlock {
  type: ContextBlockType;
  content: string;
  sourceRefs: SourceRef[];
  score: number | null;
  metadata: Record<string, unknown>;
}

export interface ContextBuildDebug {
  searchedProjects: string[];
  memoryHits: number;
  documentHits: number;
  recentMessageHits: number;
  sessionSummaryIncluded: boolean;
  tokenBudget: number;
  usedTokens: number;
}

export interface BuildContextResult {
  blocks: ContextBlock[];
  debug: ContextBuildDebug;
}

export interface ContextBuilderOptions {
  memoryRepository?: MemoryRepository;
  sessionRepository?: ContextSessionRepository;
  documentRepository?: DocumentChunkSearchRepository;
  tokenCounter?: (content: string) => number;
  memoryLimit?: number;
  documentLimit?: number;
  recentMessageLimit?: number;
}

export class ContextBuilder {
  private readonly memoryRepository: MemoryRepository | undefined;
  private readonly sessionRepository: ContextSessionRepository | undefined;
  private readonly documentRepository: DocumentChunkSearchRepository | undefined;
  private readonly tokenCounter: (content: string) => number;
  private readonly memoryLimit: number;
  private readonly documentLimit: number;
  private readonly recentMessageLimit: number;

  constructor(options: ContextBuilderOptions = {}) {
    this.memoryRepository = options.memoryRepository;
    this.sessionRepository = options.sessionRepository;
    this.documentRepository = options.documentRepository;
    this.tokenCounter = options.tokenCounter ?? defaultContextTokenCounter;
    this.memoryLimit = options.memoryLimit ?? 8;
    this.documentLimit = options.documentLimit ?? 8;
    this.recentMessageLimit = options.recentMessageLimit ?? 12;
  }

  async build(input: BuildContextInput): Promise<BuildContextResult> {
    validateContextInput(input);

    const include = {
      sessionSummary: true,
      recentMessages: true,
      memories: true,
      documents: true,
      ...(input.include ?? {})
    };
    const blocks: ContextBlock[] = [];
    let usedTokens = 0;
    let memoryHits = 0;
    let documentHits = 0;
    let recentMessageHits = 0;
    let sessionSummaryIncluded = false;

    if (include.sessionSummary && input.sessionId && this.sessionRepository) {
      const summary = await this.sessionRepository.getSessionSummary(input.projectIds, input.sessionId);
      if (summary) {
        const added = this.appendWithinBudget(blocks, {
          type: "session_summary",
          content: summary.content,
          sourceRefs: summary.sourceRefs ?? [{ type: "session", id: summary.sessionId }],
          score: null,
          metadata: summary.metadata ?? {}
        }, input.tokenBudget, usedTokens);
        usedTokens = added.usedTokens;
        sessionSummaryIncluded = added.added;
      }
    }

    if (include.recentMessages && input.sessionId && this.sessionRepository) {
      const messages = await this.sessionRepository.listRecentMessages(input.projectIds, input.sessionId, this.recentMessageLimit);
      recentMessageHits = messages.length;
      for (const message of messages) {
        const added = this.appendWithinBudget(blocks, {
          type: "recent_message",
          content: message.content,
          sourceRefs: message.sourceRefs ?? [{ type: "message", id: message.messageId }],
          score: null,
          metadata: {
            ...(message.metadata ?? {}),
            role: message.role,
            created_at: message.createdAt.toISOString()
          }
        }, input.tokenBudget, usedTokens);
        usedTokens = added.usedTokens;
      }
    }

    if (include.memories && this.memoryRepository) {
      const hits = await this.memoryRepository.searchMemoryClaims({
        projectIds: input.projectIds,
        query: input.query ?? "",
        statuses: ["active"],
        limit: this.memoryLimit
      });
      memoryHits = hits.length;
      for (const hit of hits) {
        const added = this.appendWithinBudget(blocks, {
          type: "memory",
          content: hit.memory.text,
          sourceRefs: hit.memory.sourceRefs,
          score: hit.score,
          metadata: {
            ...hit.memory.metadata,
            memory_id: hit.memory.id,
            memory_type: hit.memory.type,
            importance: hit.memory.importance,
            confidence: hit.memory.confidence
          }
        }, input.tokenBudget, usedTokens);
        usedTokens = added.usedTokens;
      }
    }

    if (include.documents && this.documentRepository) {
      const hits = await this.documentRepository.searchDocumentChunks({
        projectIds: input.projectIds,
        query: input.query ?? "",
        limit: this.documentLimit
      });
      documentHits = hits.length;
      for (const hit of hits) {
        const added = this.appendWithinBudget(blocks, {
          type: "document_chunk",
          content: hit.content,
          sourceRefs: hit.sourceRefs ?? [{ type: "chunk", id: hit.chunkId }],
          score: hit.score,
          metadata: {
            ...(hit.metadata ?? {}),
            document_id: hit.documentId,
            chunk_id: hit.chunkId
          }
        }, input.tokenBudget, usedTokens);
        usedTokens = added.usedTokens;
      }
    }

    return {
      blocks,
      debug: {
        searchedProjects: input.projectIds,
        memoryHits,
        documentHits,
        recentMessageHits,
        sessionSummaryIncluded,
        tokenBudget: input.tokenBudget,
        usedTokens
      }
    };
  }

  private appendWithinBudget(
    blocks: ContextBlock[],
    block: ContextBlock,
    tokenBudget: number,
    usedTokens: number
  ): { added: boolean; usedTokens: number } {
    const blockTokens = this.tokenCounter(block.content);
    if (usedTokens + blockTokens > tokenBudget) {
      return { added: false, usedTokens };
    }

    blocks.push(block);
    return {
      added: true,
      usedTokens: usedTokens + blockTokens
    };
  }
}

export type MemoryErrorCode =
  | "invalid_context_scope"
  | "invalid_limit"
  | "invalid_memory_score"
  | "invalid_search_scope"
  | "invalid_source_refs";

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;

  constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
  }
}

export function defaultContextTokenCounter(content: string): number {
  const trimmed = content.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function validateSourceRefs(sourceRefs: SourceRef[]): void {
  if (sourceRefs.length === 0) {
    throw new MemoryError("invalid_source_refs", "A memory claim requires at least one source reference.");
  }

  for (const sourceRef of sourceRefs) {
    if (!sourceRef.id) {
      throw new MemoryError("invalid_source_refs", "Every source reference requires an id.");
    }
  }
}

function validateContextInput(input: BuildContextInput): void {
  if (input.projectIds.length === 0) {
    throw new MemoryError("invalid_context_scope", "At least one project id is required to build context.");
  }
  if (input.tokenBudget <= 0) {
    throw new MemoryError("invalid_limit", "Context token budget must be greater than zero.");
  }
}

function clampScore(value: number, field: "importance" | "confidence"): number {
  if (value < 0 || value > 1) {
    throw new MemoryError("invalid_memory_score", `${field} must be between 0 and 1.`);
  }
  return value;
}

const EXPLICIT_MEMORY_PATTERNS: Array<{ regex: RegExp; type: MemoryClaimType }> = [
  { regex: /^(?:please\s+)?remember(?:\s+that)?\s+(.+)$/i, type: "semantic" },
  { regex: /^note(?:\s+that)?\s+(.+)$/i, type: "semantic" },
  { regex: /^my\s+preference\s+is\s+(.+)$/i, type: "preference" },
  { regex: /^i\s+prefer\s+(.+)$/i, type: "preference" }
];

const UNCERTAIN_MEMORY_MARKERS = [
  "maybe",
  "not sure",
  "i think",
  "possibly",
  "probably"
];

function normalizeCandidateText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.!,;:]+$/g, "")
    .trim();
}

function normalizeMemoryCandidateKey(value: string): string {
  return normalizeCandidateText(value).toLowerCase();
}
