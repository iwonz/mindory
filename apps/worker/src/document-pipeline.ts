import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { MindoryConfig } from "@mindory/config";
import {
  planDocumentProcessingRoute,
  type DocumentProcessingRouteConfig
} from "@mindory/core/document-routing";
import type { DocumentRepository } from "@mindory/core/documents";
import {
  type ProcessingJobDispatcher,
  type ProcessingJobProcessor,
  type ProcessingJobProcessorRegistry,
  type ProcessingJobProcessorContext
} from "@mindory/core/queue";
import {
  FixedSizeTextChunker,
  ProcessingError,
  type DocumentChunkRepository,
  type EmbeddingsProvider,
  type TextChunk,
  type TextChunker,
  type TextExtractor,
  type VectorChunkEmbedding,
  type VectorIndex
} from "@mindory/core/processing";
import type { ObjectStorage } from "@mindory/core/storage";
import { BuiltinTextExtractor } from "@mindory/extractor-builtin-text";
import { buildMindoryTextEmbeddingsProvider } from "@mindory/model-runtime";
import { ClamAvDocumentScanProcessor, ClamAvScanner } from "@mindory/processor-antivirus-clamav";

export interface DocumentPipelineProcessorOptions {
  config: MindoryConfig;
  storage: ObjectStorage;
  documents: DocumentRepository;
  chunks: DocumentChunkRepository;
  jobs: ProcessingJobDispatcher;
  embeddings?: EmbeddingsProvider;
  vectorIndex?: VectorIndex;
  extractors?: TextExtractor[];
  chunker?: TextChunker;
  routeConfig?: DocumentProcessingRouteConfig;
}

export class DocumentPipelineProcessorRegistry implements ProcessingJobProcessorRegistry {
  private readonly processors: Map<string, ProcessingJobProcessor>;

  constructor(processors: ProcessingJobProcessor[]) {
    this.processors = new Map(processors.map((processor) => [processor.type, processor]));
  }

  getProcessor(type: string): ProcessingJobProcessor | undefined {
    return this.processors.get(type);
  }
}

export function buildDocumentPipelineProcessors(options: DocumentPipelineProcessorOptions): DocumentPipelineProcessorRegistry {
  const extractors = options.extractors ?? [new BuiltinTextExtractor()];
  const chunker = options.chunker ?? new FixedSizeTextChunker({
    maxTokens: 800,
    overlapTokens: 80,
    idFactory: () => `chunk_${randomUUID()}`
  });
  const extractProcessorVersion = "document-extract-v1";
  const routeProcessorVersion = "document-route-v1";
  const routeConfig = options.routeConfig ?? buildRouteConfig(options.config);

  const processors: ProcessingJobProcessor[] = [
    new DocumentRouteProcessor({
      storage: options.storage,
      documents: options.documents,
      jobs: options.jobs,
      routeConfig,
      processorVersion: routeProcessorVersion
    }),
    new DocumentExtractProcessor({
      storage: options.storage,
      documents: options.documents,
      jobs: options.jobs,
      extractors,
      nextProcessorVersion: chunker.version,
      processorVersion: extractProcessorVersion
    }),
    new DocumentChunkProcessor({
      storage: options.storage,
      documents: options.documents,
      chunks: options.chunks,
      jobs: options.jobs,
      chunker,
      enqueueEmbeddings: Boolean(options.embeddings),
      processorVersion: chunker.version
    }),
    new DocumentEmbedProcessor({
      storage: options.storage,
      documents: options.documents,
      chunks: options.chunks,
      jobs: options.jobs,
      embeddings: options.embeddings,
      processorVersion: options.embeddings ? `document-embed:${options.embeddings.provider}:${options.embeddings.model}` : "document-embed-disabled"
    }),
    new DocumentIndexProcessor({
      storage: options.storage,
      documents: options.documents,
      chunks: options.chunks,
      vectorIndex: options.vectorIndex,
      processorVersion: options.vectorIndex ? `document-index:${options.vectorIndex.provider}` : "document-index-disabled"
    })
  ];

  if (options.config.antivirus.enabled && options.config.antivirus.provider === "clamav") {
    processors.unshift(new ClamAvDocumentScanProcessor({
      storage: options.storage,
      documents: options.documents,
      jobs: options.jobs,
      scanner: new ClamAvScanner({
        host: options.config.antivirus.clamavHost,
        port: options.config.antivirus.clamavPort
      }),
      policy: {
        enabled: options.config.antivirus.enabled,
        provider: options.config.antivirus.provider,
        mode: options.config.antivirus.mode,
        onScanFailure: options.config.antivirus.onScanFailure,
        onInfected: options.config.antivirus.onInfected
      },
      nextProcessorVersion: routeProcessorVersion
    }));
  }

  return new DocumentPipelineProcessorRegistry(processors);
}

export function buildEmbeddingsProvider(config: MindoryConfig): EmbeddingsProvider | undefined {
  return buildMindoryTextEmbeddingsProvider(config);
}

class DocumentRouteProcessor implements ProcessingJobProcessor {
  readonly type = "document.route" as const;
  readonly processorVersion: string;
  private readonly storage: ObjectStorage;
  private readonly documents: DocumentRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly routeConfig: DocumentProcessingRouteConfig;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    jobs: ProcessingJobDispatcher;
    routeConfig: DocumentProcessingRouteConfig;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.jobs = options.jobs;
    this.routeConfig = options.routeConfig;
    this.processorVersion = options.processorVersion;
  }

  async process(context: ProcessingJobProcessorContext): Promise<void> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    if (["quarantined", "scan_infected"].includes(document.status)) {
      throw new ProcessingError("document_route_failed", `Document ${document.id} is not safe to route.`);
    }

    const object = await this.storage.getObject(document.storageKey);
    const plan = planDocumentProcessingRoute({
      document,
      config: this.routeConfig,
      magicBytes: await readFirstBytes(object.body, 512)
    });
    const metadata = {
      ...document.metadata,
      ...plan.metadata
    };
    const nextStatus = plan.jobs.some((job) => job.type === "document.extract") ? "extract_pending" : "scan_clean";
    await this.documents.updateDocumentStatus({
      projectId: document.projectId,
      documentId: document.id,
      status: nextStatus,
      metadata
    });

    for (const job of plan.jobs) {
      await this.jobs.createAndEnqueue(nextJob(context, {
        type: job.type,
        idempotencyKey: `${job.type}:${document.id}:${job.processorVersion}`,
        processorVersion: job.processorVersion,
        metadata: {
          ...job.metadata,
          storage_key: document.storageKey
        }
      }));
    }
  }
}

class DocumentExtractProcessor implements ProcessingJobProcessor {
  readonly type = "document.extract" as const;
  readonly processorVersion: string;
  private readonly storage: ObjectStorage;
  private readonly documents: DocumentRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly extractors: TextExtractor[];
  private readonly nextProcessorVersion: string;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    jobs: ProcessingJobDispatcher;
    extractors: TextExtractor[];
    nextProcessorVersion: string;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.jobs = options.jobs;
    this.extractors = options.extractors;
    this.nextProcessorVersion = options.nextProcessorVersion;
    this.processorVersion = options.processorVersion;
  }

  async process(context: ProcessingJobProcessorContext): Promise<void> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    if (["quarantined", "scan_infected"].includes(document.status)) {
      throw new ProcessingError("text_extraction_failed", `Document ${document.id} is not safe to extract.`);
    }

    const extractor = this.extractors.find((candidate) => candidate.supports(document));
    if (!extractor) {
      throw new ProcessingError("unsupported_document_type", `No extractor supports ${document.mimeType} (${document.originalFilename}).`);
    }

    const object = await this.storage.getObject(document.storageKey);
    const extracted = await extractor.extract({
      document,
      body: object.body
    });
    const extractedTextKey = derivedObjectKey(document.storageKey, "extracted.txt");
    await this.storage.putObject({
      key: extractedTextKey,
      body: extracted.text,
      contentType: "text/plain; charset=utf-8",
      metadata: {
        project_id: document.projectId,
        document_id: document.id,
        extractor: extractor.name,
        extractor_version: extractor.version
      }
    });

    await this.documents.updateDocumentStatus({
      projectId: document.projectId,
      documentId: document.id,
      status: "chunk_pending",
      metadata: {
        ...document.metadata,
        extraction: {
          extractor: extractor.name,
          extractor_version: extractor.version,
          extracted_text_key: extractedTextKey,
          ...extracted.metadata
        }
      }
    });

    await this.jobs.createAndEnqueue(nextJob(context, {
      type: "document.chunk",
      idempotencyKey: `document.chunk:${document.id}:${this.nextProcessorVersion}`,
      processorVersion: this.nextProcessorVersion,
      metadata: {
        extracted_text_key: extractedTextKey
      }
    }));
  }
}

class DocumentChunkProcessor implements ProcessingJobProcessor {
  readonly type = "document.chunk" as const;
  readonly processorVersion: string;
  private readonly storage: ObjectStorage;
  private readonly documents: DocumentRepository;
  private readonly chunks: DocumentChunkRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly chunker: TextChunker;
  private readonly enqueueEmbeddings: boolean;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    chunks: DocumentChunkRepository;
    jobs: ProcessingJobDispatcher;
    chunker: TextChunker;
    enqueueEmbeddings: boolean;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.chunks = options.chunks;
    this.jobs = options.jobs;
    this.chunker = options.chunker;
    this.enqueueEmbeddings = options.enqueueEmbeddings;
    this.processorVersion = options.processorVersion;
  }

  async process(context: ProcessingJobProcessorContext): Promise<void> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    const extractedTextKey = readMetadataString(context.payload.metadata, "extracted_text_key")
      ?? readMetadataString(document.metadata.extraction, "extracted_text_key");
    if (!extractedTextKey) {
      throw new ProcessingError("text_extraction_failed", `Document ${document.id} is missing extracted text metadata.`);
    }

    const extractedObject = await this.storage.getObject(extractedTextKey);
    const text = await readUtf8(extractedObject.body);
    const chunked = this.chunker.chunk({
      projectId: document.projectId,
      documentId: document.id,
      text,
      metadata: {
        chunker: this.chunker.name,
        chunker_version: this.chunker.version,
        extracted_text_key: extractedTextKey
      }
    }).map((chunk) => deterministicChunkId(document.id, chunk));

    await this.chunks.replaceDocumentChunks({
      projectId: document.projectId,
      documentId: document.id,
      chunks: chunked
    });

    await this.documents.updateDocumentStatus({
      projectId: document.projectId,
      documentId: document.id,
      status: this.enqueueEmbeddings && chunked.length > 0 ? "embed_pending" : "chunked",
      metadata: {
        ...document.metadata,
        chunking: {
          chunker: this.chunker.name,
          chunker_version: this.chunker.version,
          chunk_count: chunked.length
        }
      }
    });

    if (this.enqueueEmbeddings && chunked.length > 0) {
      await this.jobs.createAndEnqueue(nextJob(context, {
        type: "document.embed",
        idempotencyKey: `document.embed:${document.id}:${this.processorVersion}`,
        processorVersion: "document-embed-v1",
        metadata: {
          chunk_count: chunked.length
        }
      }));
    }
  }
}

class DocumentEmbedProcessor implements ProcessingJobProcessor {
  readonly type = "document.embed" as const;
  readonly processorVersion: string;
  private readonly storage: ObjectStorage;
  private readonly documents: DocumentRepository;
  private readonly chunks: DocumentChunkRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly embeddings: EmbeddingsProvider | undefined;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    chunks: DocumentChunkRepository;
    jobs: ProcessingJobDispatcher;
    embeddings: EmbeddingsProvider | undefined;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.chunks = options.chunks;
    this.jobs = options.jobs;
    this.embeddings = options.embeddings;
    this.processorVersion = options.processorVersion;
  }

  async process(context: ProcessingJobProcessorContext): Promise<void> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    if (!this.embeddings) {
      await this.documents.updateDocumentStatus({
        projectId: document.projectId,
        documentId: document.id,
        status: "chunked",
        metadata: {
          ...document.metadata,
          embeddings: {
            skipped: "disabled"
          }
        }
      });
      return;
    }

    const chunks = await this.chunks.listDocumentChunks(document.projectId, document.id);
    const results = await this.embeddings.embedTexts({
      texts: chunks.map((chunk) => chunk.content)
    });
    const embeddings: VectorChunkEmbedding[] = results.map((result) => {
      const chunk = chunks[result.textIndex];
      if (!chunk) {
        throw new ProcessingError("embedding_provider_error", "Embedding provider returned an out-of-range text index.");
      }
      return {
        projectId: chunk.projectId,
        documentId: chunk.documentId,
        chunkId: chunk.id,
        content: chunk.content,
        embedding: result.embedding,
        model: result.model,
        dimensions: result.dimensions,
        metadata: chunk.metadata
      };
    });
    const embeddingsKey = derivedObjectKey(document.storageKey, "embeddings.json");
    await this.storage.putObject({
      key: embeddingsKey,
      body: JSON.stringify(embeddings, null, 2),
      contentType: "application/json",
      metadata: {
        project_id: document.projectId,
        document_id: document.id,
        embeddings_provider: this.embeddings.provider,
        embeddings_model: this.embeddings.model
      }
    });

    await this.jobs.createAndEnqueue(nextJob(context, {
      type: "document.index",
      idempotencyKey: `document.index:${document.id}:${this.embeddings.provider}:${this.embeddings.model}`,
      processorVersion: "document-index-v1",
      metadata: {
        embeddings_key: embeddingsKey
      }
    }));
  }
}

class DocumentIndexProcessor implements ProcessingJobProcessor {
  readonly type = "document.index" as const;
  readonly processorVersion: string;
  private readonly storage: ObjectStorage;
  private readonly documents: DocumentRepository;
  private readonly chunks: DocumentChunkRepository;
  private readonly vectorIndex: VectorIndex | undefined;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    chunks: DocumentChunkRepository;
    vectorIndex: VectorIndex | undefined;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.chunks = options.chunks;
    this.vectorIndex = options.vectorIndex;
    this.processorVersion = options.processorVersion;
  }

  async process(context: ProcessingJobProcessorContext): Promise<void> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    if (!this.vectorIndex) {
      await this.documents.updateDocumentStatus({
        projectId: document.projectId,
        documentId: document.id,
        status: "chunked",
        metadata: {
          ...document.metadata,
          indexing: {
            skipped: "vector_index_not_configured"
          }
        }
      });
      return;
    }

    const embeddingsKey = readMetadataString(context.payload.metadata, "embeddings_key");
    if (!embeddingsKey) {
      throw new ProcessingError("vector_index_error", `Document ${document.id} is missing embeddings metadata.`);
    }
    const embeddingsObject = await this.storage.getObject(embeddingsKey);
    const embeddings = JSON.parse(await readUtf8(embeddingsObject.body)) as VectorChunkEmbedding[];
    const indexed = await this.vectorIndex.upsertDocumentChunks({ chunks: embeddings });
    await this.chunks.updateChunkEmbeddingIds(indexed.map((item) => ({
      chunkId: item.chunkId,
      embeddingId: item.embeddingId
    })));
    await this.documents.updateDocumentStatus({
      projectId: document.projectId,
      documentId: document.id,
      status: "indexed",
      metadata: {
        ...document.metadata,
        indexing: {
          provider: this.vectorIndex.provider,
          indexed_chunks: indexed.length
        }
      }
    });
  }
}

function nextJob(context: ProcessingJobProcessorContext, input: {
  type: "document.extract" | "document.chunk" | "document.embed" | "document.index";
  idempotencyKey: string;
  processorVersion: string;
  metadata?: Record<string, unknown>;
}): Parameters<ProcessingJobDispatcher["createAndEnqueue"]>[0] {
  return {
    projectId: context.payload.projectId,
    type: input.type,
    targetType: context.payload.targetType,
    targetId: context.payload.targetId,
    idempotencyKey: input.idempotencyKey,
    processorVersion: input.processorVersion,
    metadata: {
      ...(input.metadata ?? {}),
      previous_job_id: context.payload.jobId
    }
  };
}

function buildRouteConfig(config: MindoryConfig): DocumentProcessingRouteConfig {
  return {
    routingEnabled: config.documentProcessing.routingEnabled,
    text: config.documentProcessing.text,
    pdf: config.documentProcessing.pdf,
    image: config.documentProcessing.image,
    audio: config.documentProcessing.audio,
    video: config.documentProcessing.video
  };
}

function deterministicChunkId(documentId: string, chunk: TextChunk): TextChunk {
  return {
    ...chunk,
    id: `chunk_${documentId}_${chunk.index}`
  };
}

function derivedObjectKey(storageKey: string, suffix: string): string {
  return `${storageKey}.${suffix}`;
}

function readMetadataString(metadata: unknown, key: string): string | undefined {
  const record = typeof metadata === "object" && metadata !== null ? metadata as Record<string, unknown> : null;
  return record && typeof record[key] === "string"
    ? record[key]
    : undefined;
}

async function readUtf8(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readFirstBytes(stream: Readable, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    totalBytes += buffer.length;
    if (totalBytes >= maxBytes) {
      break;
    }
  }

  return Buffer.concat(chunks, Math.min(totalBytes, maxBytes)).subarray(0, maxBytes);
}
