import { type HermesLifecycleInput, type HermesPromptContextInput, type HermesSavedTurnResult, type HermesTurnInput, MindoryHermesAdapter } from "./adapter.js";
import type { HermesIdentityInput, MindoryHermesIdentity } from "./identity.js";
import { buildMindoryHermesTools, type MindoryHermesTools } from "./tools.js";

export interface HermesRuntimeIdentity {
  projectId?: string;
  user?: HermesRuntimeActor;
  agent?: HermesRuntimeActor;
  session: HermesRuntimeSession;
}

export interface HermesRuntimeActor {
  id: string;
}

export interface HermesRuntimeSession {
  id: string;
}

export interface HermesRuntimeAttachment {
  id?: string;
  filename: string;
  mimeType: string;
  content: string;
  encoding?: "utf8" | "base64";
  title?: string;
}

export interface HermesBeforePromptHook {
  identity: HermesRuntimeIdentity;
  userText?: string;
  query?: string;
  tokenBudget?: number;
  include?: HermesPromptContextInput["include"];
}

export interface HermesAfterResponseHook {
  identity: HermesRuntimeIdentity;
  userText: string;
  assistantText?: string;
  attachments?: HermesRuntimeAttachment[];
  metadata?: Record<string, unknown>;
}

export interface HermesCompletedTurnHook extends HermesAfterResponseHook {
  query?: string;
  tokenBudget?: number;
  include?: HermesPromptContextInput["include"];
}

export class MindoryHermesRuntimeBridge {
  readonly adapter: MindoryHermesAdapter;

  constructor(adapter: MindoryHermesAdapter = new MindoryHermesAdapter()) {
    this.adapter = adapter;
  }

  mapIdentity(identity: HermesRuntimeIdentity): MindoryHermesIdentity {
    return this.adapter.mapIdentity(toIdentityInput(identity));
  }

  beforePrompt(hook: HermesBeforePromptHook): ReturnType<MindoryHermesAdapter["preparePromptContext"]> {
    const input: HermesPromptContextInput = {
      ...toIdentityInput(hook.identity),
      query: hook.query ?? hook.userText ?? ""
    };
    if (hook.tokenBudget !== undefined) {
      input.tokenBudget = hook.tokenBudget;
    }
    if (hook.include !== undefined) {
      input.include = hook.include;
    }

    return this.adapter.preparePromptContext(input);
  }

  afterResponse(hook: HermesAfterResponseHook): Promise<HermesSavedTurnResult> {
    const input: HermesTurnInput = {
      ...toIdentityInput(hook.identity),
      userText: hook.userText
    };
    if (hook.assistantText !== undefined) {
      input.assistantText = hook.assistantText;
    }
    if (hook.attachments !== undefined) {
      input.attachments = hook.attachments.map(toAdapterAttachment);
    }
    if (hook.metadata !== undefined) {
      input.metadata = hook.metadata;
    }

    return this.adapter.saveTurn(input);
  }

  handleCompletedTurn(hook: HermesCompletedTurnHook): ReturnType<MindoryHermesAdapter["handleTurn"]> {
    const input: HermesLifecycleInput = {
      ...toIdentityInput(hook.identity),
      userText: hook.userText
    };
    if (hook.assistantText !== undefined) {
      input.assistantText = hook.assistantText;
    }
    if (hook.attachments !== undefined) {
      input.attachments = hook.attachments.map(toAdapterAttachment);
    }
    if (hook.metadata !== undefined) {
      input.metadata = hook.metadata;
    }
    if (hook.query !== undefined) {
      input.query = hook.query;
    }
    if (hook.tokenBudget !== undefined) {
      input.tokenBudget = hook.tokenBudget;
    }
    if (hook.include !== undefined) {
      input.include = hook.include;
    }

    return this.adapter.handleTurn(input);
  }

  tools(): MindoryHermesTools {
    return buildMindoryHermesTools(this.adapter);
  }
}

export function toIdentityInput(identity: HermesRuntimeIdentity): HermesIdentityInput {
  const input: HermesIdentityInput = {
    externalSessionId: identity.session.id
  };
  if (identity.projectId !== undefined) {
    input.projectId = identity.projectId;
  }
  if (identity.user?.id !== undefined) {
    input.externalUserId = identity.user.id;
  }
  if (identity.agent?.id !== undefined) {
    input.agentId = identity.agent.id;
  }
  return input;
}

function toAdapterAttachment(attachment: HermesRuntimeAttachment): NonNullable<HermesTurnInput["attachments"]>[number] {
  const input: NonNullable<HermesTurnInput["attachments"]>[number] = {
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    content: attachment.content
  };
  if (attachment.id !== undefined) {
    input.externalAttachmentId = attachment.id;
  }
  if (attachment.encoding !== undefined) {
    input.encoding = attachment.encoding;
  }
  if (attachment.title !== undefined) {
    input.title = attachment.title;
  }
  return input;
}
