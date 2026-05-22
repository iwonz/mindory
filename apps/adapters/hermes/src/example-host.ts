import { MindoryHermesAdapter } from "./adapter.js";
import type {
  HermesRuntimeAttachment,
  HermesRuntimeIdentity
} from "./runtime-contract.js";
import {
  type HermesRuntimeHookHandler,
  type HermesRuntimeHookName,
  installMindoryHermesRuntime,
  type MindoryHermesRuntimeIntegration
} from "./runtime-integration.js";

export interface MindoryHermesExampleHostOptions {
  adapter?: MindoryHermesAdapter;
}

export interface MindoryHermesExampleTurn {
  identity: HermesRuntimeIdentity;
  prompt: string;
  userText: string;
  assistantText?: string;
  query?: string;
  tokenBudget?: number;
  attachments?: HermesRuntimeAttachment[];
  metadata?: Record<string, unknown>;
}

export interface MindoryHermesExampleTurnResult {
  beforePrompt: Record<string, unknown>;
  afterResponse: Record<string, unknown>;
}

export class MindoryHermesExampleHost {
  private readonly handlers = new Map<HermesRuntimeHookName, HermesRuntimeHookHandler>();
  readonly integration: MindoryHermesRuntimeIntegration;

  constructor(options: MindoryHermesExampleHostOptions = {}) {
    this.integration = installMindoryHermesRuntime(this, {
      adapter: options.adapter ?? new MindoryHermesAdapter()
    });
  }

  registerHook(hookName: HermesRuntimeHookName, handler: HermesRuntimeHookHandler): () => void {
    this.handlers.set(hookName, handler);
    return () => {
      if (this.handlers.get(hookName) === handler) {
        this.handlers.delete(hookName);
      }
    };
  }

  registeredHookNames(): HermesRuntimeHookName[] {
    return Array.from(this.handlers.keys());
  }

  async emit(hookName: HermesRuntimeHookName, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const handler = this.handlers.get(hookName);
    if (handler === undefined) {
      throw new Error(`Mindory Hermes example host has no ${hookName} handler.`);
    }
    const result = await handler(payload);
    return isRecord(result) ? result : {};
  }

  async runTurn(input: MindoryHermesExampleTurn): Promise<MindoryHermesExampleTurnResult> {
    const beforePrompt = await this.emit("before_prompt", {
      identity: input.identity,
      prompt: input.prompt,
      userText: input.userText,
      query: input.query ?? input.userText,
      tokenBudget: input.tokenBudget
    });
    const afterResponse = await this.emit("after_response", {
      identity: input.identity,
      userText: input.userText,
      assistantText: input.assistantText,
      attachments: input.attachments ?? [],
      metadata: input.metadata ?? {}
    });
    return {
      beforePrompt,
      afterResponse
    };
  }

  async runLaterPrompt(input: {
    identity: HermesRuntimeIdentity;
    prompt: string;
    query: string;
    tokenBudget?: number;
  }): Promise<Record<string, unknown>> {
    return this.emit("before_prompt", {
      identity: input.identity,
      prompt: input.prompt,
      query: input.query,
      tokenBudget: input.tokenBudget
    });
  }

  async runCompletedTurn(input: MindoryHermesExampleTurn): Promise<Record<string, unknown>> {
    return this.emit("completed_turn", {
      identity: input.identity,
      prompt: input.prompt,
      userText: input.userText,
      assistantText: input.assistantText,
      query: input.query ?? input.userText,
      tokenBudget: input.tokenBudget,
      attachments: input.attachments ?? [],
      metadata: input.metadata ?? {}
    });
  }

  uninstall(): void {
    this.integration.uninstall();
  }
}

export function createMindoryHermesExampleHost(options: MindoryHermesExampleHostOptions = {}): MindoryHermesExampleHost {
  return new MindoryHermesExampleHost(options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
