import {
  LLM_ROLE_SUPPORT_CATALOG,
  llmRoleProviderSupportStatus as catalogLlmRoleProviderSupportStatus,
  llmRoleSupportStatus as catalogLlmRoleSupportStatus,
  type ConfigSupportStatus,
  type LlmProvider,
  type LlmRoleCatalogKey,
  type MindoryConfig
} from "@mindory/config";
import type { EmbeddingResult, EmbeddingsProvider, EmbedTextsInput } from "@mindory/core/processing";
import { OpenAICompatibleEmbeddingsProvider, type OpenAICompatibleEmbeddingsOptions } from "@mindory/embeddings-openai-compatible";
import { OllamaEmbeddingsProvider, type OllamaEmbeddingsOptions } from "@mindory/embeddings-ollama";

export type LlmRole =
  | "chat"
  | "text-embedding"
  | "image-embedding"
  | "ocr"
  | "asr"
  | "vision-captioning"
  | "face-detection"
  | "face-recognition"
  | "image-generation"
  | "audio-generation";

export type LlmOperationStatus = "success" | "disabled" | "failed";
export type LlmRoleSupportStatus = Extract<ConfigSupportStatus, "supported" | "experimental" | "future">;

export interface LlmRoleDescriptor {
  role: LlmRole;
  enabled: boolean;
  provider: LlmProvider;
  model: string;
  required: boolean;
  timeoutMs: number;
  concurrency: number;
  dimensions?: number | null;
}

export interface LlmRoleState {
  enabled: boolean;
  provider: LlmProvider;
  model: string;
  required: boolean;
}

export interface LlmProviderDescriptor {
  provider: Exclude<LlmProvider, "disabled">;
  baseUrl?: string;
  authMode?: "none" | "api-key" | "oauth-bearer";
  commandTimeoutMs?: number;
}

export interface LlmRoleSupportDescriptor {
  role: LlmRole;
  key: LlmRoleCatalogKey;
  status: ConfigSupportStatus;
  defaultProvider: LlmProvider;
  defaultModel: string;
  providerSupport: Record<LlmProvider, ConfigSupportStatus>;
}

export interface LlmOperationUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  embeddingDimensions?: number;
  imageCount?: number;
  audioSeconds?: number;
  durationMs?: number;
}

export interface LlmOperationRefs {
  projectId?: string;
  documentId?: string;
  jobId?: string;
  sessionId?: string;
  messageId?: string;
  processingRunId?: string;
}

export interface LlmOperationAudit {
  role: LlmRole;
  provider: LlmProvider;
  model: string;
  status: LlmOperationStatus;
  durationMs: number;
  usage: LlmOperationUsage;
  refs: LlmOperationRefs;
  errorCode?: string;
  errorMessage?: string;
}

export type LlmAuditSink = (audit: LlmOperationAudit) => void;

export interface LlmOperationResult<TValue> {
  status: LlmOperationStatus;
  value?: TValue;
  audit: LlmOperationAudit;
}

export interface LlmProviderCallContext {
  role: LlmRoleDescriptor;
  refs?: LlmOperationRefs;
  signal?: AbortSignal;
}

export interface LlmChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface LlmChatInput {
  messages: LlmChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmChatOutput {
  text: string;
  usage?: LlmOperationUsage;
}

export interface LlmTextEmbeddingProvider {
  embedTexts(input: { texts: string[] }, context: LlmProviderCallContext): Promise<LlmOperationResult<number[][]>>;
}

export interface LlmChatProvider {
  generateChat(input: LlmChatInput, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmChatOutput>>;
}

export interface LlmOcrProvider {
  recognizeText(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ text: string }>>;
}

export interface LlmAsrProvider {
  transcribe(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ text: string }>>;
}

export interface LlmVisionProvider {
  captionImage(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ caption: string }>>;
}

export interface LlmFaceProvider {
  detectFaces(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ count: number }>>;
  recognizeFaces(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ identityIds: string[] }>>;
}

export interface LlmGenerationProvider {
  generateImage(input: { prompt: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ bytes: Uint8Array; mimeType: string }>>;
  generateAudio(input: { prompt: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ bytes: Uint8Array; mimeType: string }>>;
}

export interface MindoryLlmOptions {
  fetchImpl?: typeof fetch;
  auditSink?: LlmAuditSink;
  operationRefs?: LlmOperationRefs;
}

export interface MindoryLlm {
  registry: LlmRoleRegistry;
  roleSupport: readonly LlmRoleSupportDescriptor[];
  providers: LlmProviderDescriptor[];
  textEmbeddings?: EmbeddingsProvider;
  disabledResult<TValue>(role: LlmRole, refs?: LlmOperationRefs): LlmOperationResult<TValue>;
}

export const LLM_ROLE_PROVIDER_SUPPORT_MATRIX: readonly LlmRoleSupportDescriptor[] = LLM_ROLE_SUPPORT_CATALOG.map((entry) => ({
  role: catalogKeyToLlmRole(entry.key),
  key: entry.key,
  status: entry.status,
  defaultProvider: entry.defaultProvider,
  defaultModel: entry.defaultModel,
  providerSupport: entry.providerSupport
}));

export class LlmRoleRegistry {
  private readonly roles: Map<LlmRole, LlmRoleDescriptor>;

  constructor(roles: LlmRoleDescriptor[]) {
    this.roles = new Map(roles.map((role) => [role.role, role]));
  }

  list(): LlmRoleDescriptor[] {
    return Array.from(this.roles.values());
  }

  get(role: LlmRole): LlmRoleDescriptor | undefined {
    return this.roles.get(role);
  }

  isEnabled(role: LlmRole): boolean {
    return this.roles.get(role)?.enabled ?? false;
  }

  require(role: LlmRole): LlmRoleDescriptor {
    const descriptor = this.get(role);
    if (descriptor === undefined) {
      throw new Error(`LLM role is not registered: ${role}.`);
    }
    return descriptor;
  }
}

export function buildMindoryLlm(
  config: MindoryConfig,
  options: MindoryLlmOptions = {}
): MindoryLlm {
  const registry = new LlmRoleRegistry(llmRoleDescriptors(config));
  const runtime: MindoryLlm = {
    registry,
    roleSupport: LLM_ROLE_PROVIDER_SUPPORT_MATRIX,
    providers: llmProviders(config),
    disabledResult: (role, refs) => disabledLlmOperationResult(registry.require(role), refs, options.auditSink)
  };
  const textEmbeddings = buildMindoryTextEmbeddingsProvider(config, options);
  if (textEmbeddings !== undefined) {
    runtime.textEmbeddings = textEmbeddings;
  }
  return runtime;
}

export function llmRoleState(
  runtime: MindoryLlm | LlmRoleRegistry,
  role: LlmRole
): LlmRoleState {
  const registry = runtime instanceof LlmRoleRegistry ? runtime : runtime.registry;
  const descriptor = registry.require(role);
  return {
    enabled: descriptor.enabled,
    provider: descriptor.provider,
    model: descriptor.model,
    required: descriptor.required
  };
}

export function llmRoleSupportStatus(role: LlmRole): ConfigSupportStatus {
  return catalogLlmRoleSupportStatus(llmRoleToCatalogKey(role));
}

export function llmRoleProviderSupportStatus(role: LlmRole, provider: LlmProvider): ConfigSupportStatus {
  return catalogLlmRoleProviderSupportStatus(llmRoleToCatalogKey(role), provider);
}

export function buildMindoryTextEmbeddingsProvider(
  config: MindoryConfig,
  options: MindoryLlmOptions = {}
): EmbeddingsProvider | undefined {
  const textEmbedding = config.llm.textEmbedding;
  if (!textEmbedding.enabled || textEmbedding.provider === "disabled") {
    return undefined;
  }

  if (textEmbedding.provider === "openai-compatible") {
    const providerOptions: OpenAICompatibleEmbeddingsOptions = {
      baseUrl: config.llm.openaiCompatible.baseUrl,
      model: textEmbedding.model
    };
    const bearerToken = openAiCompatibleBearerToken(config);
    if (bearerToken !== undefined) {
      providerOptions.bearerToken = bearerToken;
    }
    if (textEmbedding.dimensions !== null) {
      providerOptions.dimensions = textEmbedding.dimensions;
    }
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return auditedTextEmbeddingsProvider(
      new OpenAICompatibleEmbeddingsProvider(providerOptions),
      descriptor("text-embedding", textEmbedding),
      options
    );
  }

  if (textEmbedding.provider === "ollama") {
    const providerOptions: OllamaEmbeddingsOptions = {
      baseUrl: config.llm.ollama.baseUrl,
      model: textEmbedding.model
    };
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return auditedTextEmbeddingsProvider(
      new OllamaEmbeddingsProvider(providerOptions),
      descriptor("text-embedding", textEmbedding),
      options
    );
  }

  throw new Error(`${textEmbedding.provider} text embeddings are configured but no text embedding adapter is installed.`);
}

export function disabledLlmOperationResult<TValue>(
  role: LlmRoleDescriptor,
  refs: LlmOperationRefs = {},
  auditSink?: LlmAuditSink
): LlmOperationResult<TValue> {
  const audit: LlmOperationAudit = {
    role: role.role,
    provider: role.provider,
    model: role.model,
    status: "disabled",
    durationMs: 0,
    usage: {},
    refs
  };
  auditSink?.(audit);
  return {
    status: "disabled",
    audit
  };
}

function auditedTextEmbeddingsProvider(
  provider: EmbeddingsProvider,
  role: LlmRoleDescriptor,
  options: MindoryLlmOptions
): EmbeddingsProvider {
  if (options.auditSink === undefined) {
    return provider;
  }
  return new AuditedTextEmbeddingsProvider(provider, role, options.auditSink, options.operationRefs ?? {});
}

class AuditedTextEmbeddingsProvider implements EmbeddingsProvider {
  readonly provider: string;
  readonly model: string;

  constructor(
    private readonly inner: EmbeddingsProvider,
    private readonly role: LlmRoleDescriptor,
    private readonly auditSink: LlmAuditSink,
    private readonly refs: LlmOperationRefs
  ) {
    this.provider = inner.provider;
    this.model = inner.model;
  }

  async embedTexts(input: EmbedTextsInput): Promise<EmbeddingResult[]> {
    const startedAt = Date.now();
    try {
      const result = await this.inner.embedTexts(input);
      const durationMs = Date.now() - startedAt;
      const usage: LlmOperationUsage = {
        durationMs
      };
      const firstResult = result[0];
      if (firstResult !== undefined) {
        usage.embeddingDimensions = firstResult.dimensions;
      }
      this.auditSink({
        role: this.role.role,
        provider: this.role.provider,
        model: input.model ?? this.role.model,
        status: "success",
        durationMs,
        usage,
        refs: this.refs
      });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.auditSink({
        role: this.role.role,
        provider: this.role.provider,
        model: input.model ?? this.role.model,
        status: "failed",
        durationMs,
        usage: { durationMs },
        refs: this.refs,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error)
      });
      throw error;
    }
  }
}

export function openAiCompatibleBearerToken(config: MindoryConfig): string | undefined {
  if (config.llm.openaiCompatible.authMode === "api-key") {
    return nonEmpty(config.llm.openaiCompatible.apiKey);
  }
  if (config.llm.openaiCompatible.authMode === "oauth-bearer") {
    return nonEmpty(config.llm.openaiCompatible.oauthAccessToken);
  }
  return undefined;
}

function llmRoleDescriptors(config: MindoryConfig): LlmRoleDescriptor[] {
  return [
    descriptor("chat", config.llm.chat),
    descriptor("text-embedding", config.llm.textEmbedding),
    descriptor("image-embedding", config.llm.imageEmbedding),
    descriptor("ocr", config.llm.ocr),
    descriptor("asr", config.llm.asr),
    descriptor("vision-captioning", config.llm.visionCaptioning),
    descriptor("face-detection", config.llm.faceDetection),
    descriptor("face-recognition", config.llm.faceRecognition),
    descriptor("image-generation", config.llm.imageGeneration),
    descriptor("audio-generation", config.llm.audioGeneration)
  ];
}

function descriptor(
  role: LlmRole,
  config: {
    enabled: boolean;
    provider: LlmProvider;
    model: string;
    required: boolean;
    timeoutMs: number;
    concurrency: number;
    dimensions?: number | null;
  }
): LlmRoleDescriptor {
  const descriptor: LlmRoleDescriptor = {
    role,
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    required: config.required,
    timeoutMs: config.timeoutMs,
    concurrency: config.concurrency
  };
  if (config.dimensions !== undefined) {
    descriptor.dimensions = config.dimensions;
  }
  return descriptor;
}

function llmProviders(config: MindoryConfig): LlmProviderDescriptor[] {
  return [
    {
      provider: "openai-compatible",
      baseUrl: config.llm.openaiCompatible.baseUrl,
      authMode: config.llm.openaiCompatible.authMode
    },
    {
      provider: "ollama",
      baseUrl: config.llm.ollama.baseUrl
    },
    {
      provider: "local-http",
      baseUrl: config.llm.localHttp.baseUrl
    },
    {
      provider: "local-command",
      commandTimeoutMs: config.llm.localCommand.timeoutMs
    }
  ];
}

function llmRoleToCatalogKey(role: LlmRole): LlmRoleCatalogKey {
  return role.toUpperCase().replace(/-/g, "_") as LlmRoleCatalogKey;
}

function catalogKeyToLlmRole(key: LlmRoleCatalogKey): LlmRole {
  return key.toLowerCase().replace(/_/g, "-") as LlmRole;
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return "unknown_error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
