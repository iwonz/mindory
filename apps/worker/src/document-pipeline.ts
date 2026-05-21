import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { MindoryConfig } from "@mindory/config";
import type { DerivedArtifactRepository } from "@mindory/core/artifacts";
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
  buildDocumentRecomputeFingerprint,
  DOCUMENT_RECOMPUTE_PROCESSOR_VERSION,
  normalizeDocumentRecomputeStages
} from "@mindory/core/recompute";
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
  artifacts: DerivedArtifactRepository;
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
    new DocumentRecomputeProcessor({
      storage: options.storage,
      documents: options.documents,
      artifacts: options.artifacts,
      jobs: options.jobs,
      routeConfig,
      routeProcessorVersion,
      processorVersion: DOCUMENT_RECOMPUTE_PROCESSOR_VERSION,
      modelRuntimeFingerprint: buildDocumentRecomputeFingerprint(options.config.modelRuntime)
    }),
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
      artifacts: options.artifacts,
      jobs: options.jobs,
      extractors,
      nextProcessorVersion: chunker.version,
      processorVersion: extractProcessorVersion
    }),
    new DocumentChunkProcessor({
      storage: options.storage,
      documents: options.documents,
      artifacts: options.artifacts,
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
      artifacts: options.artifacts,
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

class DocumentRecomputeProcessor implements ProcessingJobProcessor {
  readonly type = "document.recompute" as const;
  readonly processorVersion: string;
  private readonly storage: ObjectStorage;
  private readonly documents: DocumentRepository;
  private readonly artifacts: DerivedArtifactRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly routeConfig: DocumentProcessingRouteConfig;
  private readonly routeProcessorVersion: string;
  private readonly modelRuntimeFingerprint: string;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    artifacts: DerivedArtifactRepository;
    jobs: ProcessingJobDispatcher;
    routeConfig: DocumentProcessingRouteConfig;
    routeProcessorVersion: string;
    processorVersion: string;
    modelRuntimeFingerprint: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.artifacts = options.artifacts;
    this.jobs = options.jobs;
    this.routeConfig = options.routeConfig;
    this.routeProcessorVersion = options.routeProcessorVersion;
    this.processorVersion = options.processorVersion;
    this.modelRuntimeFingerprint = options.modelRuntimeFingerprint;
  }

  async process(context: ProcessingJobProcessorContext): Promise<void> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    if (["quarantined", "scan_infected"].includes(document.status)) {
      throw new ProcessingError("document_recompute_failed", `Document ${document.id} is not safe to recompute.`);
    }

    const stages = normalizeDocumentRecomputeStages(readMetadataStringArray(context.payload.metadata, "stages"));
    const processingRunId = readMetadataString(context.payload.metadata, "processing_run_id") ?? `run_${context.payload.jobId}`;
    const recomputeRequestId = readMetadataString(context.payload.metadata, "recompute_request_id") ?? context.payload.jobId;
    const reason = readMetadataString(context.payload.metadata, "reason") ?? "manual_recompute";
    const rawObject = await this.storage.getObject(document.storageKey);
    const rawBytes = await readAllBytes(rawObject.body);
    const stage = stages.length === 1 ? stages[0] : "all";
    const configFingerprint = buildDocumentRecomputeFingerprint({
      routeConfig: this.routeConfig,
      stage,
      stages
    });
    let runCreated = false;

    try {
      const run = await this.artifacts.createProcessingRun({
        id: processingRunId,
        projectId: document.projectId,
        documentId: document.id,
        reason,
        processorVersion: this.processorVersion,
        configFingerprint,
        modelRuntimeFingerprint: this.modelRuntimeFingerprint,
        sourceDocumentStorageKey: document.storageKey,
        sourceDocumentChecksum: sha256Hex(rawBytes),
        metadata: {
          ...context.payload.metadata,
          stage,
          stages,
          recompute_request_id: recomputeRequestId,
          raw_original_unchanged: true
        }
      });
      runCreated = true;

      const supersededRuns = await this.artifacts.supersedeDocumentProcessingRuns({
        projectId: document.projectId,
        documentId: document.id,
        stages,
        excludeRunId: run.id,
        supersededByRunId: run.id,
        reason: "recompute_replaced_derived_state"
      });
      const routeJob = await this.jobs.createAndEnqueue({
        projectId: document.projectId,
        type: "document.route",
        targetType: "document",
        targetId: document.id,
        idempotencyKey: `document.route:${document.id}:${this.routeProcessorVersion}:${run.id}`,
        processorVersion: this.routeProcessorVersion,
        metadata: {
          previous_job_id: context.payload.jobId,
          processing_run_id: run.id,
          recompute_request_id: recomputeRequestId,
          stages,
          storage_key: document.storageKey
        }
      });

      await this.artifacts.updateProcessingRunStatus({
        projectId: document.projectId,
        runId: run.id,
        status: "succeeded",
        finishedAt: new Date(),
        metadata: {
          ...run.metadata,
          superseded_runs: supersededRuns,
          queued_jobs: [{
            type: "document.route",
            processing_job_id: routeJob.processingJobId,
            queue_job_id: routeJob.queueJobId
          }],
          raw_original_unchanged: true
        }
      });
    } catch (error) {
      if (runCreated) {
        await this.artifacts.updateProcessingRunStatus({
          projectId: document.projectId,
          runId: processingRunId,
          status: "failed",
          finishedAt: new Date(),
          metadata: {
            failed_error: error instanceof Error ? error.message : String(error),
            recompute_request_id: recomputeRequestId,
            stage,
            stages,
            raw_original_unchanged: true
          }
        });
      }
      throw error;
    }
  }
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
    const processingRunId = readMetadataString(context.payload.metadata, "processing_run_id");
    const routingMetadata = plan.metadata.routing && typeof plan.metadata.routing === "object"
      ? plan.metadata.routing as Record<string, unknown>
      : {};
    const metadata = {
      ...document.metadata,
      ...plan.metadata,
      routing: {
        ...routingMetadata,
        ...(processingRunId ? { processing_run_id: processingRunId } : {})
      }
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
        idempotencyKey: withProcessingRunId(`${job.type}:${document.id}:${job.processorVersion}`, processingRunId),
        processorVersion: job.processorVersion,
        metadata: {
          ...job.metadata,
          ...(processingRunId ? { processing_run_id: processingRunId } : {}),
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
  private readonly artifacts: DerivedArtifactRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly extractors: TextExtractor[];
  private readonly nextProcessorVersion: string;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    artifacts: DerivedArtifactRepository;
    jobs: ProcessingJobDispatcher;
    extractors: TextExtractor[];
    nextProcessorVersion: string;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.artifacts = options.artifacts;
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
    const rawBytes = await readAllBytes(object.body);
    const extracted = await extractor.extract({
      document,
      body: Readable.from(rawBytes)
    });
    const incomingProcessingRunId = readMetadataString(context.payload.metadata, "processing_run_id");
    const processingRunId = incomingProcessingRunId
      ?? deterministicProcessingRunId(document.id, "text", sha256Hex(rawBytes));
    const configFingerprint = buildDocumentRecomputeFingerprint({
      extractor: extractor.name,
      extractorVersion: extractor.version,
      processorVersion: this.processorVersion,
      stage: "text"
    });
    if (!incomingProcessingRunId) {
      await this.artifacts.createProcessingRun({
        id: processingRunId,
        projectId: document.projectId,
        documentId: document.id,
        reason: "text_pipeline",
        processorVersion: this.processorVersion,
        configFingerprint,
        sourceDocumentStorageKey: document.storageKey,
        sourceDocumentChecksum: sha256Hex(rawBytes),
        metadata: {
          stage: "text",
          extractor: extractor.name,
          extractor_version: extractor.version,
          created_by: "document.extract"
        }
      });
    }
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
    const textArtifactId = deterministicArtifactId(processingRunId, "text", 0);
    const textSpanId = deterministicTextSpanId(textArtifactId, 0);
    await this.artifacts.createDocumentArtifact({
      id: textArtifactId,
      projectId: document.projectId,
      documentId: document.id,
      processingRunId,
      artifactType: "text",
      artifactIndex: 0,
      storageKey: extractedTextKey,
      contentHash: sha256Hex(Buffer.from(extracted.text, "utf8")),
      sourceRefs: [
        { type: "document", id: document.id },
        { type: "processing_run", id: processingRunId }
      ],
      source: document.source,
      sourcePosition: {
        start_offset: 0,
        end_offset: extracted.text.length
      },
      configFingerprint,
      metadata: {
        extractor: extractor.name,
        extractor_version: extractor.version,
        extracted_text_key: extractedTextKey,
        ...extracted.metadata
      }
    });
    await this.artifacts.replaceDocumentArtifactTextSpans({
      projectId: document.projectId,
      documentId: document.id,
      artifactId: textArtifactId,
      spans: [{
        id: textSpanId,
        projectId: document.projectId,
        documentId: document.id,
        artifactId: textArtifactId,
        spanType: "extracted_text",
        content: extracted.text,
        startOffset: 0,
        endOffset: extracted.text.length,
        metadata: {
          processing_run_id: processingRunId,
          artifact_id: textArtifactId,
          extractor: extractor.name,
          extractor_version: extractor.version,
          source_refs: [
            { type: "document", id: document.id },
            { type: "processing_run", id: processingRunId },
            { type: "artifact", id: textArtifactId }
          ]
        }
      }]
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
          processing_run_id: processingRunId,
          text_artifact_id: textArtifactId,
          ...extracted.metadata
        }
      }
    });

    await this.jobs.createAndEnqueue(nextJob(context, {
      type: "document.chunk",
      idempotencyKey: withProcessingRunId(`document.chunk:${document.id}:${this.nextProcessorVersion}`, readMetadataString(context.payload.metadata, "processing_run_id")),
      processorVersion: this.nextProcessorVersion,
      metadata: {
        extracted_text_key: extractedTextKey,
        text_artifact_id: textArtifactId
      }
    }));
  }
}

class DocumentChunkProcessor implements ProcessingJobProcessor {
  readonly type = "document.chunk" as const;
  readonly processorVersion: string;
  private readonly storage: ObjectStorage;
  private readonly documents: DocumentRepository;
  private readonly artifacts: DerivedArtifactRepository;
  private readonly chunks: DocumentChunkRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly chunker: TextChunker;
  private readonly enqueueEmbeddings: boolean;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    artifacts: DerivedArtifactRepository;
    chunks: DocumentChunkRepository;
    jobs: ProcessingJobDispatcher;
    chunker: TextChunker;
    enqueueEmbeddings: boolean;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.artifacts = options.artifacts;
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
    const processingRunId = readMetadataString(context.payload.metadata, "processing_run_id")
      ?? readMetadataString(document.metadata.extraction, "processing_run_id");
    const textArtifactId = readMetadataString(context.payload.metadata, "text_artifact_id")
      ?? readMetadataString(document.metadata.extraction, "text_artifact_id");
    if (!extractedTextKey) {
      throw new ProcessingError("text_extraction_failed", `Document ${document.id} is missing extracted text metadata.`);
    }
    if (!processingRunId || !textArtifactId) {
      throw new ProcessingError("text_extraction_failed", `Document ${document.id} is missing text artifact metadata.`);
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
        extracted_text_key: extractedTextKey,
        processing_run_id: processingRunId,
        text_artifact_id: textArtifactId
      }
    }).map((chunk) => deterministicChunkId(document.id, chunk))
      .map((chunk) => enrichChunkWithArtifactRefs(chunk, processingRunId, textArtifactId));

    await this.chunks.replaceDocumentChunks({
      projectId: document.projectId,
      documentId: document.id,
      chunks: chunked
    });
    for (const chunk of chunked) {
      const artifactId = readMetadataString(chunk.metadata, "artifact_id");
      const spanId = readMetadataString(chunk.metadata, "text_span_id");
      if (!artifactId || !spanId) {
        throw new ProcessingError("text_extraction_failed", `Chunk ${chunk.id} is missing artifact metadata.`);
      }
      await this.artifacts.createDocumentArtifact({
        id: artifactId,
        projectId: chunk.projectId,
        documentId: chunk.documentId,
        processingRunId,
        parentArtifactId: textArtifactId,
        artifactType: "text",
        artifactIndex: chunk.index + 1,
        content: chunk.content,
        contentHash: sha256Hex(Buffer.from(chunk.content, "utf8")),
        sourceRefs: [
          { type: "document", id: document.id },
          { type: "processing_run", id: processingRunId },
          { type: "artifact", id: textArtifactId },
          { type: "chunk", id: chunk.id }
        ],
        source: document.source,
        sourcePosition: {
          start_offset: chunk.metadata.start_offset,
          end_offset: chunk.metadata.end_offset
        },
        configFingerprint: buildDocumentRecomputeFingerprint({
          chunker: this.chunker.name,
          chunkerVersion: this.chunker.version,
          stage: "text"
        }),
        metadata: {
          ...chunk.metadata,
          chunk_id: chunk.id,
          token_count: chunk.tokenCount
        }
      });
      await this.artifacts.replaceDocumentArtifactTextSpans({
        projectId: chunk.projectId,
        documentId: chunk.documentId,
        artifactId,
        spans: [{
          id: spanId,
          projectId: chunk.projectId,
          documentId: chunk.documentId,
          artifactId,
          spanType: "text_chunk",
          content: chunk.content,
          startOffset: chunk.metadata.start_offset,
          endOffset: chunk.metadata.end_offset,
          metadata: {
            ...chunk.metadata,
            chunk_id: chunk.id,
            artifact_id: artifactId,
            text_artifact_id: textArtifactId,
            processing_run_id: processingRunId
          }
        }]
      });
    }

    await this.documents.updateDocumentStatus({
      projectId: document.projectId,
      documentId: document.id,
      status: this.enqueueEmbeddings && chunked.length > 0 ? "embed_pending" : "chunked",
      metadata: {
        ...document.metadata,
        chunking: {
          chunker: this.chunker.name,
          chunker_version: this.chunker.version,
          chunk_count: chunked.length,
          processing_run_id: processingRunId,
          text_artifact_id: textArtifactId,
          artifact_model: "document_artifacts_v1"
        }
      }
    });

    if (this.enqueueEmbeddings && chunked.length > 0) {
      await this.jobs.createAndEnqueue(nextJob(context, {
        type: "document.embed",
        idempotencyKey: withProcessingRunId(`document.embed:${document.id}:${this.processorVersion}`, readMetadataString(context.payload.metadata, "processing_run_id")),
        processorVersion: "document-embed-v1",
        metadata: {
          chunk_count: chunked.length
        }
      }));
    } else {
      await this.artifacts.updateProcessingRunStatus({
        projectId: document.projectId,
        runId: processingRunId,
        status: "succeeded",
        finishedAt: new Date(),
        metadata: {
          stage: "text",
          chunk_count: chunked.length,
          text_artifact_id: textArtifactId,
          completed_by: "document.chunk",
          raw_original_unchanged: true
        }
      });
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
      idempotencyKey: withProcessingRunId(`document.index:${document.id}:${this.embeddings.provider}:${this.embeddings.model}`, readMetadataString(context.payload.metadata, "processing_run_id")),
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
  private readonly artifacts: DerivedArtifactRepository;
  private readonly chunks: DocumentChunkRepository;
  private readonly vectorIndex: VectorIndex | undefined;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    artifacts: DerivedArtifactRepository;
    chunks: DocumentChunkRepository;
    vectorIndex: VectorIndex | undefined;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.artifacts = options.artifacts;
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
    const processingRunId = readMetadataString(context.payload.metadata, "processing_run_id");
    if (processingRunId) {
      await this.artifacts.updateProcessingRunStatus({
        projectId: document.projectId,
        runId: processingRunId,
        status: "succeeded",
        finishedAt: new Date(),
        metadata: {
          stage: "text",
          indexed_chunks: indexed.length,
          completed_by: "document.index",
          vector_index_provider: this.vectorIndex.provider,
          raw_original_unchanged: true
        }
      });
    }
  }
}

function nextJob(context: ProcessingJobProcessorContext, input: {
  type: "document.extract" | "document.chunk" | "document.embed" | "document.index";
  idempotencyKey: string;
  processorVersion: string;
  metadata?: Record<string, unknown>;
}): Parameters<ProcessingJobDispatcher["createAndEnqueue"]>[0] {
  const processingRunId = readMetadataString(context.payload.metadata, "processing_run_id");
  return {
    projectId: context.payload.projectId,
    type: input.type,
    targetType: context.payload.targetType,
    targetId: context.payload.targetId,
    idempotencyKey: input.idempotencyKey,
    processorVersion: input.processorVersion,
    metadata: {
      ...(input.metadata ?? {}),
      ...(processingRunId ? { processing_run_id: processingRunId } : {}),
      previous_job_id: context.payload.jobId
    }
  };
}

function withProcessingRunId(idempotencyKey: string, processingRunId: string | undefined): string {
  return processingRunId ? `${idempotencyKey}:${processingRunId}` : idempotencyKey;
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

function enrichChunkWithArtifactRefs(chunk: TextChunk, processingRunId: string, textArtifactId: string): TextChunk {
  const artifactId = deterministicArtifactId(processingRunId, "text_chunk", chunk.index);
  const textSpanId = deterministicTextSpanId(artifactId, 0);
  return {
    ...chunk,
    metadata: {
      ...chunk.metadata,
      processing_run_id: processingRunId,
      text_artifact_id: textArtifactId,
      artifact_id: artifactId,
      text_span_id: textSpanId,
      source_refs: [
        { type: "document", id: chunk.documentId },
        { type: "processing_run", id: processingRunId },
        { type: "artifact", id: textArtifactId },
        { type: "artifact", id: artifactId },
        { type: "chunk", id: chunk.id }
      ]
    }
  };
}

function deterministicProcessingRunId(documentId: string, stage: string, checksum: string): string {
  return `run_${hashIdentifier(`${documentId}:${stage}:${checksum}`).slice(0, 32)}`;
}

function deterministicArtifactId(processingRunId: string, artifactType: string, artifactIndex: number): string {
  return `artifact_${hashIdentifier(`${processingRunId}:${artifactType}:${artifactIndex}`).slice(0, 32)}`;
}

function deterministicTextSpanId(artifactId: string, spanIndex: number): string {
  return `span_${hashIdentifier(`${artifactId}:${spanIndex}`).slice(0, 32)}`;
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function readMetadataStringArray(metadata: unknown, key: string): string[] | undefined {
  const record = typeof metadata === "object" && metadata !== null ? metadata as Record<string, unknown> : null;
  const value = record?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

async function readUtf8(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readAllBytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
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
