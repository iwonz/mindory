import type { MindoryConfig, ModelRuntimeProvider } from "@mindory/config";
import type { EmbeddingsProvider } from "@mindory/core/processing";
import { OpenAICompatibleEmbeddingsProvider, type OpenAICompatibleEmbeddingsOptions } from "@mindory/embeddings-openai-compatible";
import { OllamaEmbeddingsProvider, type OllamaEmbeddingsOptions } from "@mindory/embeddings-ollama";

export type ModelCapability =
  | "text-embedding"
  | "image-embedding"
  | "image-captioning"
  | "ocr"
  | "asr"
  | "face-detection"
  | "face-recognition";

export interface ModelCapabilityDescriptor {
  capability: ModelCapability;
  enabled: boolean;
  provider: ModelRuntimeProvider;
  model: string;
  required: boolean;
  dimensions?: number | null;
}

export interface ModelRuntimeProviderDescriptor {
  provider: Exclude<ModelRuntimeProvider, "disabled">;
  baseUrl: string;
  authMode?: "none" | "api-key" | "oauth-bearer";
}

export interface MindoryModelRuntimeOptions {
  fetchImpl?: typeof fetch;
}

export interface MindoryModelRuntime {
  registry: ModelCapabilityRegistry;
  providers: ModelRuntimeProviderDescriptor[];
  textEmbeddings?: EmbeddingsProvider;
}

export class ModelCapabilityRegistry {
  private readonly capabilities: Map<ModelCapability, ModelCapabilityDescriptor>;

  constructor(capabilities: ModelCapabilityDescriptor[]) {
    this.capabilities = new Map(capabilities.map((capability) => [capability.capability, capability]));
  }

  list(): ModelCapabilityDescriptor[] {
    return Array.from(this.capabilities.values());
  }

  get(capability: ModelCapability): ModelCapabilityDescriptor | undefined {
    return this.capabilities.get(capability);
  }

  isEnabled(capability: ModelCapability): boolean {
    return this.capabilities.get(capability)?.enabled ?? false;
  }

  require(capability: ModelCapability): ModelCapabilityDescriptor {
    const descriptor = this.get(capability);
    if (descriptor === undefined) {
      throw new Error(`Model capability is not registered: ${capability}.`);
    }
    return descriptor;
  }
}

export function buildMindoryModelRuntime(
  config: MindoryConfig,
  options: MindoryModelRuntimeOptions = {}
): MindoryModelRuntime {
  const registry = new ModelCapabilityRegistry(modelCapabilityDescriptors(config));
  const runtime: MindoryModelRuntime = {
    registry,
    providers: modelRuntimeProviders(config)
  };
  const textEmbeddings = buildMindoryTextEmbeddingsProvider(config, options);
  if (textEmbeddings !== undefined) {
    runtime.textEmbeddings = textEmbeddings;
  }
  return runtime;
}

export function buildMindoryTextEmbeddingsProvider(
  config: MindoryConfig,
  options: MindoryModelRuntimeOptions = {}
): EmbeddingsProvider | undefined {
  const textEmbedding = config.modelRuntime.textEmbedding;
  if (!textEmbedding.enabled || textEmbedding.provider === "disabled") {
    return undefined;
  }

  if (textEmbedding.provider === "openai-compatible") {
    const providerOptions: OpenAICompatibleEmbeddingsOptions = {
      baseUrl: config.modelRuntime.openaiCompatible.baseUrl,
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
    return new OpenAICompatibleEmbeddingsProvider(providerOptions);
  }

  if (textEmbedding.provider === "ollama") {
    const providerOptions: OllamaEmbeddingsOptions = {
      baseUrl: config.modelRuntime.ollama.baseUrl,
      model: textEmbedding.model
    };
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return new OllamaEmbeddingsProvider(providerOptions);
  }

  throw new Error("Local text embeddings are configured but no local text embedding adapter is installed.");
}

export function openAiCompatibleBearerToken(config: MindoryConfig): string | undefined {
  if (config.modelRuntime.openaiCompatible.authMode === "api-key") {
    return nonEmpty(config.modelRuntime.openaiCompatible.apiKey);
  }
  if (config.modelRuntime.openaiCompatible.authMode === "oauth-bearer") {
    return nonEmpty(config.modelRuntime.openaiCompatible.oauthAccessToken);
  }
  return undefined;
}

function modelCapabilityDescriptors(config: MindoryConfig): ModelCapabilityDescriptor[] {
  return [
    descriptor("text-embedding", config.modelRuntime.textEmbedding),
    descriptor("image-embedding", config.modelRuntime.imageEmbedding),
    descriptor("image-captioning", config.modelRuntime.imageCaptioning),
    descriptor("ocr", config.modelRuntime.ocr),
    descriptor("asr", config.modelRuntime.asr),
    descriptor("face-detection", config.modelRuntime.faceDetection),
    descriptor("face-recognition", config.modelRuntime.faceRecognition)
  ];
}

function descriptor(
  capability: ModelCapability,
  config: {
    enabled: boolean;
    provider: ModelRuntimeProvider;
    model: string;
    required: boolean;
    dimensions?: number | null;
  }
): ModelCapabilityDescriptor {
  const descriptor: ModelCapabilityDescriptor = {
    capability,
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    required: config.required
  };
  if (config.dimensions !== undefined) {
    descriptor.dimensions = config.dimensions;
  }
  return descriptor;
}

function modelRuntimeProviders(config: MindoryConfig): ModelRuntimeProviderDescriptor[] {
  return [
    {
      provider: "openai-compatible",
      baseUrl: config.modelRuntime.openaiCompatible.baseUrl,
      authMode: config.modelRuntime.openaiCompatible.authMode
    },
    {
      provider: "ollama",
      baseUrl: config.modelRuntime.ollama.baseUrl
    },
    {
      provider: "local",
      baseUrl: config.modelRuntime.local.baseUrl
    }
  ];
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
