import {
  type HermesAfterResponseHook,
  type HermesBeforePromptHook,
  type HermesCompletedTurnHook,
  type HermesRuntimeAttachment,
  type HermesRuntimeIdentity,
  MindoryHermesRuntimeBridge
} from "./runtime-contract.js";
import { MindoryHermesAdapter, type HermesLifecycleResult, type HermesPromptContextResult, type HermesSavedTurnResult } from "./adapter.js";

export type HermesRuntimeHookName = "before_prompt" | "after_response" | "completed_turn";
export type HermesRuntimeHookHandler = (payload: unknown) => Promise<unknown> | unknown;

export interface HermesRuntimeIntegrationOptions {
  bridge?: MindoryHermesRuntimeBridge;
  adapter?: MindoryHermesAdapter;
}

export interface HermesRuntimeHookRegistration {
  hookName: HermesRuntimeHookName;
  unregister?: () => void;
}

export interface MindoryHermesRuntimeIntegration {
  bridge: MindoryHermesRuntimeBridge;
  registrations: HermesRuntimeHookRegistration[];
  uninstall(): void;
}

export interface MindoryPromptAugmentation {
  identity: HermesPromptContextResult["identity"];
  promptPrefix: string;
  context: unknown;
}

export interface MindorySavedTurnAugmentation {
  identity: HermesSavedTurnResult["identity"];
  savedTurn: HermesSavedTurnResult;
}

export interface MindoryLifecycleAugmentation {
  identity: HermesLifecycleResult["identity"];
  promptContext: HermesPromptContextResult;
  savedTurn: HermesSavedTurnResult;
}

export function installMindoryHermesRuntime(
  runtime: unknown,
  options: HermesRuntimeIntegrationOptions = {}
): MindoryHermesRuntimeIntegration {
  const bridge = options.bridge ?? new MindoryHermesRuntimeBridge(options.adapter ?? new MindoryHermesAdapter());
  const registrations = [
    registerHermesHook(runtime, "before_prompt", async (payload) => {
      const result = await bridge.beforePrompt(toHermesBeforePromptHook(payload));
      return attachMindoryPromptContext(payload, result);
    }),
    registerHermesHook(runtime, "after_response", async (payload) => {
      const result = await bridge.afterResponse(toHermesAfterResponseHook(payload));
      return attachMindorySavedTurn(payload, result);
    }),
    registerHermesHook(runtime, "completed_turn", async (payload) => {
      const result = await bridge.handleCompletedTurn(toHermesCompletedTurnHook(payload));
      return attachMindoryLifecycleResult(payload, result);
    })
  ];

  return {
    bridge,
    registrations,
    uninstall() {
      for (const registration of [...registrations].reverse()) {
        registration.unregister?.();
      }
    }
  };
}

export function registerHermesHook(
  runtime: unknown,
  hookName: HermesRuntimeHookName,
  handler: HermesRuntimeHookHandler
): HermesRuntimeHookRegistration {
  const target = requireRecord(runtime, "Hermes runtime");
  const registered = registerViaHostMethod(target, hookName, handler)
    ?? registerViaHooksObject(target, hookName, handler);
  if (registered === undefined) {
    throw new Error(`Hermes runtime does not expose a compatible ${hookName} hook registrar.`);
  }
  return registered;
}

export function toHermesBeforePromptHook(payload: unknown): HermesBeforePromptHook {
  const record = requireRecord(payload, "before_prompt payload");
  const hook: HermesBeforePromptHook = {
    identity: identityFromPayload(record)
  };
  assignString(record, hook, "userText", ["userText", "inputText", "prompt"]);
  assignString(record, hook, "query", ["query"]);
  assignNumber(record, hook, "tokenBudget", ["tokenBudget", "contextTokenBudget"]);
  const include = record.include;
  if (isRecord(include)) {
    hook.include = include as HermesBeforePromptHook["include"];
  }
  return hook;
}

export function toHermesAfterResponseHook(payload: unknown): HermesAfterResponseHook {
  const record = requireRecord(payload, "after_response payload");
  const hook: HermesAfterResponseHook = {
    identity: identityFromPayload(record),
    userText: requiredString(record, ["userText", "inputText", "prompt"], "userText")
  };
  assignString(record, hook, "assistantText", ["assistantText", "responseText", "outputText"]);
  const attachments = attachmentsFromPayload(record.attachments);
  if (attachments.length > 0) {
    hook.attachments = attachments;
  }
  const metadata = record.metadata;
  if (isRecord(metadata)) {
    hook.metadata = metadata;
  }
  return hook;
}

export function toHermesCompletedTurnHook(payload: unknown): HermesCompletedTurnHook {
  const record = requireRecord(payload, "completed_turn payload");
  const afterResponse = toHermesAfterResponseHook(record);
  const hook: HermesCompletedTurnHook = {
    ...afterResponse
  };
  assignString(record, hook, "query", ["query"]);
  assignNumber(record, hook, "tokenBudget", ["tokenBudget", "contextTokenBudget"]);
  const include = record.include;
  if (isRecord(include)) {
    hook.include = include as HermesCompletedTurnHook["include"];
  }
  return hook;
}

export function attachMindoryPromptContext(payload: unknown, result: HermesPromptContextResult): Record<string, unknown> {
  const output = clonePayloadRecord(payload);
  output.mindory = {
    ...mindoryRecord(output),
    promptContext: {
      identity: result.identity,
      promptPrefix: result.promptPrefix,
      context: result.context
    } satisfies MindoryPromptAugmentation
  };

  if (result.promptPrefix.trim().length === 0) {
    return output;
  }

  const promptPrefix = result.promptPrefix;
  if (typeof output.prompt === "string") {
    output.prompt = prependOnce(output.prompt, promptPrefix);
  } else if (typeof output.systemPrompt === "string") {
    output.systemPrompt = prependOnce(output.systemPrompt, promptPrefix);
  } else if (Array.isArray(output.messages)) {
    output.messages = [
      {
        role: "system",
        content: promptPrefix,
        metadata: {
          integration: "mindory",
          source: "hermes"
        }
      },
      ...output.messages
    ];
  } else {
    output.promptPrefix = promptPrefix;
  }

  const contextBlock = {
    source: "mindory",
    type: "context",
    content: promptPrefix,
    raw: result.context
  };
  output.context = Array.isArray(output.context) ? [...output.context, contextBlock] : [contextBlock];
  return output;
}

export function attachMindorySavedTurn(payload: unknown, result: HermesSavedTurnResult): Record<string, unknown> {
  const output = clonePayloadRecord(payload);
  output.mindory = {
    ...mindoryRecord(output),
    savedTurn: {
      identity: result.identity,
      savedTurn: result
    } satisfies MindorySavedTurnAugmentation
  };
  return output;
}

export function attachMindoryLifecycleResult(payload: unknown, result: HermesLifecycleResult): Record<string, unknown> {
  const output = clonePayloadRecord(payload);
  output.mindory = {
    ...mindoryRecord(output),
    lifecycle: {
      identity: result.identity,
      promptContext: result.promptContext,
      savedTurn: result.savedTurn
    } satisfies MindoryLifecycleAugmentation
  };
  if (result.promptContext.promptPrefix.trim().length > 0 && typeof output.prompt === "string") {
    output.prompt = prependOnce(output.prompt, result.promptContext.promptPrefix);
  }
  return output;
}

function registerViaHostMethod(
  target: Record<string, unknown>,
  hookName: HermesRuntimeHookName,
  handler: HermesRuntimeHookHandler
): HermesRuntimeHookRegistration | undefined {
  for (const methodName of ["registerHook", "addHook", "on"]) {
    const method = target[methodName];
    if (typeof method === "function") {
      const unregister = unregisterFromResult(method.call(target, hookName, handler));
      return registration(hookName, unregister);
    }
  }
  return undefined;
}

function registerViaHooksObject(
  target: Record<string, unknown>,
  hookName: HermesRuntimeHookName,
  handler: HermesRuntimeHookHandler
): HermesRuntimeHookRegistration | undefined {
  const hooks = target.hooks;
  if (!isRecord(hooks)) {
    return undefined;
  }
  for (const hookKey of hookKeys(hookName)) {
    const slot = hooks[hookKey];
    if (typeof slot === "function") {
      return registration(hookName, unregisterFromResult(slot.call(hooks, handler)));
    }
    if (!isRecord(slot)) {
      continue;
    }
    for (const methodName of ["use", "register", "tap", "on"]) {
      const method = slot[methodName];
      if (typeof method === "function") {
        return registration(hookName, unregisterFromResult(method.call(slot, handler)));
      }
    }
  }
  return undefined;
}

function registration(hookName: HermesRuntimeHookName, unregister?: () => void): HermesRuntimeHookRegistration {
  return unregister === undefined ? { hookName } : { hookName, unregister };
}

function unregisterFromResult(result: unknown): (() => void) | undefined {
  if (typeof result === "function") {
    return () => {
      result();
    };
  }
  if (isRecord(result)) {
    for (const methodName of ["unregister", "dispose", "off"]) {
      const method = result[methodName];
      if (typeof method === "function") {
        return () => method.call(result);
      }
    }
  }
  return undefined;
}

function hookKeys(hookName: HermesRuntimeHookName): string[] {
  if (hookName === "before_prompt") {
    return ["before_prompt", "beforePrompt"];
  }
  if (hookName === "after_response") {
    return ["after_response", "afterResponse"];
  }
  return ["completed_turn", "completedTurn"];
}

function identityFromPayload(record: Record<string, unknown>): HermesRuntimeIdentity {
  const identityRecord = isRecord(record.identity) ? record.identity : record;
  const sessionId = actorId(identityRecord.session) ?? stringValue(identityRecord.sessionId) ?? stringValue(identityRecord.externalSessionId);
  if (sessionId === undefined || sessionId.trim().length === 0) {
    throw new Error("Hermes runtime payload must include identity.session.id or sessionId.");
  }

  const identity: HermesRuntimeIdentity = {
    session: { id: sessionId }
  };
  const projectId = stringValue(identityRecord.projectId);
  if (projectId !== undefined) {
    identity.projectId = projectId;
  }
  const userId = actorId(identityRecord.user) ?? stringValue(identityRecord.userId) ?? stringValue(identityRecord.externalUserId);
  if (userId !== undefined) {
    identity.user = { id: userId };
  }
  const agentId = actorId(identityRecord.agent) ?? stringValue(identityRecord.agentId);
  if (agentId !== undefined) {
    identity.agent = { id: agentId };
  }
  return identity;
}

function actorId(value: unknown): string | undefined {
  if (isRecord(value)) {
    return stringValue(value.id);
  }
  return stringValue(value);
}

function attachmentsFromPayload(value: unknown): HermesRuntimeAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: HermesRuntimeAttachment[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const filename = stringValue(item.filename);
    const mimeType = stringValue(item.mimeType) ?? stringValue(item.mime_type);
    const content = stringValue(item.content);
    if (filename === undefined || mimeType === undefined || content === undefined) {
      continue;
    }
    const attachment: HermesRuntimeAttachment = {
      filename,
      mimeType,
      content
    };
    const id = stringValue(item.id) ?? stringValue(item.externalAttachmentId);
    if (id !== undefined) {
      attachment.id = id;
    }
    const encoding = stringValue(item.encoding);
    if (encoding === "utf8" || encoding === "base64") {
      attachment.encoding = encoding;
    }
    const title = stringValue(item.title);
    if (title !== undefined) {
      attachment.title = title;
    }
    attachments.push(attachment);
  }
  return attachments;
}

function assignString(source: Record<string, unknown>, target: object, key: string, sourceKeys: string[]): void {
  const value = optionalString(source, sourceKeys);
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
}

function assignNumber(source: Record<string, unknown>, target: object, key: string, sourceKeys: string[]): void {
  const value = optionalNumber(source, sourceKeys);
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
}

function requiredString(source: Record<string, unknown>, sourceKeys: string[], label: string): string {
  const value = optionalString(source, sourceKeys);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Hermes runtime payload must include ${label}.`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, sourceKeys: string[]): string | undefined {
  for (const key of sourceKeys) {
    const value = stringValue(source[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function optionalNumber(source: Record<string, unknown>, sourceKeys: string[]): number | undefined {
  for (const key of sourceKeys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function prependOnce(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text : `${prefix}\n\n${text}`;
}

function clonePayloadRecord(payload: unknown): Record<string, unknown> {
  return isRecord(payload) ? { ...payload } : { payload };
}

function mindoryRecord(output: Record<string, unknown>): Record<string, unknown> {
  return isRecord(output.mindory) ? output.mindory : {};
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
