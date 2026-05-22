import { createHash } from "node:crypto";
import type { DocumentMetadataFilter } from "@mindory/core/artifacts";
import {
  ProcessingError,
  type EmbeddingsProvider,
  type SearchVectorChunksInput,
  type UpsertVectorChunksInput,
  type VectorIndex,
  type VectorIndexResult,
  type VectorSearchHit
} from "@mindory/core/processing";
import type { DocumentChunkSearchHit, DocumentChunkSearchInput, DocumentChunkSearchRepository, SourceRef } from "@mindory/core/memory";

export interface QdrantVectorIndexOptions {
  url: string;
  collectionPrefix: string;
  dimensions: number;
  collectionName?: string;
  distance?: QdrantDistance;
  fetch?: FetchLike;
}

export type QdrantDistance = "Cosine" | "Dot" | "Euclid" | "Manhattan";

export interface QdrantHealthcheckResult {
  ok: boolean;
  url: string;
  collectionName: string;
  dimensions: number;
}

export interface QdrantDocumentChunkSearchRepositoryOptions {
  embeddings: EmbeddingsProvider;
  vectorIndex: QdrantVectorIndex;
}

type FetchLike = (url: string, init?: FetchInitLike) => Promise<ResponseLike>;

interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: QdrantPayload;
}

interface QdrantPayload {
  project_id: string;
  document_id: string;
  chunk_id: string;
  content: string;
  model: string;
  dimensions: number;
  metadata: Record<string, unknown>;
  source_refs?: unknown;
  [key: `metadata.${string}`]: unknown;
}

interface QdrantSearchResult {
  id?: string | number;
  score?: number;
  payload?: unknown;
}

interface QdrantFilter {
  must: QdrantFilterCondition[];
}

type QdrantFilterCondition =
  | {
      key: string;
      match: {
        value?: string | number | boolean;
        any?: string[];
      };
    }
  | {
      key: string;
      range: {
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
      };
    };

const defaultDistance: QdrantDistance = "Cosine";

export class QdrantVectorIndex implements VectorIndex {
  readonly provider = "qdrant";
  readonly url: string;
  readonly collectionPrefix: string;
  readonly collectionName: string;
  readonly dimensions: number;
  readonly distance: QdrantDistance;
  private readonly fetchImpl: FetchLike;
  private collectionReady = false;

  constructor(options: QdrantVectorIndexOptions) {
    if (options.dimensions <= 0) {
      throw new ProcessingError("vector_index_error", "Qdrant dimensions must be greater than zero.");
    }

    this.url = normalizeUrl(options.url);
    this.collectionPrefix = options.collectionPrefix;
    this.collectionName = options.collectionName ?? `${sanitizeCollectionSegment(options.collectionPrefix)}_document_chunks`;
    this.dimensions = options.dimensions;
    this.distance = options.distance ?? defaultDistance;
    this.fetchImpl = options.fetch ?? readGlobalFetch();
  }

  async healthcheck(): Promise<QdrantHealthcheckResult> {
    await this.requestText("/healthz", { method: "GET" });
    await this.ensureCollection();
    return {
      ok: true,
      url: this.url,
      collectionName: this.collectionName,
      dimensions: this.dimensions
    };
  }

  async upsertDocumentChunks(input: UpsertVectorChunksInput): Promise<VectorIndexResult[]> {
    if (input.chunks.length === 0) {
      return [];
    }

    for (const chunk of input.chunks) {
      validateDimensions(chunk.embedding, this.dimensions);
    }

    await this.ensureCollection();
    const points = input.chunks.map((chunk): QdrantPoint => ({
      id: pointIdForChunk(chunk.projectId, chunk.documentId, chunk.chunkId),
      vector: chunk.embedding,
      payload: flattenPayload({
        project_id: chunk.projectId,
        document_id: chunk.documentId,
        chunk_id: chunk.chunkId,
        content: chunk.content,
        model: chunk.model,
        dimensions: chunk.dimensions,
        metadata: chunk.metadata,
        source_refs: chunk.metadata.source_refs
      })
    }));

    await this.requestJson(collectionPath(this.collectionName, "/points?wait=true"), {
      method: "PUT",
      body: { points }
    });

    return points.map((point) => ({
      embeddingId: point.id,
      chunkId: point.payload.chunk_id
    }));
  }

  async deleteDocumentChunks(projectId: string, documentId: string): Promise<void> {
    await this.ensureCollection();
    await this.requestJson(collectionPath(this.collectionName, "/points/delete?wait=true"), {
      method: "POST",
      body: {
        filter: {
          must: [
            matchValue("project_id", projectId),
            matchValue("document_id", documentId)
          ]
        }
      }
    });
  }

  async searchDocumentChunks(input: SearchVectorChunksInput): Promise<VectorSearchHit[]> {
    if (input.projectIds.length === 0) {
      return [];
    }
    validateDimensions(input.embedding, this.dimensions);

    await this.ensureCollection();
    const response = await this.requestJson(collectionPath(this.collectionName, "/points/search"), {
      method: "POST",
      body: {
        vector: input.embedding,
        limit: input.limit,
        with_payload: true,
        with_vector: false,
        filter: buildSearchFilter(input.projectIds, input.metadataFilters)
      }
    });

    const results = readArray(readObject(response).result);
    return results.map((item) => toVectorSearchHit(item)).filter((hit): hit is VectorSearchHit => hit !== null);
  }

  async ensureCollection(): Promise<void> {
    if (this.collectionReady) {
      return;
    }

    const existing = await this.getCollection();
    if (existing === null) {
      await this.createCollection();
      this.collectionReady = true;
      return;
    }

    validateCollection(existing, this.collectionName, this.dimensions);
    this.collectionReady = true;
  }

  private async getCollection(): Promise<Record<string, unknown> | null> {
    const response = await this.fetchImpl(this.absoluteUrl(collectionPath(this.collectionName)), { method: "GET" });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw await qdrantHttpError(response, `Qdrant collection lookup failed for ${this.collectionName}.`);
    }
    return readObject(await response.json());
  }

  private async createCollection(): Promise<void> {
    await this.requestJson(collectionPath(this.collectionName), {
      method: "PUT",
      body: {
        vectors: {
          size: this.dimensions,
          distance: this.distance
        }
      }
    });
  }

  private async requestJson(pathname: string, input: { method: string; body?: unknown }): Promise<Record<string, unknown>> {
    const init: FetchInitLike = {
      method: input.method,
      headers: {
        "content-type": "application/json"
      }
    };
    if (input.body !== undefined) {
      init.body = JSON.stringify(input.body);
    }

    const response = await this.fetchImpl(this.absoluteUrl(pathname), init);
    if (!response.ok) {
      throw await qdrantHttpError(response, `Qdrant request failed: ${input.method} ${pathname}.`);
    }
    return readObject(await response.json());
  }

  private async requestText(pathname: string, input: { method: string }): Promise<string> {
    const response = await this.fetchImpl(this.absoluteUrl(pathname), { method: input.method });
    if (!response.ok) {
      throw await qdrantHttpError(response, `Qdrant request failed: ${input.method} ${pathname}.`);
    }
    return response.text();
  }

  private absoluteUrl(pathname: string): string {
    return `${this.url}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }
}

export class QdrantDocumentChunkSearchRepository implements DocumentChunkSearchRepository {
  private readonly embeddings: EmbeddingsProvider;
  private readonly vectorIndex: QdrantVectorIndex;

  constructor(options: QdrantDocumentChunkSearchRepositoryOptions) {
    this.embeddings = options.embeddings;
    this.vectorIndex = options.vectorIndex;
  }

  async searchDocumentChunks(input: DocumentChunkSearchInput): Promise<DocumentChunkSearchHit[]> {
    if (!input.query) {
      return [];
    }

    const [embedding] = await this.embeddings.embedTexts({
      texts: [input.query]
    });
    if (!embedding) {
      throw new ProcessingError("embedding_provider_error", "Embedding provider returned no query embedding.");
    }

    const searchInput: SearchVectorChunksInput = {
      projectIds: input.projectIds,
      embedding: embedding.embedding,
      limit: input.limit
    };
    if (input.metadataFilters !== undefined) {
      searchInput.metadataFilters = input.metadataFilters;
    }

    return (await this.vectorIndex.searchDocumentChunks(searchInput)).map((hit) => {
      const sourceRefs = readSourceRefs(hit.metadata.source_refs, [{ type: "chunk", id: hit.chunkId }]);
      return {
        projectId: hit.projectId,
        documentId: hit.documentId,
        chunkId: hit.chunkId,
        content: hit.content,
        score: hit.score,
        sourceRefs,
        metadata: {
          ...hit.metadata,
          search_backend: "qdrant",
          source_refs: sourceRefs
        }
      };
    });
  }
}

function buildSearchFilter(projectIds: string[], metadataFilters: DocumentMetadataFilter[] | undefined): QdrantFilter {
  const must: QdrantFilterCondition[] = [
    {
      key: "project_id",
      match: {
        any: projectIds
      }
    }
  ];

  for (const filter of metadataFilters ?? []) {
    const condition = metadataFilterCondition(filter);
    if (condition) {
      must.push(condition);
    }
  }

  return { must };
}

function metadataFilterCondition(filter: DocumentMetadataFilter): QdrantFilterCondition | null {
  const key = `metadata.${filter.key}`;
  const operator = filter.operator ?? "eq";

  if (operator === "eq") {
    const value = metadataFilterScalarValue(filter);
    return value === undefined ? null : matchValue(key, value);
  }

  const range: { lt?: number; lte?: number; gt?: number; gte?: number } = {};
  if (operator === "lt" && filter.valueNumber !== undefined) {
    range.lt = filter.valueNumber;
  }
  if (operator === "lte" && filter.valueNumber !== undefined) {
    range.lte = filter.valueNumber;
  }
  if (operator === "gt" && filter.valueNumber !== undefined) {
    range.gt = filter.valueNumber;
  }
  if (operator === "gte" && filter.valueNumber !== undefined) {
    range.gte = filter.valueNumber;
  }
  if (operator === "between") {
    if (filter.minNumber !== undefined) {
      range.gte = filter.minNumber;
    }
    if (filter.maxNumber !== undefined) {
      range.lte = filter.maxNumber;
    }
  }

  return Object.keys(range).length === 0 ? null : { key, range };
}

function metadataFilterScalarValue(filter: DocumentMetadataFilter): string | number | boolean | undefined {
  if (filter.valueText !== undefined) {
    return filter.valueText;
  }
  if (filter.valueNumber !== undefined) {
    return filter.valueNumber;
  }
  if (filter.valueBoolean !== undefined) {
    return filter.valueBoolean;
  }
  if (filter.valueTimestamp !== undefined) {
    return filter.valueTimestamp;
  }
  return undefined;
}

function matchValue(key: string, value: string | number | boolean): QdrantFilterCondition {
  return {
    key,
    match: {
      value
    }
  };
}

function flattenPayload(payload: QdrantPayload): QdrantPayload {
  const flattened: QdrantPayload = { ...payload };
  for (const [key, value] of Object.entries(payload.metadata)) {
    flattened[`metadata.${key}`] = value;
  }
  return flattened;
}

function toVectorSearchHit(value: unknown): VectorSearchHit | null {
  const result = readObject(value) as QdrantSearchResult;
  const payload = readObject(result.payload);
  const projectId = readString(payload.project_id);
  const documentId = readString(payload.document_id);
  const chunkId = readString(payload.chunk_id);
  const content = readString(payload.content);
  if (!projectId || !documentId || !chunkId || !content) {
    return null;
  }

  return {
    projectId,
    documentId,
    chunkId,
    content,
    score: typeof result.score === "number" ? result.score : 0,
    metadata: readMetadata(payload.metadata)
  };
}

function validateCollection(response: Record<string, unknown>, collectionName: string, dimensions: number): void {
  const result = readObject(response.result);
  const config = readObject(result.config);
  const params = readObject(config.params);
  const vectors = readObject(params.vectors);
  const actualSize = typeof vectors.size === "number" ? vectors.size : null;
  if (actualSize !== null && actualSize !== dimensions) {
    throw new ProcessingError(
      "vector_index_error",
      `Qdrant collection ${collectionName} has dimensions ${actualSize}, expected ${dimensions}.`
    );
  }
}

function validateDimensions(embedding: number[], dimensions: number): void {
  if (embedding.length !== dimensions) {
    throw new ProcessingError(
      "vector_index_error",
      `Expected embedding dimensions ${dimensions}, received ${embedding.length}.`
    );
  }
}

function pointIdForChunk(projectId: string, documentId: string, chunkId: string): string {
  const digest = createHash("sha256").update(`${projectId}\0${documentId}\0${chunkId}`, "utf8").digest("hex");
  const versioned = `${digest.slice(0, 12)}4${digest.slice(13, 16)}${variantNibble(digest[16])}${digest.slice(17, 32)}`;
  return [
    versioned.slice(0, 8),
    versioned.slice(8, 12),
    versioned.slice(12, 16),
    versioned.slice(16, 20),
    versioned.slice(20, 32)
  ].join("-");
}

function variantNibble(value: string | undefined): string {
  const parsed = Number.parseInt(value ?? "0", 16);
  return ((parsed & 0x3) | 0x8).toString(16);
}

function collectionPath(collectionName: string, suffix = ""): string {
  return `/collections/${encodeURIComponent(collectionName)}${suffix}`;
}

function sanitizeCollectionSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "mindory";
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ProcessingError("vector_index_error", "Qdrant URL is required.");
  }
  return trimmed.replace(/\/+$/g, "");
}

function readGlobalFetch(): FetchLike {
  if (typeof globalThis.fetch !== "function") {
    throw new ProcessingError("vector_index_error", "Qdrant adapter requires a fetch implementation.");
  }
  return globalThis.fetch as FetchLike;
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readMetadata(value: unknown): Record<string, unknown> {
  return readObject(value);
}

function readSourceRefs(value: unknown, fallback: SourceRef[]): SourceRef[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const sourceRefs = value.filter((item): item is SourceRef => (
    typeof item === "object"
    && item !== null
    && "type" in item
    && "id" in item
    && typeof item.type === "string"
    && typeof item.id === "string"
  ));
  return sourceRefs.length > 0 ? sourceRefs : fallback;
}

async function qdrantHttpError(response: ResponseLike, fallback: string): Promise<ProcessingError> {
  let detail = "";
  try {
    detail = await response.text();
  } catch {
    detail = "";
  }
  const suffix = detail ? ` ${detail.slice(0, 500)}` : "";
  return new ProcessingError("vector_index_error", `${fallback} HTTP ${response.status} ${response.statusText}.${suffix}`);
}
