import {
  ProcessingError,
  type EmbeddingResult,
  type EmbeddingsProvider,
  type EmbedTextsInput
} from "@mindory/core/processing";

export interface OllamaEmbeddingsOptions {
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}

interface OllamaEmbedResponse {
  model?: string;
  embeddings?: number[][];
}

export class OllamaEmbeddingsProvider implements EmbeddingsProvider {
  readonly provider = "ollama";
  readonly model: string;
  private readonly options: OllamaEmbeddingsOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaEmbeddingsOptions) {
    this.options = options;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embedTexts(input: EmbedTextsInput): Promise<EmbeddingResult[]> {
    const model = input.model ?? this.model;
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: input.texts
      })
    });

    if (!response.ok) {
      throw new ProcessingError("embedding_provider_error", `Ollama embedding request failed with ${response.status}.`);
    }

    const body = await response.json() as OllamaEmbedResponse;
    if (!Array.isArray(body.embeddings)) {
      throw new ProcessingError("embedding_provider_error", "Ollama embedding response did not include embeddings.");
    }

    return body.embeddings.map((embedding, index) => {
      if (!Array.isArray(embedding)) {
        throw new ProcessingError("embedding_provider_error", "Ollama embedding response included an invalid embedding.");
      }
      return {
        textIndex: index,
        embedding,
        model: body.model ?? model,
        dimensions: embedding.length
      };
    });
  }
}
