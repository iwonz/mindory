import {
  ProcessingError,
  type EmbeddingResult,
  type EmbeddingsProvider,
  type EmbedTextsInput
} from "@mindory/core/processing";

export interface OpenAICompatibleEmbeddingsOptions {
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  model: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

interface OpenAIEmbeddingResponse {
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
  model?: string;
}

export class OpenAICompatibleEmbeddingsProvider implements EmbeddingsProvider {
  readonly provider = "openai-compatible";
  readonly model: string;
  private readonly options: OpenAICompatibleEmbeddingsOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleEmbeddingsOptions) {
    this.options = options;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embedTexts(input: EmbedTextsInput): Promise<EmbeddingResult[]> {
    const model = input.model ?? this.model;
    const response = await this.fetchImpl(endpoint(this.options.baseUrl), {
      method: "POST",
      headers: headers(this.options.bearerToken ?? this.options.apiKey),
      body: JSON.stringify({
        model,
        input: input.texts,
        ...(this.options.dimensions ? { dimensions: this.options.dimensions } : {})
      })
    });

    if (!response.ok) {
      throw new ProcessingError("embedding_provider_error", `OpenAI-compatible embedding request failed with ${response.status}.`);
    }

    const body = await response.json() as OpenAIEmbeddingResponse;
    if (!Array.isArray(body.data)) {
      throw new ProcessingError("embedding_provider_error", "OpenAI-compatible embedding response did not include data.");
    }

    return body.data.map((item, index) => {
      if (!Array.isArray(item.embedding)) {
        throw new ProcessingError("embedding_provider_error", "OpenAI-compatible embedding response included an invalid embedding.");
      }
      return {
        textIndex: item.index ?? index,
        embedding: item.embedding,
        model: body.model ?? model,
        dimensions: item.embedding.length
      };
    });
  }
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/embeddings`;
}

function headers(apiKey: string | undefined): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
  };
}
