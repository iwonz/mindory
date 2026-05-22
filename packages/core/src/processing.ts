import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { DocumentArtifactType, DocumentMetadataFilter } from "./artifacts.js";
import type { DocumentRecord } from "./documents.js";

export interface ExtractTextInput {
  document: DocumentRecord;
  body: Readable;
}

export interface ExtractedTextPage {
  pageNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
  width?: number | null;
  height?: number | null;
  ocr?: boolean;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ExtractedSemanticArtifact {
  artifactType: DocumentArtifactType;
  content: string;
  spanType?: string;
  artifactIndex?: number;
  sourcePosition?: Record<string, unknown>;
  modelProvider?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ExtractedFaceObservation {
  observationIndex?: number;
  content?: string;
  boundingBox: Record<string, unknown>;
  embedding?: number[] | null;
  model?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ExtractedTranscriptSegment {
  segmentIndex?: number;
  text: string;
  startMs: number;
  endMs: number;
  startOffset?: number;
  endOffset?: number;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ExtractedText {
  projectId: string;
  documentId: string;
  text: string;
  mimeType: string;
  metadata: Record<string, unknown>;
  pages?: ExtractedTextPage[];
  semanticArtifacts?: ExtractedSemanticArtifact[];
  faceObservations?: ExtractedFaceObservation[];
  transcriptSegments?: ExtractedTranscriptSegment[];
}

export interface TextExtractor {
  readonly name: string;
  readonly version: string;
  supports(document: Pick<DocumentRecord, "originalFilename" | "mimeType">): boolean;
  extract(input: ExtractTextInput): Promise<ExtractedText>;
}

export interface ChunkTextInput {
  projectId: string;
  documentId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface TextChunk {
  id: string;
  projectId: string;
  documentId: string;
  index: number;
  content: string;
  tokenCount: number;
  metadata: {
    start_offset: number;
    end_offset: number;
    [key: string]: unknown;
  };
}

export interface TextChunker {
  readonly name: string;
  readonly version: string;
  chunk(input: ChunkTextInput): TextChunk[];
}

export interface DocumentChunkRecord extends TextChunk {
  embeddingId: string | null;
  createdAt: Date;
}

export interface ReplaceDocumentChunksInput {
  projectId: string;
  documentId: string;
  chunks: TextChunk[];
}

export interface DocumentChunkRepository {
  replaceDocumentChunks(input: ReplaceDocumentChunksInput): Promise<DocumentChunkRecord[]>;
  listDocumentChunks(projectId: string, documentId: string): Promise<DocumentChunkRecord[]>;
  updateChunkEmbeddingIds(input: Array<{ chunkId: string; embeddingId: string }>): Promise<void>;
}

export interface FixedSizeTextChunkerOptions {
  maxTokens: number;
  overlapTokens: number;
  idFactory?: () => string;
}

export class FixedSizeTextChunker implements TextChunker {
  readonly name = "fixed-size-text";
  readonly version = "fixed-size-text-v1";
  private readonly maxTokens: number;
  private readonly overlapTokens: number;
  private readonly idFactory: () => string;

  constructor(options: FixedSizeTextChunkerOptions) {
    if (options.maxTokens <= 0) {
      throw new ProcessingError("invalid_chunker_config", "maxTokens must be greater than zero.");
    }
    if (options.overlapTokens < 0 || options.overlapTokens >= options.maxTokens) {
      throw new ProcessingError("invalid_chunker_config", "overlapTokens must be non-negative and smaller than maxTokens.");
    }

    this.maxTokens = options.maxTokens;
    this.overlapTokens = options.overlapTokens;
    this.idFactory = options.idFactory ?? (() => `chunk_${randomUUID()}`);
  }

  chunk(input: ChunkTextInput): TextChunk[] {
    const tokens = tokenizeWithOffsets(input.text);
    if (tokens.length === 0) {
      return [];
    }

    const chunks: TextChunk[] = [];
    const step = this.maxTokens - this.overlapTokens;

    for (let startToken = 0; startToken < tokens.length; startToken += step) {
      const chunkTokens = tokens.slice(startToken, startToken + this.maxTokens);
      if (chunkTokens.length === 0) {
        break;
      }

      const first = chunkTokens[0];
      const last = chunkTokens[chunkTokens.length - 1];
      if (!first || !last) {
        break;
      }

      chunks.push({
        id: this.idFactory(),
        projectId: input.projectId,
        documentId: input.documentId,
        index: chunks.length,
        content: input.text.slice(first.startOffset, last.endOffset),
        tokenCount: chunkTokens.length,
        metadata: {
          ...(input.metadata ?? {}),
          start_offset: first.startOffset,
          end_offset: last.endOffset
        }
      });

      if (startToken + this.maxTokens >= tokens.length) {
        break;
      }
    }

    return chunks;
  }
}

interface TokenWithOffset {
  startOffset: number;
  endOffset: number;
}

function tokenizeWithOffsets(text: string): TokenWithOffset[] {
  const tokens: TokenWithOffset[] = [];
  const expression = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(text)) !== null) {
    tokens.push({
      startOffset: match.index,
      endOffset: match.index + match[0].length
    });
  }

  return tokens;
}

export interface EmbedTextsInput {
  texts: string[];
  model?: string;
}

export interface EmbeddingResult {
  textIndex: number;
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface EmbeddingsProvider {
  readonly provider: string;
  readonly model: string;
  embedTexts(input: EmbedTextsInput): Promise<EmbeddingResult[]>;
}

export interface VectorChunkEmbedding {
  projectId: string;
  documentId: string;
  chunkId: string;
  content: string;
  embedding: number[];
  model: string;
  dimensions: number;
  metadata: Record<string, unknown>;
}

export interface UpsertVectorChunksInput {
  chunks: VectorChunkEmbedding[];
}

export interface VectorIndexResult {
  embeddingId: string;
  chunkId: string;
}

export interface SearchVectorChunksInput {
  projectIds: string[];
  embedding: number[];
  limit: number;
  metadataFilters?: DocumentMetadataFilter[];
}

export interface VectorSearchHit {
  projectId: string;
  documentId: string;
  chunkId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorIndex {
  readonly provider: string;
  upsertDocumentChunks(input: UpsertVectorChunksInput): Promise<VectorIndexResult[]>;
  deleteDocumentChunks(projectId: string, documentId: string): Promise<void>;
  searchDocumentChunks(input: SearchVectorChunksInput): Promise<VectorSearchHit[]>;
}

export type ProcessingErrorCode =
  | "blocked_by_scan"
  | "document_recompute_failed"
  | "document_route_failed"
  | "embedding_provider_error"
  | "invalid_chunker_config"
  | "text_extraction_failed"
  | "unsupported_document_type"
  | "vector_index_error";

export class ProcessingError extends Error {
  readonly code: ProcessingErrorCode;
  readonly cause?: unknown;

  constructor(code: ProcessingErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ProcessingError";
    this.code = code;
    this.cause = cause;
  }
}
