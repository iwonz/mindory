import { loadMindoryConfig, type MindoryConfig } from "@mindory/config";
import { HermesMindoryApiClient, type HermesAttachmentUploadInput, type HermesMindoryApiClientOptions, queryString } from "./http-client.js";
import { mapHermesIdentity, type HermesIdentityDefaults, type HermesIdentityInput, type MindoryHermesIdentity } from "./identity.js";

export interface MindoryHermesAdapterOptions {
  config?: MindoryConfig;
  apiClient?: HermesMindoryApiClient;
  defaults?: Partial<HermesIdentityDefaults>;
}

export interface HermesAttachmentInput extends Omit<HermesAttachmentUploadInput, "projectId"> {
  externalAttachmentId?: string;
}

export interface HermesPromptContextInput extends HermesIdentityInput {
  query?: string;
  tokenBudget?: number;
  include?: {
    sessionSummary?: boolean;
    recentMessages?: boolean;
    memories?: boolean;
    documents?: boolean;
  };
}

export interface HermesPromptContextResult {
  identity: MindoryHermesIdentity;
  context: unknown;
  promptPrefix: string;
}

export interface HermesTurnInput extends HermesIdentityInput {
  userText: string;
  assistantText?: string;
  attachments?: HermesAttachmentInput[];
  metadata?: Record<string, unknown>;
}

export interface HermesSavedTurnResult {
  identity: MindoryHermesIdentity;
  userMessage: unknown;
  assistantMessage: unknown | null;
  uploadedAttachments: unknown[];
}

export interface HermesLifecycleInput extends HermesTurnInput {
  query?: string;
  tokenBudget?: number;
  include?: HermesPromptContextInput["include"];
}

export interface HermesLifecycleResult {
  identity: MindoryHermesIdentity;
  promptContext: HermesPromptContextResult;
  savedTurn: HermesSavedTurnResult;
}

export class MindoryHermesAdapter {
  readonly api: HermesMindoryApiClient;
  readonly defaults: HermesIdentityDefaults;
  readonly contextTokenBudget: number;

  constructor(options: MindoryHermesAdapterOptions = {}) {
    const config = options.config ?? loadMindoryConfig();
    const clientOptions: HermesMindoryApiClientOptions = {
      baseUrl: config.hermes.apiUrl || config.api.publicUrl
    };
    if (config.hermes.apiToken) {
      clientOptions.token = config.hermes.apiToken;
    }
    this.api = options.apiClient ?? new HermesMindoryApiClient(clientOptions);
    this.defaults = {
      defaultProject: options.defaults?.defaultProject ?? config.hermes.defaultProject,
      defaultUserPeer: options.defaults?.defaultUserPeer ?? config.hermes.defaultUserPeer,
      defaultAgentPeer: options.defaults?.defaultAgentPeer ?? config.hermes.defaultAgentPeer
    };
    this.contextTokenBudget = config.hermes.contextTokenBudget;
  }

  mapIdentity(input: HermesIdentityInput): MindoryHermesIdentity {
    return mapHermesIdentity(input, this.defaults);
  }

  async ensureProjectPeerSession(input: HermesIdentityInput): Promise<MindoryHermesIdentity> {
    let identity = this.mapIdentity(input);

    await this.api.postJson("/v1/projects", {
      id: identity.projectId,
      name: identity.projectId,
      metadata: {
        integration: "hermes"
      }
    });

    const userPeer = await this.api.postJson("/v1/peers", {
      id: identity.userPeerId,
      projectId: identity.projectId,
      type: "human",
      name: identity.externalUserId ?? identity.userPeerId,
      externalId: identity.externalUserId,
      source: hermesSource(identity, "user")
    });
    identity = {
      ...identity,
      userPeerId: responseId(userPeer, identity.userPeerId)
    };

    const agentPeer = await this.api.postJson("/v1/peers", {
      id: identity.agentPeerId,
      projectId: identity.projectId,
      type: "agent",
      name: identity.agentId ?? identity.agentPeerId,
      externalId: identity.agentId,
      source: hermesSource(identity, "agent")
    });
    identity = {
      ...identity,
      agentPeerId: responseId(agentPeer, identity.agentPeerId)
    };

    await this.api.postJson("/v1/sessions", {
      id: identity.sessionId,
      projectId: identity.projectId,
      peerIds: [identity.userPeerId, identity.agentPeerId],
      source: hermesSource(identity, "session"),
      metadata: {
        external_session_id: identity.externalSessionId
      }
    });

    return identity;
  }

  async preparePromptContext(input: HermesPromptContextInput): Promise<HermesPromptContextResult> {
    const identity = await this.ensureProjectPeerSession(input);
    const body = {
      projectIds: [identity.projectId],
      sessionId: identity.sessionId,
      query: input.query ?? "",
      tokenBudget: input.tokenBudget ?? this.contextTokenBudget,
      include: input.include ?? {
        sessionSummary: true,
        recentMessages: true,
        memories: true,
        documents: true
      }
    };
    const context = await this.api.postJson("/v1/context/build", body);

    return {
      identity,
      context,
      promptPrefix: formatContextForPrompt(context)
    };
  }

  async handleTurn(input: HermesLifecycleInput): Promise<HermesLifecycleResult> {
    const contextInput: HermesPromptContextInput = {
      externalSessionId: input.externalSessionId,
      query: input.query ?? input.userText
    };
    if (input.projectId !== undefined) {
      contextInput.projectId = input.projectId;
    }
    if (input.externalUserId !== undefined) {
      contextInput.externalUserId = input.externalUserId;
    }
    if (input.agentId !== undefined) {
      contextInput.agentId = input.agentId;
    }
    if (input.tokenBudget !== undefined) {
      contextInput.tokenBudget = input.tokenBudget;
    }
    if (input.include !== undefined) {
      contextInput.include = input.include;
    }

    const promptContext = await this.preparePromptContext(contextInput);
    const savedTurn = await this.saveTurn(input);

    return {
      identity: promptContext.identity,
      promptContext,
      savedTurn
    };
  }

  async saveTurn(input: HermesTurnInput): Promise<HermesSavedTurnResult> {
    const identity = await this.ensureProjectPeerSession(input);
    const uploadedAttachments = input.attachments ? await this.uploadAttachments(identity, input.attachments) : [];
    const userMessage = await this.appendMessage(identity, {
      authorPeerId: identity.userPeerId,
      role: "user",
      content: input.userText,
      metadata: {
        ...(input.metadata ?? {}),
        hermes_attachments: buildAttachmentMetadata(input.attachments ?? [], uploadedAttachments),
        uploaded_attachments: uploadedAttachments
      }
    });
    const assistantMessage = input.assistantText
      ? await this.appendMessage(identity, {
        authorPeerId: identity.agentPeerId,
        role: "assistant",
        content: input.assistantText,
        metadata: input.metadata ?? {}
      })
      : null;

    return {
      identity,
      userMessage,
      assistantMessage,
      uploadedAttachments
    };
  }

  async appendMessage(identity: MindoryHermesIdentity, input: {
    authorPeerId: string;
    role: "user" | "assistant" | "system" | "tool" | "event";
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.api.postJson(`/v1/sessions/${encodeURIComponent(identity.sessionId)}/messages`, {
      projectId: identity.projectId,
      authorPeerId: input.authorPeerId,
      role: input.role,
      content: input.content,
      source: hermesSource(identity, "message"),
      metadata: input.metadata ?? {}
    });
  }

  async uploadAttachments(identity: MindoryHermesIdentity, attachments: HermesAttachmentInput[]): Promise<unknown[]> {
    const uploaded: unknown[] = [];
    for (const attachment of attachments) {
      uploaded.push(await this.api.uploadAttachment({
        projectId: identity.projectId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        content: attachment.content,
        encoding: attachment.encoding ?? "base64",
        title: attachment.title ?? attachment.filename
      }));
    }
    return uploaded;
  }
}

function responseId(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.id === "string" ? payload.id : fallback;
}

export function buildMindoryHermesAdapter(options: MindoryHermesAdapterOptions = {}): MindoryHermesAdapter {
  return new MindoryHermesAdapter(options);
}

export function formatContextForPrompt(context: unknown): string {
  if (!isRecord(context)) {
    return "";
  }

  const blocks = Array.isArray(context.blocks) ? context.blocks : [];
  if (blocks.length === 0) {
    return "";
  }

  const lines = ["Mindory context:"];
  for (const block of blocks) {
    if (!isRecord(block) || typeof block.content !== "string") {
      continue;
    }
    const type = typeof block.type === "string" ? block.type : "context";
    lines.push(`- [${type}] ${block.content}`);
  }
  return lines.join("\n");
}

export function hermesSource(identity: MindoryHermesIdentity, kind: string): Record<string, unknown> {
  return {
    type: "agent",
    integration: "hermes",
    external_id: identity.externalSessionId,
    actor_peer_id: identity.userPeerId,
    agent_peer_id: identity.agentPeerId,
    received_at: new Date().toISOString(),
    metadata: {
      kind,
      external_user_id: identity.externalUserId,
      agent_id: identity.agentId,
      used_default_user_peer: identity.usedDefaultUserPeer,
      used_default_agent_peer: identity.usedDefaultAgentPeer
    }
  };
}

export function projectQuery(projectId: string): string {
  return queryString({ projectId });
}

function buildAttachmentMetadata(attachments: HermesAttachmentInput[], uploadedAttachments: unknown[]): Array<Record<string, unknown>> {
  return attachments.map((attachment, index) => {
    const metadata: Record<string, unknown> = {
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      uploaded: uploadedAttachments[index] ?? null
    };
    if (attachment.externalAttachmentId) {
      metadata.external_attachment_id = attachment.externalAttachmentId;
    }
    if (attachment.title) {
      metadata.title = attachment.title;
    }
    return metadata;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
