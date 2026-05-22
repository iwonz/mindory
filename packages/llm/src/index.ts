import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  LLM_ROLE_SUPPORT_CATALOG,
  llmRoleProviderSupportStatus as catalogLlmRoleProviderSupportStatus,
  llmRoleSupportStatus as catalogLlmRoleSupportStatus,
  type ConfigSupportStatus,
  type LlmProvider,
  type LlmRoleCatalogKey,
  type MindoryConfig
} from "@mindory/config";
import {
  ProcessingError,
  type EmbeddingResult,
  type EmbeddingsProvider,
  type EmbedTextsInput
} from "@mindory/core/processing";
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
  healthcheckCommand?: string;
  healthcheckArgs?: readonly string[];
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
  diagnostics?: Record<string, unknown>;
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

export interface LlmOcrPage {
  pageNumber: number;
  text: string;
  confidence?: number | null;
}

export interface LlmOcrOutput {
  text: string;
  pages?: LlmOcrPage[];
  usage?: LlmOperationUsage;
}

export interface LlmAsrSegment {
  segmentIndex: number;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number | null;
}

export interface LlmAsrOutput {
  text: string;
  segments: LlmAsrSegment[];
  usage?: LlmOperationUsage;
}

export interface LlmVisionCaptionOutput {
  caption: string;
  labels?: string[];
  usage?: LlmOperationUsage;
}

export interface LlmFaceObservationOutput {
  boundingBox: Record<string, unknown>;
  embedding?: number[] | null;
  confidence?: number | null;
  label?: string | null;
}

export interface LlmFaceDetectionOutput {
  faces: LlmFaceObservationOutput[];
  usage?: LlmOperationUsage;
}

export interface LlmFaceRecognitionOutput {
  faces: LlmFaceObservationOutput[];
  identityIds?: string[];
  usage?: LlmOperationUsage;
}

export interface OpenAICompatibleChatOptions {
  baseUrl: string;
  model: string;
  bearerToken?: string;
  fetchImpl?: typeof fetch;
}

export interface LocalHttpModelOptions {
  baseUrl: string;
  model: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

export type LlmProviderHealthStatus = "ok" | "failed";

export interface LlmProviderHealth {
  provider: Exclude<LlmProvider, "disabled">;
  status: LlmProviderHealthStatus;
  durationMs: number;
  baseUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  checks?: LlmProviderHealthCheckResult[];
}

export interface LlmProviderHealthCheckResult {
  role: LlmRole;
  model: string;
  status: LlmProviderHealthStatus;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: Record<string, unknown>;
}

export interface LlmLocalCommandRunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface LlmLocalCommandRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface LlmLocalCommandRunner {
  run(command: string, args: readonly string[], options: LlmLocalCommandRunOptions): Promise<LlmLocalCommandRunResult> | LlmLocalCommandRunResult;
}

export interface LlmProviderHealthCheckOptions {
  fetchImpl?: typeof fetch;
  commandRunner?: LlmLocalCommandRunner;
  auditSink?: LlmAuditSink;
  refs?: LlmOperationRefs;
  signal?: AbortSignal;
}

export interface LlmTextEmbeddingProvider {
  embedTexts(input: { texts: string[] }, context: LlmProviderCallContext): Promise<LlmOperationResult<number[][]>>;
}

export interface LlmChatProvider {
  generateChat(input: LlmChatInput, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmChatOutput>>;
}

export interface LlmOcrProvider {
  recognizeText(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmOcrOutput>>;
}

export interface LlmAsrProvider {
  transcribe(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmAsrOutput>>;
}

export interface LlmVisionProvider {
  captionImage(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmVisionCaptionOutput>>;
}

export interface LlmFaceProvider {
  detectFaces(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmFaceDetectionOutput>>;
  recognizeFaces(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmFaceRecognitionOutput>>;
}

export interface LlmGenerationProvider {
  generateImage(input: { prompt: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ bytes: Uint8Array; mimeType: string }>>;
  generateAudio(input: { prompt: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<{ bytes: Uint8Array; mimeType: string }>>;
}

export interface MindoryLlmOptions {
  fetchImpl?: typeof fetch;
  commandRunner?: LlmLocalCommandRunner;
  auditSink?: LlmAuditSink;
  operationRefs?: LlmOperationRefs;
}

export interface MindoryLlm {
  registry: LlmRoleRegistry;
  roleSupport: readonly LlmRoleSupportDescriptor[];
  providers: LlmProviderDescriptor[];
  chat?: LlmChatProvider;
  textEmbeddings?: EmbeddingsProvider;
  ocr?: LlmOcrProvider;
  asr?: LlmAsrProvider;
  vision?: LlmVisionProvider;
  faces?: LlmFaceProvider;
  healthCheck(provider: Exclude<LlmProvider, "disabled">, options?: Omit<LlmProviderHealthCheckOptions, "fetchImpl" | "commandRunner" | "auditSink" | "refs">): Promise<LlmProviderHealth>;
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
    healthCheck: (provider, healthOptions = {}) => {
      const checkOptions: LlmProviderHealthCheckOptions = {};
      if (options.fetchImpl !== undefined) {
        checkOptions.fetchImpl = options.fetchImpl;
      }
      if (healthOptions.signal !== undefined) {
        checkOptions.signal = healthOptions.signal;
      }
      if (options.commandRunner !== undefined) {
        checkOptions.commandRunner = options.commandRunner;
      }
      if (options.auditSink !== undefined) {
        checkOptions.auditSink = options.auditSink;
      }
      if (options.operationRefs !== undefined) {
        checkOptions.refs = options.operationRefs;
      }
      return checkMindoryLlmProviderHealth(config, provider, checkOptions);
    },
    disabledResult: (role, refs) => disabledLlmOperationResult(registry.require(role), refs, options.auditSink)
  };
  const chat = buildMindoryChatProvider(config, options);
  if (chat !== undefined) {
    runtime.chat = chat;
  }
  const textEmbeddings = buildMindoryTextEmbeddingsProvider(config, options);
  if (textEmbeddings !== undefined) {
    runtime.textEmbeddings = textEmbeddings;
  }
  const ocr = buildMindoryOcrProvider(config, options);
  if (ocr !== undefined) {
    runtime.ocr = ocr;
  }
  const asr = buildMindoryAsrProvider(config, options);
  if (asr !== undefined) {
    runtime.asr = asr;
  }
  const vision = buildMindoryVisionProvider(config, options);
  if (vision !== undefined) {
    runtime.vision = vision;
  }
  const faces = buildMindoryFaceProvider(config, options);
  if (faces !== undefined) {
    runtime.faces = faces;
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

  if (textEmbedding.provider === "local-http") {
    const providerOptions: LocalHttpModelOptions = {
      baseUrl: config.llm.localHttp.baseUrl,
      model: textEmbedding.model
    };
    if (textEmbedding.dimensions !== null) {
      providerOptions.dimensions = textEmbedding.dimensions;
    }
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return auditedTextEmbeddingsProvider(
      new LocalHttpTextEmbeddingsProvider(providerOptions),
      descriptor("text-embedding", textEmbedding),
      options
    );
  }

  throw new Error(`${textEmbedding.provider} text embeddings are configured but no text embedding adapter is installed.`);
}

export function buildMindoryChatProvider(
  config: MindoryConfig,
  options: MindoryLlmOptions = {}
): LlmChatProvider | undefined {
  const chat = config.llm.chat;
  if (!chat.enabled || chat.provider === "disabled") {
    return undefined;
  }

  if (chat.provider === "openai-compatible") {
    const providerOptions: OpenAICompatibleChatOptions = {
      baseUrl: config.llm.openaiCompatible.baseUrl,
      model: chat.model
    };
    const bearerToken = openAiCompatibleBearerToken(config);
    if (bearerToken !== undefined) {
      providerOptions.bearerToken = bearerToken;
    }
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return new OpenAICompatibleChatProvider(
      providerOptions,
      descriptor("chat", chat),
      options.auditSink,
      options.operationRefs ?? {}
    );
  }

  if (chat.provider === "local-http") {
    const providerOptions: LocalHttpModelOptions = {
      baseUrl: config.llm.localHttp.baseUrl,
      model: chat.model
    };
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return new LocalHttpChatProvider(
      providerOptions,
      descriptor("chat", chat),
      options.auditSink,
      options.operationRefs ?? {}
    );
  }

  throw new Error(`${chat.provider} chat is configured but no chat adapter is installed.`);
}

export function buildMindoryOcrProvider(
  config: MindoryConfig,
  options: MindoryLlmOptions = {}
): LlmOcrProvider | undefined {
  const ocr = config.llm.ocr;
  if (!ocr.enabled || ocr.provider === "disabled") {
    return undefined;
  }

  if (ocr.provider === "local-http") {
    const providerOptions: LocalHttpModelOptions = {
      baseUrl: config.llm.localHttp.baseUrl,
      model: ocr.model
    };
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return new LocalHttpOcrProvider(
      providerOptions,
      descriptor("ocr", ocr),
      options.auditSink,
      options.operationRefs ?? {}
    );
  }

  throw new Error(`${ocr.provider} OCR is configured but no OCR adapter is installed.`);
}

export function buildMindoryVisionProvider(
  config: MindoryConfig,
  options: MindoryLlmOptions = {}
): LlmVisionProvider | undefined {
  const vision = config.llm.visionCaptioning;
  if (!vision.enabled || vision.provider === "disabled") {
    return undefined;
  }

  if (vision.provider === "local-http") {
    const providerOptions: LocalHttpModelOptions = {
      baseUrl: config.llm.localHttp.baseUrl,
      model: vision.model
    };
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return new LocalHttpVisionProvider(
      providerOptions,
      descriptor("vision-captioning", vision),
      options.auditSink,
      options.operationRefs ?? {}
    );
  }

  throw new Error(`${vision.provider} vision captioning is configured but no vision adapter is installed.`);
}

export function buildMindoryAsrProvider(
  config: MindoryConfig,
  options: MindoryLlmOptions = {}
): LlmAsrProvider | undefined {
  const asr = config.llm.asr;
  if (!asr.enabled || asr.provider === "disabled") {
    return undefined;
  }

  if (asr.provider === "local-http") {
    const providerOptions: LocalHttpModelOptions = {
      baseUrl: config.llm.localHttp.baseUrl,
      model: asr.model
    };
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return new LocalHttpAsrProvider(
      providerOptions,
      descriptor("asr", asr),
      options.auditSink,
      options.operationRefs ?? {}
    );
  }

  throw new Error(`${asr.provider} ASR is configured but no ASR adapter is installed.`);
}

export function buildMindoryFaceProvider(
  config: MindoryConfig,
  options: MindoryLlmOptions = {}
): LlmFaceProvider | undefined {
  const detection = config.llm.faceDetection;
  const recognition = config.llm.faceRecognition;
  const detectionEnabled = detection.enabled && detection.provider !== "disabled";
  const recognitionEnabled = recognition.enabled && recognition.provider !== "disabled";
  if (!detectionEnabled && !recognitionEnabled) {
    return undefined;
  }
  const providers = new Set([detection.provider, recognition.provider].filter((provider) => provider !== "disabled"));
  if (providers.size > 1) {
    throw new Error("Face detection and face recognition must use the same provider in the current @mindory/llm runtime.");
  }
  const provider = providers.values().next().value;
  if (provider === "local-http") {
    const providerOptions: LocalHttpModelOptions = {
      baseUrl: config.llm.localHttp.baseUrl,
      model: recognition.model || detection.model
    };
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return new LocalHttpFaceProvider(
      providerOptions,
      options.auditSink,
      options.operationRefs ?? {}
    );
  }
  throw new Error(`${provider} face detection/recognition is configured but no face adapter is installed.`);
}

export async function checkMindoryLlmProviderHealth(
  config: MindoryConfig,
  provider: Exclude<LlmProvider, "disabled">,
  options: LlmProviderHealthCheckOptions = {}
): Promise<LlmProviderHealth> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (provider === "openai-compatible") {
    return httpProviderHealth(provider, config.llm.openaiCompatible.baseUrl, "/models", fetchImpl, options.signal);
  }
  if (provider === "ollama") {
    return httpProviderHealth(provider, config.llm.ollama.baseUrl, "/api/tags", fetchImpl, options.signal);
  }
  if (provider === "local-http") {
    return httpProviderHealth(provider, config.llm.localHttp.baseUrl, "/health", fetchImpl, options.signal);
  }
  return localCommandProviderHealth(config, options);
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

export class LocalHttpTextEmbeddingsProvider implements EmbeddingsProvider {
  readonly provider = "local-http";
  readonly model: string;
  private readonly options: LocalHttpModelOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalHttpModelOptions) {
    this.options = options;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embedTexts(input: EmbedTextsInput): Promise<EmbeddingResult[]> {
    const model = input.model ?? this.model;
    const requestBody: LocalHttpEmbeddingsRequest = {
      model,
      input: input.texts
    };
    if (this.options.dimensions !== undefined) {
      requestBody.dimensions = this.options.dimensions;
    }
    const response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new ProcessingError("embedding_provider_error", `Local HTTP embedding request failed with ${response.status}.`);
    }

    const body = await response.json() as LocalHttpEmbeddingsResponse;
    const embeddings = localHttpEmbeddings(body);
    return embeddings.map((embedding, index) => {
      if (!Array.isArray(embedding)) {
        throw new ProcessingError("embedding_provider_error", "Local HTTP embedding response included an invalid embedding.");
      }
      return {
        textIndex: localHttpEmbeddingTextIndex(body, index),
        embedding,
        model: body.model ?? model,
        dimensions: embedding.length
      };
    });
  }
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

export class LocalHttpChatProvider implements LlmChatProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: LocalHttpModelOptions,
    private readonly role: LlmRoleDescriptor,
    private readonly auditSink: LlmAuditSink | undefined,
    private readonly refs: LlmOperationRefs
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateChat(input: LlmChatInput, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmChatOutput>> {
    const startedAt = Date.now();
    const model = context.role.model || this.options.model;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: input.messages,
          temperature: input.temperature,
          max_tokens: input.maxOutputTokens
        })
      };
      if (context.signal !== undefined) {
        requestInit.signal = context.signal;
      }
      const response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}/chat/completions`, requestInit);
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Local HTTP chat request failed with ${response.status}: ${responseText}`);
      }
      const payload = JSON.parse(responseText) as LocalHttpChatResponse;
      const output: LlmChatOutput = {
        text: localHttpChatText(payload),
        usage: usageFromOpenAI(payload.usage)
      };
      return this.result("success", startedAt, model, output, context.refs);
    } catch (error) {
      return this.result("failed", startedAt, model, undefined, context.refs, error);
    }
  }

  private result(
    status: LlmOperationStatus,
    startedAt: number,
    model: string,
    value?: LlmChatOutput,
    refs: LlmOperationRefs = {},
    error?: unknown
  ): LlmOperationResult<LlmChatOutput> {
    const durationMs = Date.now() - startedAt;
    const audit: LlmOperationAudit = {
      role: this.role.role,
      provider: this.role.provider,
      model,
      status,
      durationMs,
      usage: {
        ...value?.usage,
        durationMs
      },
      refs: {
        ...this.refs,
        ...refs
      }
    };
    if (error !== undefined) {
      audit.errorCode = errorCode(error);
      audit.errorMessage = errorMessage(error);
    }
    this.auditSink?.(audit);
    return {
      status,
      ...(value === undefined ? {} : { value }),
      audit
    };
  }
}

export class LocalHttpOcrProvider implements LlmOcrProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: LocalHttpModelOptions,
    private readonly role: LlmRoleDescriptor,
    private readonly auditSink: LlmAuditSink | undefined,
    private readonly refs: LlmOperationRefs
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async recognizeText(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmOcrOutput>> {
    const startedAt = Date.now();
    const model = context.role.model || this.options.model;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          mime_type: input.mimeType,
          data_base64: Buffer.from(input.bytes).toString("base64")
        })
      };
      if (context.signal !== undefined) {
        requestInit.signal = context.signal;
      }
      const response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}/ocr`, requestInit);
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Local HTTP OCR request failed with ${response.status}: ${responseText}`);
      }
      const payload = JSON.parse(responseText) as LocalHttpOcrResponse;
      const output: LlmOcrOutput = {
        text: payload.text ?? localHttpOcrPages(payload).map((page) => page.text).join("\n\n").trim(),
        pages: localHttpOcrPages(payload),
        usage: usageFromOpenAI(payload.usage)
      };
      return this.result("success", startedAt, model, output, context.refs);
    } catch (error) {
      return this.result("failed", startedAt, model, undefined, context.refs, error);
    }
  }

  private result(
    status: LlmOperationStatus,
    startedAt: number,
    model: string,
    value?: LlmOcrOutput,
    refs: LlmOperationRefs = {},
    error?: unknown
  ): LlmOperationResult<LlmOcrOutput> {
    const durationMs = Date.now() - startedAt;
    const audit: LlmOperationAudit = {
      role: this.role.role,
      provider: this.role.provider,
      model,
      status,
      durationMs,
      usage: {
        ...value?.usage,
        durationMs
      },
      refs: {
        ...this.refs,
        ...refs
      }
    };
    if (error !== undefined) {
      audit.errorCode = errorCode(error);
      audit.errorMessage = errorMessage(error);
    }
    this.auditSink?.(audit);
    return {
      status,
      ...(value === undefined ? {} : { value }),
      audit
    };
  }
}

export class LocalHttpAsrProvider implements LlmAsrProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: LocalHttpModelOptions,
    private readonly role: LlmRoleDescriptor,
    private readonly auditSink: LlmAuditSink | undefined,
    private readonly refs: LlmOperationRefs
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async transcribe(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmAsrOutput>> {
    const startedAt = Date.now();
    const model = context.role.model || this.options.model;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          mime_type: input.mimeType,
          data_base64: Buffer.from(input.bytes).toString("base64")
        })
      };
      if (context.signal !== undefined) {
        requestInit.signal = context.signal;
      }
      const response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}/asr`, requestInit);
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Local HTTP ASR request failed with ${response.status}: ${responseText}`);
      }
      const payload = JSON.parse(responseText) as LocalHttpAsrResponse;
      const segments = localHttpAsrSegments(payload);
      const output: LlmAsrOutput = {
        text: payload.text ?? segments.map((segment) => segment.text).join("\n").trim(),
        segments,
        usage: {
          ...usageFromOpenAI(payload.usage),
          ...(typeof payload.duration_ms === "number" ? { audioSeconds: payload.duration_ms / 1000 } : {}),
          ...(typeof payload.duration_seconds === "number" ? { audioSeconds: payload.duration_seconds } : {})
        }
      };
      return this.result("success", startedAt, model, output, context.refs);
    } catch (error) {
      return this.result("failed", startedAt, model, undefined, context.refs, error);
    }
  }

  private result(
    status: LlmOperationStatus,
    startedAt: number,
    model: string,
    value?: LlmAsrOutput,
    refs: LlmOperationRefs = {},
    error?: unknown
  ): LlmOperationResult<LlmAsrOutput> {
    const durationMs = Date.now() - startedAt;
    const audit: LlmOperationAudit = {
      role: this.role.role,
      provider: this.role.provider,
      model,
      status,
      durationMs,
      usage: {
        ...value?.usage,
        durationMs
      },
      refs: {
        ...this.refs,
        ...refs
      }
    };
    if (error !== undefined) {
      audit.errorCode = errorCode(error);
      audit.errorMessage = errorMessage(error);
    }
    this.auditSink?.(audit);
    return {
      status,
      ...(value === undefined ? {} : { value }),
      audit
    };
  }
}

export class LocalHttpVisionProvider implements LlmVisionProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: LocalHttpModelOptions,
    private readonly role: LlmRoleDescriptor,
    private readonly auditSink: LlmAuditSink | undefined,
    private readonly refs: LlmOperationRefs
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async captionImage(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmVisionCaptionOutput>> {
    const startedAt = Date.now();
    const model = context.role.model || this.options.model;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          mime_type: input.mimeType,
          data_base64: Buffer.from(input.bytes).toString("base64")
        })
      };
      if (context.signal !== undefined) {
        requestInit.signal = context.signal;
      }
      const response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}/vision/caption`, requestInit);
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Local HTTP vision caption request failed with ${response.status}: ${responseText}`);
      }
      const payload = JSON.parse(responseText) as LocalHttpVisionCaptionResponse;
      const output: LlmVisionCaptionOutput = {
        caption: payload.caption ?? payload.text ?? "",
        labels: Array.isArray(payload.labels) ? payload.labels.filter((label): label is string => typeof label === "string") : [],
        usage: usageFromOpenAI(payload.usage)
      };
      return this.result("success", startedAt, model, output, context.refs);
    } catch (error) {
      return this.result("failed", startedAt, model, undefined, context.refs, error);
    }
  }

  private result(
    status: LlmOperationStatus,
    startedAt: number,
    model: string,
    value?: LlmVisionCaptionOutput,
    refs: LlmOperationRefs = {},
    error?: unknown
  ): LlmOperationResult<LlmVisionCaptionOutput> {
    const durationMs = Date.now() - startedAt;
    const audit: LlmOperationAudit = {
      role: this.role.role,
      provider: this.role.provider,
      model,
      status,
      durationMs,
      usage: {
        ...value?.usage,
        durationMs
      },
      refs: {
        ...this.refs,
        ...refs
      }
    };
    if (error !== undefined) {
      audit.errorCode = errorCode(error);
      audit.errorMessage = errorMessage(error);
    }
    this.auditSink?.(audit);
    return {
      status,
      ...(value === undefined ? {} : { value }),
      audit
    };
  }
}

export class LocalHttpFaceProvider implements LlmFaceProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: LocalHttpModelOptions,
    private readonly auditSink: LlmAuditSink | undefined,
    private readonly refs: LlmOperationRefs
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  detectFaces(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmFaceDetectionOutput>> {
    return this.callFaceEndpoint("/faces/detect", input, context, (payload) => ({
      faces: localHttpFaceObservations(payload.faces),
      usage: usageFromOpenAI(payload.usage)
    }));
  }

  recognizeFaces(input: { bytes: Uint8Array; mimeType: string }, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmFaceRecognitionOutput>> {
    return this.callFaceEndpoint("/faces/recognize", input, context, (payload) => ({
      faces: localHttpFaceObservations(payload.faces),
      identityIds: Array.isArray(payload.identity_ids) ? payload.identity_ids.filter((id): id is string => typeof id === "string") : [],
      usage: usageFromOpenAI(payload.usage)
    }));
  }

  private async callFaceEndpoint<TValue>(
    endpoint: "/faces/detect" | "/faces/recognize",
    input: { bytes: Uint8Array; mimeType: string },
    context: LlmProviderCallContext,
    parse: (payload: LocalHttpFaceResponse) => TValue
  ): Promise<LlmOperationResult<TValue>> {
    const startedAt = Date.now();
    const model = context.role.model || this.options.model;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          mime_type: input.mimeType,
          data_base64: Buffer.from(input.bytes).toString("base64")
        })
      };
      if (context.signal !== undefined) {
        requestInit.signal = context.signal;
      }
      const response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}${endpoint}`, requestInit);
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Local HTTP face request failed with ${response.status}: ${responseText}`);
      }
      const payload = JSON.parse(responseText) as LocalHttpFaceResponse;
      return this.result<TValue>("success", startedAt, model, parse(payload), context.role, context.refs);
    } catch (error) {
      return this.result<TValue>("failed", startedAt, model, undefined, context.role, context.refs, error);
    }
  }

  private result<TValue>(
    status: LlmOperationStatus,
    startedAt: number,
    model: string,
    value: TValue | undefined,
    role: LlmRoleDescriptor,
    refs: LlmOperationRefs = {},
    error?: unknown
  ): LlmOperationResult<TValue> {
    const durationMs = Date.now() - startedAt;
    const audit: LlmOperationAudit = {
      role: role.role,
      provider: role.provider,
      model,
      status,
      durationMs,
      usage: {
        durationMs,
        imageCount: 1
      },
      refs: {
        ...this.refs,
        ...refs
      }
    };
    if (error !== undefined) {
      audit.errorCode = errorCode(error);
      audit.errorMessage = errorMessage(error);
    }
    this.auditSink?.(audit);
    return {
      status,
      ...(value === undefined ? {} : { value }),
      audit
    };
  }
}

export class OpenAICompatibleChatProvider implements LlmChatProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: OpenAICompatibleChatOptions,
    private readonly role: LlmRoleDescriptor,
    private readonly auditSink: LlmAuditSink | undefined,
    private readonly refs: LlmOperationRefs
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateChat(input: LlmChatInput, context: LlmProviderCallContext): Promise<LlmOperationResult<LlmChatOutput>> {
    const startedAt = Date.now();
    const model = context.role.model || this.options.model;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          messages: input.messages,
          temperature: input.temperature,
          max_tokens: input.maxOutputTokens
        })
      };
      if (context.signal !== undefined) {
        requestInit.signal = context.signal;
      }
      const response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}/chat/completions`, {
        ...requestInit
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI-compatible chat request failed with ${response.status}: ${responseText}`);
      }
      const payload = JSON.parse(responseText) as OpenAICompatibleChatResponse;
      const output: LlmChatOutput = {
        text: payload.choices?.[0]?.message?.content ?? "",
        usage: usageFromOpenAI(payload.usage)
      };
      return this.result("success", startedAt, model, output, context.refs);
    } catch (error) {
      return this.result("failed", startedAt, model, undefined, context.refs, error);
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (this.options.bearerToken !== undefined) {
      headers.authorization = `Bearer ${this.options.bearerToken}`;
    }
    return headers;
  }

  private result(
    status: LlmOperationStatus,
    startedAt: number,
    model: string,
    value?: LlmChatOutput,
    refs: LlmOperationRefs = {},
    error?: unknown
  ): LlmOperationResult<LlmChatOutput> {
    const durationMs = Date.now() - startedAt;
    const audit: LlmOperationAudit = {
      role: this.role.role,
      provider: this.role.provider,
      model,
      status,
      durationMs,
      usage: {
        ...value?.usage,
        durationMs
      },
      refs: {
        ...this.refs,
        ...refs
      }
    };
    if (error !== undefined) {
      audit.errorCode = errorCode(error);
      audit.errorMessage = errorMessage(error);
    }
    this.auditSink?.(audit);
    return {
      status,
      ...(value === undefined ? {} : { value }),
      audit
    };
  }
}

interface OpenAICompatibleChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface LocalHttpEmbeddingsRequest {
  model: string;
  input: string[];
  dimensions?: number;
}

interface LocalHttpEmbeddingsResponse {
  embeddings?: number[][];
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
  model?: string;
}

interface LocalHttpChatResponse extends OpenAICompatibleChatResponse {
  text?: string;
  output?: string;
  message?: {
    content?: string;
  };
}

interface LocalHttpOcrResponse {
  text?: string;
  pages?: Array<{
    page_number?: number;
    pageNumber?: number;
    text?: string;
    confidence?: number | null;
  }>;
  usage?: OpenAICompatibleChatResponse["usage"];
}

interface LocalHttpAsrResponse {
  text?: string;
  segments?: Array<{
    index?: number;
    segment_index?: number;
    segmentIndex?: number;
    text?: string;
    start_ms?: number;
    startMs?: number;
    end_ms?: number;
    endMs?: number;
    confidence?: number | null;
  }>;
  duration_ms?: number;
  duration_seconds?: number;
  usage?: OpenAICompatibleChatResponse["usage"];
}

interface LocalHttpVisionCaptionResponse {
  caption?: string;
  text?: string;
  labels?: unknown[];
  usage?: OpenAICompatibleChatResponse["usage"];
}

interface LocalHttpFaceResponse {
  faces?: Array<{
    bounding_box?: Record<string, unknown>;
    boundingBox?: Record<string, unknown>;
    embedding?: number[] | null;
    confidence?: number | null;
    label?: string | null;
  }>;
  identity_ids?: unknown[];
  usage?: OpenAICompatibleChatResponse["usage"];
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
      commandTimeoutMs: config.llm.localCommand.timeoutMs,
      healthcheckCommand: config.llm.localCommand.healthcheckCommand,
      healthcheckArgs: config.llm.localCommand.healthcheckArgs
    }
  ];
}

function llmRoleToCatalogKey(role: LlmRole): LlmRoleCatalogKey {
  return role.toUpperCase().replace(/-/g, "_") as LlmRoleCatalogKey;
}

function catalogKeyToLlmRole(key: LlmRoleCatalogKey): LlmRole {
  return key.toLowerCase().replace(/_/g, "-") as LlmRole;
}

function usageFromOpenAI(usage: OpenAICompatibleChatResponse["usage"]): LlmOperationUsage {
  if (usage === undefined) {
    return {};
  }
  const result: LlmOperationUsage = {};
  if (usage.prompt_tokens !== undefined) {
    result.inputTokens = usage.prompt_tokens;
  }
  if (usage.completion_tokens !== undefined) {
    result.outputTokens = usage.completion_tokens;
  }
  if (usage.total_tokens !== undefined) {
    result.totalTokens = usage.total_tokens;
  }
  return result;
}

function localHttpAsrSegments(response: LocalHttpAsrResponse): LlmAsrSegment[] {
  if (!Array.isArray(response.segments)) {
    return [];
  }
  return response.segments
    .map((segment, index): LlmAsrSegment | null => {
      const text = typeof segment.text === "string" ? segment.text.trim() : "";
      if (text.length === 0) {
        return null;
      }
      return {
        segmentIndex: integerOrDefault(segment.segmentIndex ?? segment.segment_index ?? segment.index, index),
        text,
        startMs: integerOrDefault(segment.startMs ?? segment.start_ms, 0),
        endMs: integerOrDefault(segment.endMs ?? segment.end_ms, 0),
        confidence: typeof segment.confidence === "number" ? segment.confidence : null
      };
    })
    .filter((segment): segment is LlmAsrSegment => segment !== null);
}

function localHttpFaceObservations(faces: LocalHttpFaceResponse["faces"]): LlmFaceObservationOutput[] {
  if (!Array.isArray(faces)) {
    return [];
  }
  return faces
    .map((face): LlmFaceObservationOutput | null => {
      const boundingBox = face.boundingBox ?? face.bounding_box;
      if (boundingBox === undefined) {
        return null;
      }
      const output: LlmFaceObservationOutput = {
        boundingBox
      };
      if (Array.isArray(face.embedding)) {
        output.embedding = face.embedding.filter((value): value is number => typeof value === "number");
      } else if (face.embedding === null) {
        output.embedding = null;
      }
      if (typeof face.confidence === "number" || face.confidence === null) {
        output.confidence = face.confidence;
      }
      if (typeof face.label === "string" || face.label === null) {
        output.label = face.label;
      }
      return output;
    })
    .filter((face): face is LlmFaceObservationOutput => face !== null);
}

function integerOrDefault(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value as number) : fallback;
}

async function httpProviderHealth(
  provider: Exclude<LlmProvider, "disabled">,
  baseUrl: string,
  path: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined
): Promise<LlmProviderHealth> {
  const startedAt = Date.now();
  try {
    const requestInit: RequestInit = {
      method: "GET"
    };
    if (signal !== undefined) {
      requestInit.signal = signal;
    }
    const response = await fetchImpl(`${trimTrailingSlash(baseUrl)}${path}`, requestInit);
    if (!response.ok) {
      throw new Error(`${provider} health check failed with ${response.status}.`);
    }
    const health: LlmProviderHealth = {
      provider,
      status: "ok",
      durationMs: Date.now() - startedAt
    };
    if (baseUrl.trim() !== "") {
      health.baseUrl = baseUrl;
    }
    return health;
  } catch (error) {
    return failedProviderHealth(provider, startedAt, errorCode(error), errorMessage(error), baseUrl);
  }
}

function failedProviderHealth(
  provider: Exclude<LlmProvider, "disabled">,
  startedAt: number,
  code: string,
  message: string,
  baseUrl?: string
): LlmProviderHealth {
  const health: LlmProviderHealth = {
    provider,
    status: "failed",
    durationMs: Date.now() - startedAt,
    errorCode: code,
    errorMessage: message
  };
  if (baseUrl !== undefined && baseUrl.trim() !== "") {
    health.baseUrl = baseUrl;
  }
  return health;
}

async function localCommandProviderHealth(
  config: MindoryConfig,
  options: LlmProviderHealthCheckOptions
): Promise<LlmProviderHealth> {
  const startedAt = Date.now();
  const roles = llmRoleDescriptors(config).filter((role) => role.enabled && role.provider === "local-command");
  if (roles.length === 0) {
    return failedProviderHealth("local-command", startedAt, "local_command_no_configured_roles", "No enabled LLM roles use the local-command provider.");
  }

  const command = config.llm.localCommand.healthcheckCommand.trim();
  const executableFailure = await localCommandExecutableFailure(command);
  if (executableFailure !== null) {
    const checks = roles.map((role) => localCommandFailedCheck(role, startedAt, executableFailure.code, executableFailure.message));
    for (const check of checks) {
      emitLocalCommandHealthAudit(check, options.auditSink, options.refs);
    }
    return {
      provider: "local-command",
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorCode: executableFailure.code,
      errorMessage: executableFailure.message,
      checks
    };
  }

  const runner = options.commandRunner ?? createNodeLocalCommandRunner();
  const checks: LlmProviderHealthCheckResult[] = [];
  for (const role of roles) {
    const check = await runLocalCommandRoleHealth(command, config.llm.localCommand.healthcheckArgs, role, config.llm.localCommand.timeoutMs, runner, options.signal);
    checks.push(check);
    emitLocalCommandHealthAudit(check, options.auditSink, options.refs);
  }

  const failedCheck = checks.find((check) => check.status === "failed");
  const health: LlmProviderHealth = {
    provider: "local-command",
    status: failedCheck === undefined ? "ok" : "failed",
    durationMs: Date.now() - startedAt,
    checks
  };
  if (failedCheck !== undefined) {
    health.errorCode = failedCheck.errorCode ?? "local_command_healthcheck_failed";
    health.errorMessage = failedCheck.errorMessage ?? `local-command healthcheck failed for ${failedCheck.role}.`;
  }
  return health;
}

async function localCommandExecutableFailure(command: string): Promise<{ code: string; message: string } | null> {
  if (command.length === 0) {
    return {
      code: "local_command_healthcheck_command_required",
      message: "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND is required for local-command healthchecks."
    };
  }
  if (!isPathLikeCommand(command)) {
    return null;
  }
  try {
    await access(command, constants.X_OK);
    return null;
  } catch {
    return {
      code: "local_command_healthcheck_executable_invalid",
      message: `Local-command healthcheck executable is missing or not executable: ${command}.`
    };
  }
}

function isPathLikeCommand(command: string): boolean {
  return path.isAbsolute(command) || command.includes("/") || command.includes("\\");
}

async function runLocalCommandRoleHealth(
  command: string,
  argsTemplate: readonly string[],
  role: LlmRoleDescriptor,
  timeoutMs: number,
  runner: LlmLocalCommandRunner,
  signal: AbortSignal | undefined
): Promise<LlmProviderHealthCheckResult> {
  const startedAt = Date.now();
  try {
    const args = argsTemplate.map((arg) => renderLocalCommandArg(arg, role));
    const result = await runner.run(command, args, signal === undefined ? { timeoutMs } : { timeoutMs, signal });
    const durationMs = Date.now() - startedAt;
    const diagnostics = localCommandRunDiagnostics(result);
    if (result.timedOut === true) {
      return localCommandFailedCheck(role, startedAt, "local_command_healthcheck_timeout", `local-command healthcheck exceeded ${timeoutMs}ms.`, diagnostics);
    }
    if (result.stdout.trim() === "") {
      return localCommandFailedCheck(role, startedAt, "local_command_healthcheck_no_output", "local-command healthcheck did not print JSON to stdout.", diagnostics);
    }

    const parsed = parseLocalCommandHealthcheckJson(result.stdout);
    if (parsed.ok === false) {
      return localCommandFailedCheck(role, startedAt, parsed.code, parsed.message, diagnostics);
    }

    const validation = validateLocalCommandHealthPayload(parsed.value, role);
    const mergedDiagnostics = {
      ...diagnostics,
      ...validation.diagnostics
    };
    if (validation.status === "failed") {
      return localCommandFailedCheck(role, startedAt, validation.errorCode, validation.errorMessage, mergedDiagnostics);
    }
    if ((result.status ?? 1) !== 0) {
      return localCommandFailedCheck(role, startedAt, "local_command_healthcheck_command_failed", `local-command healthcheck exited with status ${result.status ?? 1}.`, mergedDiagnostics);
    }
    return {
      role: role.role,
      model: role.model,
      status: "ok",
      durationMs,
      diagnostics: mergedDiagnostics
    };
  } catch (error) {
    return localCommandFailedCheck(role, startedAt, errorCode(error), errorMessage(error));
  }
}

function renderLocalCommandArg(arg: string, role: LlmRoleDescriptor): string {
  return arg.replaceAll("{role}", role.role).replaceAll("{model}", role.model);
}

function localCommandFailedCheck(
  role: LlmRoleDescriptor,
  startedAt: number,
  errorCode: string,
  errorMessage: string,
  diagnostics?: Record<string, unknown>
): LlmProviderHealthCheckResult {
  const check: LlmProviderHealthCheckResult = {
    role: role.role,
    model: role.model,
    status: "failed",
    durationMs: Date.now() - startedAt,
    errorCode,
    errorMessage
  };
  if (diagnostics !== undefined) {
    check.diagnostics = diagnostics;
  }
  return check;
}

function emitLocalCommandHealthAudit(
  check: LlmProviderHealthCheckResult,
  auditSink: LlmAuditSink | undefined,
  refs: LlmOperationRefs | undefined
): void {
  if (auditSink === undefined) {
    return;
  }
  const audit: LlmOperationAudit = {
    role: check.role,
    provider: "local-command",
    model: check.model,
    status: check.status === "ok" ? "success" : "failed",
    durationMs: check.durationMs,
    usage: { durationMs: check.durationMs },
    refs: refs ?? {}
  };
  if (check.errorCode !== undefined) {
    audit.errorCode = check.errorCode;
  }
  if (check.errorMessage !== undefined) {
    audit.errorMessage = check.errorMessage;
  }
  if (check.diagnostics !== undefined) {
    audit.diagnostics = check.diagnostics;
  }
  auditSink(audit);
}

function createNodeLocalCommandRunner(): LlmLocalCommandRunner {
  return {
    run(command, args, options) {
      return new Promise<LlmLocalCommandRunResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const child = spawn(command, [...args], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"]
        });
        const finish = (result: Omit<LlmLocalCommandRunResult, "stdout" | "stderr">): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", abortHandler);
          resolve({
            ...result,
            stdout,
            stderr
          });
        };
        const abortHandler = (): void => {
          child.kill("SIGTERM");
          finish({
            status: null,
            errorCode: "local_command_healthcheck_aborted",
            errorMessage: "local-command healthcheck was aborted."
          });
        };
        const timeout = setTimeout(() => {
          child.kill("SIGTERM");
          finish({
            status: null,
            timedOut: true,
            errorCode: "local_command_healthcheck_timeout",
            errorMessage: `local-command healthcheck exceeded ${options.timeoutMs}ms.`
          });
        }, options.timeoutMs);
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("error", (error) => {
          finish({
            status: null,
            errorCode: errorCode(error),
            errorMessage: errorMessage(error)
          });
        });
        child.on("close", (status) => {
          finish({
            status
          });
        });
        if (options.signal !== undefined) {
          if (options.signal.aborted) {
            abortHandler();
          } else {
            options.signal.addEventListener("abort", abortHandler, { once: true });
          }
        }
      });
    }
  };
}

function localCommandRunDiagnostics(result: LlmLocalCommandRunResult): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {
    exitStatus: result.status,
    stdoutBytes: result.stdout.length,
    stderrBytes: result.stderr.length
  };
  if (result.timedOut !== undefined) {
    diagnostics.timedOut = result.timedOut;
  }
  if (result.errorCode !== undefined) {
    diagnostics.commandErrorCode = result.errorCode;
  }
  if (result.errorMessage !== undefined) {
    diagnostics.commandErrorMessage = result.errorMessage;
  }
  return diagnostics;
}

function parseLocalCommandHealthcheckJson(stdout: string): { ok: true; value: unknown } | { ok: false; code: string; message: string } {
  try {
    return {
      ok: true,
      value: JSON.parse(stdout.trim()) as unknown
    };
  } catch (error) {
    return {
      ok: false,
      code: "local_command_healthcheck_malformed_json",
      message: `local-command healthcheck stdout must be JSON: ${errorMessage(error)}`
    };
  }
}

function validateLocalCommandHealthPayload(
  payload: unknown,
  role: LlmRoleDescriptor
): { status: "ok"; diagnostics: Record<string, unknown> } | { status: "failed"; errorCode: string; errorMessage: string; diagnostics: Record<string, unknown> } {
  if (!isRecord(payload)) {
    return localCommandPayloadFailure("local_command_healthcheck_invalid_response", "local-command healthcheck JSON must be an object.");
  }
  const diagnostics = isRecord(payload.diagnostics) ? { payloadDiagnostics: payload.diagnostics } : {};
  const status = stringField(payload, "status");
  const provider = stringField(payload, "provider");
  const payloadRole = stringField(payload, "role");
  const payloadModel = stringField(payload, "model");

  if (status !== "ok" && status !== "failed") {
    return localCommandPayloadFailure("local_command_healthcheck_invalid_status", "local-command healthcheck status must be ok or failed.", diagnostics);
  }
  if (provider !== undefined && provider !== "local-command") {
    return localCommandPayloadFailure("local_command_healthcheck_provider_mismatch", `local-command healthcheck returned provider ${provider}.`, diagnostics);
  }
  if (payloadRole !== role.role) {
    const supportedRoles = arrayStringField(payload, "supported_roles") ?? arrayStringField(payload, "supportedRoles");
    if (supportedRoles !== undefined && !supportedRoles.includes(role.role)) {
      return localCommandPayloadFailure("local_command_healthcheck_unsupported_role", `local-command healthcheck does not support role ${role.role}.`, diagnostics);
    }
    return localCommandPayloadFailure("local_command_healthcheck_role_mismatch", `local-command healthcheck returned role ${payloadRole ?? "<missing>"} for expected role ${role.role}.`, diagnostics);
  }
  if (payloadModel !== role.model) {
    return localCommandPayloadFailure("local_command_healthcheck_model_mismatch", `local-command healthcheck returned model ${payloadModel ?? "<missing>"} for expected model ${role.model}.`, diagnostics);
  }
  if (status === "failed") {
    return localCommandPayloadFailure(
      stringField(payload, "error_code") ?? stringField(payload, "errorCode") ?? "local_command_healthcheck_failed",
      stringField(payload, "error_message") ?? stringField(payload, "errorMessage") ?? `local-command healthcheck failed for role ${role.role}.`,
      diagnostics
    );
  }
  return {
    status: "ok",
    diagnostics
  };
}

function localCommandPayloadFailure(
  errorCode: string,
  errorMessage: string,
  diagnostics: Record<string, unknown> = {}
): { status: "failed"; errorCode: string; errorMessage: string; diagnostics: Record<string, unknown> } {
  return {
    status: "failed",
    errorCode,
    errorMessage,
    diagnostics
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function arrayStringField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localHttpEmbeddings(body: LocalHttpEmbeddingsResponse): number[][] {
  if (Array.isArray(body.embeddings)) {
    return body.embeddings;
  }
  if (Array.isArray(body.data)) {
    return body.data.map((item) => {
      if (!Array.isArray(item.embedding)) {
        throw new ProcessingError("embedding_provider_error", "Local HTTP embedding response included an invalid embedding.");
      }
      return item.embedding;
    });
  }
  throw new ProcessingError("embedding_provider_error", "Local HTTP embedding response did not include embeddings.");
}

function localHttpEmbeddingTextIndex(body: LocalHttpEmbeddingsResponse, index: number): number {
  if (Array.isArray(body.data)) {
    return body.data[index]?.index ?? index;
  }
  return index;
}

function localHttpChatText(payload: LocalHttpChatResponse): string {
  return payload.choices?.[0]?.message?.content ?? payload.text ?? payload.output ?? payload.message?.content ?? "";
}

function localHttpOcrPages(payload: LocalHttpOcrResponse): LlmOcrPage[] {
  if (Array.isArray(payload.pages) && payload.pages.length > 0) {
    return payload.pages
      .map((page, index) => {
        const text = typeof page.text === "string" ? page.text : "";
        return {
          pageNumber: page.page_number ?? page.pageNumber ?? index + 1,
          text,
          confidence: page.confidence ?? null
        };
      })
      .filter((page) => page.text.trim().length > 0);
  }
  if (typeof payload.text === "string" && payload.text.trim().length > 0) {
    return [{
      pageNumber: 1,
      text: payload.text.trim(),
      confidence: null
    }];
  }
  return [];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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
