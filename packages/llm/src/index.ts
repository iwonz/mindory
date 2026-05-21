import type { MindoryConfig } from "@mindory/config";
import type { EmbeddingsProvider } from "@mindory/core/processing";
import { OpenAICompatibleEmbeddingsProvider, type OpenAICompatibleEmbeddingsOptions } from "@mindory/embeddings-openai-compatible";
import { OllamaEmbeddingsProvider, type OllamaEmbeddingsOptions } from "@mindory/embeddings-ollama";

export interface MindoryLlmRuntime {
  provider: MindoryConfig["llm"]["provider"];
  embeddingModel: string;
  chatModel: string;
  embeddings?: EmbeddingsProvider;
}

export interface MindoryLlmRuntimeOptions {
  fetchImpl?: typeof fetch;
}

export function buildMindoryLlmRuntime(config: MindoryConfig, options: MindoryLlmRuntimeOptions = {}): MindoryLlmRuntime {
  const embeddings = buildMindoryEmbeddingsProvider(config, options);
  const runtime: MindoryLlmRuntime = {
    provider: config.llm.provider,
    embeddingModel: config.llm.embeddingModel,
    chatModel: config.llm.chatModel
  };
  if (embeddings) {
    runtime.embeddings = embeddings;
  }
  return runtime;
}

export function buildMindoryEmbeddingsProvider(config: MindoryConfig, options: MindoryLlmRuntimeOptions = {}): EmbeddingsProvider | undefined {
  if (config.llm.provider === "disabled") {
    return undefined;
  }

  if (config.llm.provider === "openai-compatible") {
    const providerOptions: OpenAICompatibleEmbeddingsOptions = {
      baseUrl: config.llm.openaiCompatible.baseUrl,
      model: config.llm.embeddingModel
    };
    const bearerToken = openAiCompatibleBearerToken(config);
    if (bearerToken !== undefined) {
      providerOptions.bearerToken = bearerToken;
    }
    if (config.llm.embeddingDimensions !== null) {
      providerOptions.dimensions = config.llm.embeddingDimensions;
    }
    if (options.fetchImpl !== undefined) {
      providerOptions.fetchImpl = options.fetchImpl;
    }
    return new OpenAICompatibleEmbeddingsProvider(providerOptions);
  }

  const providerOptions: OllamaEmbeddingsOptions = {
    baseUrl: config.llm.ollama.baseUrl,
    model: config.llm.embeddingModel
  };
  if (options.fetchImpl !== undefined) {
    providerOptions.fetchImpl = options.fetchImpl;
  }
  return new OllamaEmbeddingsProvider(providerOptions);
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

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
