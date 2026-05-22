import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import type { MindoryConfig } from "@mindory/config";
import type { CreateDocumentMetadataIndexInput, DerivedArtifactRepository } from "@mindory/core/artifacts";
import {
  planDocumentProcessingRoute,
  type DocumentFileKind,
  type DocumentProcessingRouteConfig,
  type DocumentRouteSkip
} from "@mindory/core/document-routing";
import type { DocumentRecord, DocumentRepository } from "@mindory/core/documents";
import {
  type ProcessingJobDispatcher,
  type ProcessingJobProcessor,
  type ProcessingJobProcessorRegistry,
  type ProcessingJobProcessorContext,
  type ProcessingJobResult,
  type ProcessingJobStageDetail,
  type ProcessingJobStageStatus
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
  type ExtractedArtifactVector,
  type ExtractedFaceObservation,
  type ExtractedSemanticArtifact,
  type ExtractedTextPage,
  type ExtractedTranscriptSegment,
  type TextChunk,
  type TextChunker,
  type TextExtractor,
  type VectorChunkEmbedding,
  type VectorIndex
} from "@mindory/core/processing";
import { FaceService } from "@mindory/core/faces";
import type { ObjectStorage } from "@mindory/core/storage";
import { AudioTranscriptExtractor, type AudioTranscriptExtractorOptions } from "@mindory/extractor-audio-transcript";
import { BuiltinTextExtractor } from "@mindory/extractor-builtin-text";
import { DoclingPdfExtractor, type DoclingPdfExtractorOptions } from "@mindory/extractor-docling";
import { ImageSemanticExtractor, type ImageSemanticExtractorOptions } from "@mindory/extractor-image-semantic";
import { readVideoManifest, VideoKeyframeExtractor, type VideoKeyframeExtractorOptions } from "@mindory/extractor-video-keyframe";
import { buildMindoryLlm, llmRoleState, type MindoryLlm } from "@mindory/llm";
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
  llm?: MindoryLlm;
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
  const llm = options.llm ?? buildMindoryLlm(options.config);
  const extractors = options.extractors ?? [
    new BuiltinTextExtractor(),
    new AudioTranscriptExtractor(audioTranscriptExtractorOptions(llm)),
    new VideoKeyframeExtractor(videoKeyframeExtractorOptions(options.config, llm)),
    new DoclingPdfExtractor(doclingPdfExtractorOptions(options.config, llm)),
    new ImageSemanticExtractor(imageSemanticExtractorOptions(llm))
  ];
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
      modelRuntimeFingerprint: buildDocumentRecomputeFingerprint(options.config.llm)
    }),
    new DocumentRouteProcessor({
      storage: options.storage,
      documents: options.documents,
      artifacts: options.artifacts,
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
      vectorIndex: options.vectorIndex,
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
  return buildMindoryLlm(config).textEmbeddings;
}

function doclingPdfExtractorOptions(config: MindoryConfig, llm: MindoryLlm): DoclingPdfExtractorOptions {
  const options: DoclingPdfExtractorOptions = {
    service: {
      enabled: config.docling.enabled,
      url: config.docling.url,
      timeoutMs: config.docling.timeoutMs
    },
    ocr: llmRoleState(llm, "ocr"),
    ocrRole: llm.registry.require("ocr")
  };
  if (llm.ocr !== undefined) {
    options.ocrProvider = llm.ocr;
  }
  return options;
}

function audioTranscriptExtractorOptions(llm: MindoryLlm): AudioTranscriptExtractorOptions {
  const options: AudioTranscriptExtractorOptions = {
    asr: llmRoleState(llm, "asr"),
    asrRole: llm.registry.require("asr")
  };
  if (llm.asr !== undefined) {
    options.asrProvider = llm.asr;
  }
  return options;
}

function imageSemanticExtractorOptions(llm: MindoryLlm): ImageSemanticExtractorOptions {
  const options: ImageSemanticExtractorOptions = {
    faceDetection: llmRoleState(llm, "face-detection"),
    faceRecognition: llmRoleState(llm, "face-recognition"),
    imageCaptioning: llmRoleState(llm, "vision-captioning"),
    imageEmbedding: llmRoleState(llm, "image-embedding"),
    ocr: llmRoleState(llm, "ocr"),
    ocrRole: llm.registry.require("ocr"),
    visionRole: llm.registry.require("vision-captioning"),
    imageEmbeddingRole: llm.registry.require("image-embedding"),
    faceDetectionRole: llm.registry.require("face-detection"),
    faceRecognitionRole: llm.registry.require("face-recognition")
  };
  if (llm.ocr !== undefined) {
    options.ocrProvider = llm.ocr;
  }
  if (llm.vision !== undefined) {
    options.visionProvider = llm.vision;
  }
  if (llm.imageEmbeddings !== undefined) {
    options.imageEmbeddingProvider = llm.imageEmbeddings;
  }
  if (llm.faces !== undefined) {
    options.faceProvider = llm.faces;
  }
  return options;
}

function videoKeyframeExtractorOptions(config: MindoryConfig, llm: MindoryLlm): VideoKeyframeExtractorOptions {
  const options: VideoKeyframeExtractorOptions = {
    maxKeyframes: config.documentProcessing.video.maxKeyframes,
    keyframeProvider: config.documentProcessing.video.keyframeProvider,
    keyframeCommand: config.documentProcessing.video.keyframeCommand,
    keyframeCommandArgs: config.documentProcessing.video.keyframeCommandArgs,
    keyframeTimeoutMs: config.documentProcessing.video.keyframeTimeoutMs,
    ffmpegCommand: config.documentProcessing.video.ffmpegCommand,
    ffprobeCommand: config.documentProcessing.video.ffprobeCommand,
    ocr: llmRoleState(llm, "ocr"),
    visionCaptioning: llmRoleState(llm, "vision-captioning"),
    ocrRole: llm.registry.require("ocr"),
    visionRole: llm.registry.require("vision-captioning")
  };
  if (llm.ocr !== undefined) {
    options.ocrProvider = llm.ocr;
  }
  if (llm.vision !== undefined) {
    options.visionProvider = llm.vision;
  }
  return options;
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

  async process(context: ProcessingJobProcessorContext): Promise<ProcessingJobResult> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    if (["quarantined", "scan_infected"].includes(document.status)) {
      throw blockedByScanError(document, "recompute");
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
      return {
        stageGraph: [
          stageDetail("recompute", "succeeded", {
            processing_run_id: run.id,
            superseded_runs: supersededRuns
          }),
          stageDetail("route", "pending", {
            job_id: routeJob.processingJobId,
            queue_job_id: routeJob.queueJobId
          })
        ],
        metadata: {
          processing_run_id: run.id,
          queued_jobs: [{
            type: "document.route",
            processing_job_id: routeJob.processingJobId,
            queue_job_id: routeJob.queueJobId
          }]
        }
      };
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
  private readonly artifacts: DerivedArtifactRepository;
  private readonly jobs: ProcessingJobDispatcher;
  private readonly routeConfig: DocumentProcessingRouteConfig;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    artifacts: DerivedArtifactRepository;
    jobs: ProcessingJobDispatcher;
    routeConfig: DocumentProcessingRouteConfig;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.artifacts = options.artifacts;
    this.jobs = options.jobs;
    this.routeConfig = options.routeConfig;
    this.processorVersion = options.processorVersion;
  }

  async process(context: ProcessingJobProcessorContext): Promise<ProcessingJobResult> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    if (["quarantined", "scan_infected"].includes(document.status)) {
      throw blockedByScanError(document, "route");
    }

    const object = await this.storage.getObject(document.storageKey);
    const rawBytes = await readAllBytes(object.body);
    const plan = planDocumentProcessingRoute({
      document,
      config: this.routeConfig,
      magicBytes: rawBytes.subarray(0, 512)
    });
    const processingRunId = readMetadataString(context.payload.metadata, "processing_run_id");
    const indexedMetadata = await indexAttachmentMetadata({
      artifacts: this.artifacts,
      document,
      rawBytes,
      processingRunId,
      mediaType: plan.classification.kind,
      magicMatched: plan.classification.magicMatched
    });
    const routingMetadata = plan.metadata.routing && typeof plan.metadata.routing === "object"
      ? plan.metadata.routing as Record<string, unknown>
      : {};
    const metadata: Record<string, unknown> = {
      ...document.metadata,
      ...plan.metadata,
      routing: {
        ...routingMetadata,
        ...(processingRunId ? { processing_run_id: processingRunId } : {}),
        metadata_indexed: true
      },
      attachment_metadata: indexedMetadata
    };
    if (indexedMetadata.checksum_sha256) {
      metadata.checksum_sha256 = indexedMetadata.checksum_sha256;
    }
    if (indexedMetadata.container) {
      metadata.container = indexedMetadata.container;
    }
    if (indexedMetadata.extension) {
      metadata.extension = indexedMetadata.extension;
    }
    if (indexedMetadata.duration_ms !== null) {
      metadata.duration_ms = indexedMetadata.duration_ms;
    }
    if (indexedMetadata.width !== null) {
      metadata.width = indexedMetadata.width;
    }
    if (indexedMetadata.height !== null) {
      metadata.height = indexedMetadata.height;
    }
    if (indexedMetadata.page_count !== null) {
      metadata.page_count = indexedMetadata.page_count;
    }
    if (indexedMetadata.frame_count !== null) {
      metadata.frame_count = indexedMetadata.frame_count;
    }
    if (indexedMetadata.codec) {
      metadata.codec = indexedMetadata.codec;
    }

    const nextStatus = plan.jobs.some((job) => job.type === "document.extract") ? "extract_pending" : "scan_clean";
    await this.documents.updateDocumentStatus({
      projectId: document.projectId,
      documentId: document.id,
      status: nextStatus,
      metadata
    });

    const enqueuedJobs = [];
    for (const job of plan.jobs) {
      const enqueued = await this.jobs.createAndEnqueue(nextJob(context, {
        type: job.type,
        idempotencyKey: withProcessingRunId(`${job.type}:${document.id}:${job.processorVersion}`, processingRunId),
        processorVersion: job.processorVersion,
        metadata: {
          ...job.metadata,
          ...(processingRunId ? { processing_run_id: processingRunId } : {}),
          storage_key: document.storageKey
        }
      }));
      enqueuedJobs.push({
        ...job,
        processingJobId: enqueued.processingJobId,
        queueJobId: enqueued.queueJobId
      });
    }

    const skippedStageDetails = plan.skipped.map((skipped) => stageDetail(
      routeStageForKind(skipped.kind),
      routeSkippedStageStatus(skipped),
      {
        reason: skipped.reason,
        required: skipped.required
      }
    ));
    const stageGraph: ProcessingJobStageDetail[] = [
      stageDetail("route", "succeeded", {
        classification: plan.classification
      }),
      ...enqueuedJobs.map((job) => stageDetail(routeStageForKind(plan.classification.kind), "pending", {
        reason: job.reason,
        job_id: job.processingJobId,
        queue_job_id: job.queueJobId
      })),
      ...skippedStageDetails
    ];
    return {
      statusDetail: skippedStageDetails.some((stage) => stage.status === "partial_failed") ? "partial_failed" : "succeeded",
      stageGraph,
      metadata: {
        planned_jobs: enqueuedJobs.map((job) => ({
          type: job.type,
          processing_job_id: job.processingJobId,
          queue_job_id: job.queueJobId,
          reason: job.reason
        })),
        skipped_stages: plan.skipped
      }
    };
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
  private readonly vectorIndex: VectorIndex | undefined;
  private readonly nextProcessorVersion: string;

  constructor(options: {
    storage: ObjectStorage;
    documents: DocumentRepository;
    artifacts: DerivedArtifactRepository;
    jobs: ProcessingJobDispatcher;
    extractors: TextExtractor[];
    vectorIndex: VectorIndex | undefined;
    nextProcessorVersion: string;
    processorVersion: string;
  }) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.artifacts = options.artifacts;
    this.jobs = options.jobs;
    this.extractors = options.extractors;
    this.vectorIndex = options.vectorIndex;
    this.nextProcessorVersion = options.nextProcessorVersion;
    this.processorVersion = options.processorVersion;
  }

  async process(context: ProcessingJobProcessorContext): Promise<ProcessingJobResult> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    if (["quarantined", "scan_infected"].includes(document.status)) {
      throw blockedByScanError(document, "extract");
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
    const routeKind = readMetadataString(context.payload.metadata, "route_kind");
    const extractionStage = routeKind === "pdf" || document.mimeType.toLowerCase().startsWith("application/pdf")
      ? "pdf"
      : routeKind === "image" || document.mimeType.toLowerCase().startsWith("image/")
        ? "image"
        : routeKind === "audio" || document.mimeType.toLowerCase().startsWith("audio/")
          ? "audio"
          : routeKind === "video" || document.mimeType.toLowerCase().startsWith("video/")
            ? "video"
            : "text";
    const processingRunId = incomingProcessingRunId
      ?? deterministicProcessingRunId(document.id, extractionStage, sha256Hex(rawBytes));
    const configFingerprint = buildDocumentRecomputeFingerprint({
      extractor: extractor.name,
      extractorVersion: extractor.version,
      processorVersion: this.processorVersion,
      stage: extractionStage
    });
    if (!incomingProcessingRunId) {
      await this.artifacts.createProcessingRun({
        id: processingRunId,
        projectId: document.projectId,
        documentId: document.id,
        reason: `${extractionStage}_pipeline`,
        processorVersion: this.processorVersion,
        configFingerprint,
        sourceDocumentStorageKey: document.storageKey,
        sourceDocumentChecksum: sha256Hex(rawBytes),
        metadata: {
          stage: extractionStage,
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
    const pageArtifacts = await createExtractedPageArtifacts({
      artifacts: this.artifacts,
      document,
      processingRunId,
      textArtifactId,
      pages: extracted.pages ?? [],
      extractorName: extractor.name,
      extractorVersion: extractor.version,
      configFingerprint
    });
    const semanticArtifacts = await createExtractedSemanticArtifacts({
      artifacts: this.artifacts,
      ...(this.vectorIndex === undefined ? {} : { vectorIndex: this.vectorIndex }),
      document,
      processingRunId,
      textArtifactId,
      semanticArtifacts: extracted.semanticArtifacts ?? [],
      extractorName: extractor.name,
      extractorVersion: extractor.version,
      configFingerprint
    });
    const transcriptSegments = await createExtractedTranscriptArtifacts({
      artifacts: this.artifacts,
      document,
      processingRunId,
      textArtifactId,
      transcriptText: extracted.text,
      transcriptSegments: extracted.transcriptSegments ?? [],
      extractorName: extractor.name,
      extractorVersion: extractor.version,
      configFingerprint
    });
    const faceObservations = await createExtractedFaceObservations({
      artifacts: this.artifacts,
      document,
      processingRunId,
      textArtifactId,
      faceObservations: extracted.faceObservations ?? [],
      extractorName: extractor.name,
      extractorVersion: extractor.version,
      configFingerprint
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
          page_artifacts: pageArtifacts,
          semantic_artifacts: semanticArtifacts,
          transcript_segments: transcriptSegments,
          face_observations: faceObservations,
          source_refs: [
            { type: "document", id: document.id },
            { type: "processing_run", id: processingRunId },
            { type: "artifact", id: textArtifactId }
          ].concat(semanticArtifacts.map((artifact) => ({ type: "artifact", id: artifact.artifact_id })))
            .concat(transcriptSegments.map((segment) => ({ type: "artifact", id: segment.artifact_id })))
            .concat(faceObservations.map((observation) => ({ type: "artifact", id: observation.artifact_id })))
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
          processing_stage: extractionStage,
          page_artifacts: pageArtifacts,
          semantic_artifacts: semanticArtifacts,
          transcript_segments: transcriptSegments,
          face_observations: faceObservations,
          page_count: extracted.pages?.length ?? 0,
          ...extracted.metadata
        }
      }
    });

    const chunkJob = await this.jobs.createAndEnqueue(nextJob(context, {
      type: "document.chunk",
      idempotencyKey: withProcessingRunId(`document.chunk:${document.id}:${this.nextProcessorVersion}`, readMetadataString(context.payload.metadata, "processing_run_id")),
      processorVersion: this.nextProcessorVersion,
      metadata: {
        extracted_text_key: extractedTextKey,
        text_artifact_id: textArtifactId
      }
    }));
    return {
      stageGraph: [
        stageDetail(extractionStage, "succeeded", {
          extractor: extractor.name,
          artifact_count: 1 + pageArtifacts.length + semanticArtifacts.length + (transcriptSegments.length > 0 ? 1 : 0) + faceObservations.length
        }),
        stageDetail("chunk", "pending", {
          job_id: chunkJob.processingJobId,
          queue_job_id: chunkJob.queueJobId
        })
      ],
      metadata: {
        processing_run_id: processingRunId,
        text_artifact_id: textArtifactId
      }
    };
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

  async process(context: ProcessingJobProcessorContext): Promise<ProcessingJobResult> {
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
    const pageRefs = readExtractionPageRefs(document.metadata.extraction);
    const semanticRefs = readExtractionSemanticArtifactRefs(document.metadata.extraction);
    const transcriptRefs = readExtractionTranscriptSegmentRefs(document.metadata.extraction);
    const faceRefs = readExtractionFaceObservationRefs(document.metadata.extraction);

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
      .map((chunk) => enrichChunkWithArtifactRefs(chunk, processingRunId, textArtifactId, pageRefs, semanticRefs, transcriptRefs, faceRefs));

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
      const embedJob = await this.jobs.createAndEnqueue(nextJob(context, {
        type: "document.embed",
        idempotencyKey: withProcessingRunId(`document.embed:${document.id}:${this.processorVersion}`, readMetadataString(context.payload.metadata, "processing_run_id")),
        processorVersion: "document-embed-v1",
        metadata: {
          chunk_count: chunked.length
        }
      }));
      return {
        stageGraph: [
          stageDetail("chunk", "succeeded", {
            chunk_count: chunked.length
          }),
          stageDetail("embed", "pending", {
            job_id: embedJob.processingJobId,
            queue_job_id: embedJob.queueJobId
          })
        ],
        metadata: {
          processing_run_id: processingRunId,
          chunk_count: chunked.length
        }
      };
    } else {
      await this.artifacts.updateProcessingRunStatus({
        projectId: document.projectId,
        runId: processingRunId,
        status: "succeeded",
        finishedAt: new Date(),
        metadata: {
          stage: readMetadataString(document.metadata.extraction, "processing_stage") ?? "text",
          chunk_count: chunked.length,
          text_artifact_id: textArtifactId,
          completed_by: "document.chunk",
          raw_original_unchanged: true
        }
      });
      return {
        stageGraph: [
          stageDetail("chunk", "succeeded", {
            chunk_count: chunked.length
          }),
          stageDetail("embed", "disabled", {
            reason: "embeddings_provider_disabled"
          })
        ],
        metadata: {
          processing_run_id: processingRunId,
          chunk_count: chunked.length
        }
      };
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

  async process(context: ProcessingJobProcessorContext): Promise<ProcessingJobResult> {
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
      return {
        stageGraph: [
          stageDetail("embed", "disabled", {
            reason: "embeddings_provider_disabled"
          })
        ]
      };
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
        metadata: {
          ...documentVectorMetadata(document),
          ...chunk.metadata
        }
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

    const indexJob = await this.jobs.createAndEnqueue(nextJob(context, {
      type: "document.index",
      idempotencyKey: withProcessingRunId(`document.index:${document.id}:${this.embeddings.provider}:${this.embeddings.model}`, readMetadataString(context.payload.metadata, "processing_run_id")),
      processorVersion: "document-index-v1",
      metadata: {
        embeddings_key: embeddingsKey
      }
    }));
    return {
      stageGraph: [
        stageDetail("embed", "succeeded", {
          embeddings_provider: this.embeddings.provider,
          embeddings_model: this.embeddings.model,
          chunk_count: embeddings.length
        }),
        stageDetail("index", "pending", {
          job_id: indexJob.processingJobId,
          queue_job_id: indexJob.queueJobId
        })
      ],
      metadata: {
        embeddings_key: embeddingsKey,
        embedded_chunks: embeddings.length
      }
    };
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

  async process(context: ProcessingJobProcessorContext): Promise<ProcessingJobResult> {
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
      return {
        stageGraph: [
          stageDetail("index", "disabled", {
            reason: "vector_index_not_configured"
          })
        ]
      };
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
          stage: readMetadataString(document.metadata.extraction, "processing_stage") ?? "text",
          indexed_chunks: indexed.length,
          completed_by: "document.index",
          vector_index_provider: this.vectorIndex.provider,
          raw_original_unchanged: true
        }
      });
    }
    return {
      stageGraph: [
        stageDetail("index", "succeeded", {
          vector_index_provider: this.vectorIndex.provider,
          indexed_chunks: indexed.length
        })
      ],
      metadata: {
        indexed_chunks: indexed.length,
        vector_index_provider: this.vectorIndex.provider
      }
    };
  }
}

interface ExtractedPageArtifactRef {
  artifact_id: string;
  text_span_id?: string;
  page_number: number;
  start_offset: number;
  end_offset: number;
  width: number | null;
  height: number | null;
  ocr: boolean;
}

interface ExtractedSemanticArtifactRef {
  artifact_id: string;
  text_span_id?: string;
  artifact_type: string;
  span_type: string;
  vector_embedding_id?: string;
  vector_dimensions?: number;
}

interface ExtractedTranscriptSegmentRef {
  artifact_id: string;
  text_span_id: string;
  segment_index: number;
  start_offset: number;
  end_offset: number;
  start_ms: number;
  end_ms: number;
}

interface ExtractedFaceObservationRef {
  artifact_id: string;
  observation_id: string;
  face_identity_id: string;
  bounding_box: Record<string, unknown>;
  confidence: number | null;
}

async function createExtractedPageArtifacts(input: {
  artifacts: DerivedArtifactRepository;
  document: DocumentRecord;
  processingRunId: string;
  textArtifactId: string;
  pages: ExtractedTextPage[];
  extractorName: string;
  extractorVersion: string;
  configFingerprint: string;
}): Promise<ExtractedPageArtifactRef[]> {
  const refs: ExtractedPageArtifactRef[] = [];
  for (const page of input.pages) {
    const artifactId = deterministicArtifactId(input.processingRunId, "pdf_page", page.pageNumber - 1);
    const textSpanId = page.text.length > 0 ? deterministicTextSpanId(artifactId, 0) : undefined;
    await input.artifacts.createDocumentArtifact({
      id: artifactId,
      projectId: input.document.projectId,
      documentId: input.document.id,
      processingRunId: input.processingRunId,
      parentArtifactId: input.textArtifactId,
      artifactType: "pdf_page",
      artifactIndex: page.pageNumber - 1,
      content: page.text,
      contentHash: sha256Hex(Buffer.from(page.text, "utf8")),
      sourceRefs: [
        { type: "document", id: input.document.id },
        { type: "processing_run", id: input.processingRunId },
        { type: "artifact", id: input.textArtifactId }
      ],
      source: input.document.source,
      sourcePosition: {
        page_number: page.pageNumber,
        start_offset: page.startOffset,
        end_offset: page.endOffset
      },
      configFingerprint: input.configFingerprint,
      metadata: {
        ...(page.metadata ?? {}),
        extractor: input.extractorName,
        extractor_version: input.extractorVersion,
        page_number: page.pageNumber,
        width: page.width ?? null,
        height: page.height ?? null,
        ocr: page.ocr ?? false,
        text_artifact_id: input.textArtifactId
      }
    });
    if (textSpanId) {
      await input.artifacts.replaceDocumentArtifactTextSpans({
        projectId: input.document.projectId,
        documentId: input.document.id,
        artifactId,
        spans: [{
          id: textSpanId,
          projectId: input.document.projectId,
          documentId: input.document.id,
          artifactId,
          spanType: page.ocr ? "ocr_text" : "pdf_native_text",
          content: page.text,
          startOffset: page.startOffset,
          endOffset: page.endOffset,
          pageNumber: page.pageNumber,
          confidence: page.confidence ?? null,
          metadata: {
            ...(page.metadata ?? {}),
            processing_run_id: input.processingRunId,
            artifact_id: artifactId,
            text_artifact_id: input.textArtifactId,
            extractor: input.extractorName,
            extractor_version: input.extractorVersion,
            source_refs: [
              { type: "document", id: input.document.id },
              { type: "processing_run", id: input.processingRunId },
              { type: "artifact", id: input.textArtifactId },
              { type: "artifact", id: artifactId }
            ]
          }
        }]
      });
    } else {
      await input.artifacts.replaceDocumentArtifactTextSpans({
        projectId: input.document.projectId,
        documentId: input.document.id,
        artifactId,
        spans: []
      });
    }
    const ref: ExtractedPageArtifactRef = {
      artifact_id: artifactId,
      page_number: page.pageNumber,
      start_offset: page.startOffset,
      end_offset: page.endOffset,
      width: page.width ?? null,
      height: page.height ?? null,
      ocr: page.ocr ?? false
    };
    if (textSpanId !== undefined) {
      ref.text_span_id = textSpanId;
    }
    refs.push(ref);
  }

  return refs;
}

async function createExtractedSemanticArtifacts(input: {
  artifacts: DerivedArtifactRepository;
  vectorIndex?: VectorIndex;
  document: DocumentRecord;
  processingRunId: string;
  textArtifactId: string;
  semanticArtifacts: ExtractedSemanticArtifact[];
  extractorName: string;
  extractorVersion: string;
  configFingerprint: string;
}): Promise<ExtractedSemanticArtifactRef[]> {
  const refs: ExtractedSemanticArtifactRef[] = [];
  if (input.vectorIndex !== undefined && input.semanticArtifacts.some((artifact) => artifact.vector !== undefined && artifact.vector !== null)) {
    await input.vectorIndex.deleteDocumentArtifactVectors(input.document.projectId, input.document.id);
  }
  for (const [index, semanticArtifact] of input.semanticArtifacts.entries()) {
    const artifactIndex = semanticArtifact.artifactIndex ?? index;
    const artifactId = deterministicArtifactId(input.processingRunId, semanticArtifact.artifactType, artifactIndex);
    const textSpanId = deterministicTextSpanId(artifactId, 0);
    const spanType = semanticArtifact.spanType ?? semanticArtifact.artifactType;
    const sourcePosition = semanticArtifact.sourcePosition ?? {};
    await input.artifacts.createDocumentArtifact({
      id: artifactId,
      projectId: input.document.projectId,
      documentId: input.document.id,
      processingRunId: input.processingRunId,
      parentArtifactId: input.textArtifactId,
      artifactType: semanticArtifact.artifactType,
      artifactIndex,
      content: semanticArtifact.content,
      contentHash: sha256Hex(Buffer.from(semanticArtifact.content, "utf8")),
      sourceRefs: [
        { type: "document", id: input.document.id },
        { type: "processing_run", id: input.processingRunId },
        { type: "artifact", id: input.textArtifactId }
      ],
      source: input.document.source,
      sourcePosition,
      modelProvider: semanticArtifact.modelProvider ?? null,
      modelName: semanticArtifact.modelName ?? null,
      modelVersion: semanticArtifact.modelVersion ?? null,
      configFingerprint: input.configFingerprint,
      metadata: {
        ...(semanticArtifact.metadata ?? {}),
        extractor: input.extractorName,
        extractor_version: input.extractorVersion,
        text_artifact_id: input.textArtifactId
      }
    });
    await input.artifacts.replaceDocumentArtifactTextSpans({
      projectId: input.document.projectId,
      documentId: input.document.id,
      artifactId,
      spans: [{
        id: textSpanId,
        projectId: input.document.projectId,
        documentId: input.document.id,
        artifactId,
        spanType,
        content: semanticArtifact.content,
        pageNumber: readNumberFromRecord(sourcePosition, "page_number"),
        frameIndex: readNumberFromRecord(sourcePosition, "frame_index"),
        timestampMs: readNumberFromRecord(sourcePosition, "timestamp_ms"),
        boundingBox: readRecordFromRecord(sourcePosition, "bounding_box"),
        confidence: semanticArtifact.confidence ?? null,
        metadata: {
          ...(semanticArtifact.metadata ?? {}),
          processing_run_id: input.processingRunId,
          artifact_id: artifactId,
          text_artifact_id: input.textArtifactId,
          extractor: input.extractorName,
          extractor_version: input.extractorVersion,
          source_refs: [
            { type: "document", id: input.document.id },
            { type: "processing_run", id: input.processingRunId },
            { type: "artifact", id: input.textArtifactId },
            { type: "artifact", id: artifactId }
          ]
        }
      }]
    });
    const vectorResult = semanticArtifact.vector
      ? await upsertSemanticArtifactVector({
        ...(input.vectorIndex === undefined ? {} : { vectorIndex: input.vectorIndex }),
        document: input.document,
        artifactId,
        artifactType: semanticArtifact.artifactType,
        content: semanticArtifact.content,
        vector: semanticArtifact.vector,
        metadata: {
          ...(semanticArtifact.metadata ?? {}),
          processing_run_id: input.processingRunId,
          artifact_id: artifactId,
          text_artifact_id: input.textArtifactId,
          source_refs: [
            { type: "document", id: input.document.id },
            { type: "processing_run", id: input.processingRunId },
            { type: "artifact", id: input.textArtifactId },
            { type: "artifact", id: artifactId }
          ]
        }
      })
      : undefined;
    const semanticRef: ExtractedSemanticArtifactRef = {
      artifact_id: artifactId,
      text_span_id: textSpanId,
      artifact_type: semanticArtifact.artifactType,
      span_type: spanType
    };
    if (vectorResult !== undefined && semanticArtifact.vector !== undefined && semanticArtifact.vector !== null) {
      semanticRef.vector_embedding_id = vectorResult.embeddingId;
      semanticRef.vector_dimensions = semanticArtifact.vector.dimensions;
    }
    refs.push(semanticRef);
  }

  return refs;
}

async function upsertSemanticArtifactVector(input: {
  vectorIndex?: VectorIndex;
  document: DocumentRecord;
  artifactId: string;
  artifactType: ExtractedSemanticArtifact["artifactType"];
  content: string;
  vector: ExtractedArtifactVector;
  metadata: Record<string, unknown>;
}): Promise<{ embeddingId: string; artifactId: string } | undefined> {
  if (input.vectorIndex === undefined) {
    return undefined;
  }
  const [result] = await input.vectorIndex.upsertArtifactVectors({
    artifacts: [{
      projectId: input.document.projectId,
      documentId: input.document.id,
      artifactId: input.artifactId,
      artifactType: input.artifactType,
      content: input.content,
      embedding: input.vector.embedding,
      model: input.vector.model,
      dimensions: input.vector.dimensions,
      metadata: {
        ...input.metadata,
        vector_provider: input.vector.provider ?? null,
        vector_model: input.vector.model,
        vector_dimensions: input.vector.dimensions,
        ...(input.vector.metadata ?? {})
      }
    }]
  });
  return result;
}

async function createExtractedTranscriptArtifacts(input: {
  artifacts: DerivedArtifactRepository;
  document: DocumentRecord;
  processingRunId: string;
  textArtifactId: string;
  transcriptText: string;
  transcriptSegments: ExtractedTranscriptSegment[];
  extractorName: string;
  extractorVersion: string;
  configFingerprint: string;
}): Promise<ExtractedTranscriptSegmentRef[]> {
  if (input.transcriptSegments.length === 0) {
    return [];
  }

  const artifactId = deterministicArtifactId(input.processingRunId, "transcript", 0);
  await input.artifacts.createDocumentArtifact({
    id: artifactId,
    projectId: input.document.projectId,
    documentId: input.document.id,
    processingRunId: input.processingRunId,
    parentArtifactId: input.textArtifactId,
    artifactType: "transcript",
    artifactIndex: 0,
    content: input.transcriptText,
    contentHash: sha256Hex(Buffer.from(input.transcriptText, "utf8")),
    sourceRefs: [
      { type: "document", id: input.document.id },
      { type: "processing_run", id: input.processingRunId },
      { type: "artifact", id: input.textArtifactId }
    ],
    source: input.document.source,
    sourcePosition: {
      start_offset: 0,
      end_offset: input.transcriptText.length
    },
    configFingerprint: input.configFingerprint,
    metadata: {
      extractor: input.extractorName,
      extractor_version: input.extractorVersion,
      text_artifact_id: input.textArtifactId,
      segment_count: input.transcriptSegments.length
    }
  });

  const refs: ExtractedTranscriptSegmentRef[] = input.transcriptSegments.map((segment, index) => {
    const segmentIndex = segment.segmentIndex ?? index;
    return {
      artifact_id: artifactId,
      text_span_id: deterministicTextSpanId(artifactId, segmentIndex),
      segment_index: segmentIndex,
      start_offset: segment.startOffset ?? 0,
      end_offset: segment.endOffset ?? segment.text.length,
      start_ms: segment.startMs,
      end_ms: segment.endMs
    };
  });
  await input.artifacts.replaceDocumentArtifactTextSpans({
    projectId: input.document.projectId,
    documentId: input.document.id,
    artifactId,
    spans: input.transcriptSegments.map((segment, index) => {
      const segmentIndex = segment.segmentIndex ?? index;
      const startOffset = segment.startOffset ?? 0;
      const endOffset = segment.endOffset ?? startOffset + segment.text.length;
      return {
        id: deterministicTextSpanId(artifactId, segmentIndex),
        projectId: input.document.projectId,
        documentId: input.document.id,
        artifactId,
        spanType: "transcript_segment",
        content: segment.text,
        startOffset,
        endOffset,
        timestampMs: segment.startMs,
        confidence: segment.confidence ?? null,
        metadata: {
          ...(segment.metadata ?? {}),
          processing_run_id: input.processingRunId,
          artifact_id: artifactId,
          text_artifact_id: input.textArtifactId,
          segment_index: segmentIndex,
          start_ms: segment.startMs,
          end_ms: segment.endMs,
          extractor: input.extractorName,
          extractor_version: input.extractorVersion,
          source_refs: [
            { type: "document", id: input.document.id },
            { type: "processing_run", id: input.processingRunId },
            { type: "artifact", id: input.textArtifactId },
            { type: "artifact", id: artifactId }
          ]
        }
      };
    })
  });

  return refs;
}

async function createExtractedFaceObservations(input: {
  artifacts: DerivedArtifactRepository;
  document: DocumentRecord;
  processingRunId: string;
  textArtifactId: string;
  faceObservations: ExtractedFaceObservation[];
  extractorName: string;
  extractorVersion: string;
  configFingerprint: string;
}): Promise<ExtractedFaceObservationRef[]> {
  const refs: ExtractedFaceObservationRef[] = [];
  const faceService = new FaceService({ repository: input.artifacts });
  for (const [index, faceObservation] of input.faceObservations.entries()) {
    const artifactIndex = faceObservation.observationIndex ?? index;
    const artifactId = deterministicArtifactId(input.processingRunId, "face_observation", artifactIndex);
    const content = faceObservation.content ?? `Face observation ${artifactIndex + 1}.`;
    const baseMetadata = {
      ...(faceObservation.metadata ?? {}),
      extractor: input.extractorName,
      extractor_version: input.extractorVersion,
      text_artifact_id: input.textArtifactId,
      observation_index: artifactIndex
    };
    const artifactInput = {
      id: artifactId,
      projectId: input.document.projectId,
      documentId: input.document.id,
      processingRunId: input.processingRunId,
      parentArtifactId: input.textArtifactId,
      artifactType: "face_observation" as const,
      artifactIndex,
      content,
      contentHash: sha256Hex(Buffer.from(content, "utf8")),
      source: input.document.source,
      sourcePosition: faceObservation.boundingBox,
      modelName: faceObservation.model ?? null,
      configFingerprint: input.configFingerprint
    };

    await input.artifacts.createDocumentArtifact({
      ...artifactInput,
      sourceRefs: [
        { type: "document", id: input.document.id },
        { type: "processing_run", id: input.processingRunId },
        { type: "artifact", id: input.textArtifactId }
      ],
      metadata: baseMetadata
    });
    const result = await faceService.recordObservation({
      id: deterministicFaceObservationId(artifactId),
      projectId: input.document.projectId,
      documentId: input.document.id,
      artifactId,
      processingRunId: input.processingRunId,
      embeddingId: faceObservation.embedding ? deterministicFaceEmbeddingId(artifactId) : null,
      embedding: faceObservation.embedding ?? null,
      model: faceObservation.model ?? null,
      boundingBox: faceObservation.boundingBox,
      confidence: faceObservation.confidence ?? null,
      metadata: baseMetadata
    });
    await input.artifacts.createDocumentArtifact({
      ...artifactInput,
      sourceRefs: [
        { type: "document", id: input.document.id },
        { type: "processing_run", id: input.processingRunId },
        { type: "artifact", id: input.textArtifactId },
        { type: "face_identity", id: result.identity.id },
        { type: "face_observation", id: result.observation.id }
      ],
      metadata: {
        ...baseMetadata,
        face_identity_id: result.identity.id,
        face_observation_id: result.observation.id,
        auto_match: result.match
      }
    });
    await input.artifacts.replaceDocumentArtifactTextSpans({
      projectId: input.document.projectId,
      documentId: input.document.id,
      artifactId,
      spans: [{
        id: deterministicTextSpanId(artifactId, 0),
        projectId: input.document.projectId,
        documentId: input.document.id,
        artifactId,
        spanType: "face_observation",
        content,
        boundingBox: faceObservation.boundingBox,
        confidence: faceObservation.confidence ?? null,
        metadata: {
          ...baseMetadata,
          processing_run_id: input.processingRunId,
          artifact_id: artifactId,
          text_artifact_id: input.textArtifactId,
          face_identity_id: result.identity.id,
          face_observation_id: result.observation.id,
          auto_match: result.match,
          source_refs: [
            { type: "document", id: input.document.id },
            { type: "processing_run", id: input.processingRunId },
            { type: "artifact", id: input.textArtifactId },
            { type: "artifact", id: artifactId },
            { type: "face_identity", id: result.identity.id },
            { type: "face_observation", id: result.observation.id }
          ]
        }
      }]
    });
    refs.push({
      artifact_id: artifactId,
      observation_id: result.observation.id,
      face_identity_id: result.identity.id,
      bounding_box: faceObservation.boundingBox,
      confidence: faceObservation.confidence ?? null
    });
  }

  return refs;
}

interface IndexAttachmentMetadataInput {
  artifacts: DerivedArtifactRepository;
  document: DocumentRecord;
  rawBytes: Buffer;
  processingRunId: string | undefined;
  mediaType: string;
  magicMatched: boolean;
}

interface AttachmentMetadataSnapshot {
  media_type: string;
  mime_type: string;
  size_bytes: number;
  extension: string | null;
  checksum_sha256: string;
  container: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  page_count: number | null;
  frame_count: number | null;
  codec: string | null;
  magic_matched: boolean;
}

async function indexAttachmentMetadata(input: IndexAttachmentMetadataInput): Promise<AttachmentMetadataSnapshot> {
  const metadata = extractAttachmentMetadata(input);
  await input.artifacts.upsertDocumentMediaMetadata({
    projectId: input.document.projectId,
    documentId: input.document.id,
    mediaType: metadata.media_type,
    durationMs: metadata.duration_ms,
    width: metadata.width,
    height: metadata.height,
    pageCount: metadata.page_count,
    frameCount: metadata.frame_count,
    codec: metadata.codec,
    container: metadata.container,
    checksumSha256: metadata.checksum_sha256,
    metadata: {
      mime_type: metadata.mime_type,
      extension: metadata.extension,
      size_bytes: metadata.size_bytes,
      magic_matched: metadata.magic_matched,
      source: "document.route",
      raw_original_unchanged: true
    }
  });
  await input.artifacts.replaceDocumentMetadataIndex({
    projectId: input.document.projectId,
    documentId: input.document.id,
    source: "raw",
    entries: buildAttachmentMetadataIndexEntries({
      document: input.document,
      metadata,
      processingRunId: input.processingRunId
    })
  });

  return metadata;
}

function extractAttachmentMetadata(input: IndexAttachmentMetadataInput): AttachmentMetadataSnapshot {
  const imageDimensions = readImageDimensions(input.rawBytes);
  const wavMetadata = readWavMetadata(input.rawBytes);
  const videoMetadata = readFallbackVideoMetadata(input.rawBytes);
  const extension = normalizeExtension(input.document.originalFilename);
  const container = extension ?? inferContainerFromMime(input.document.mimeType);

  return {
    media_type: input.mediaType,
    mime_type: input.document.mimeType.toLowerCase(),
    size_bytes: input.document.sizeBytes,
    extension,
    checksum_sha256: sha256Hex(input.rawBytes),
    container,
    duration_ms: wavMetadata.durationMs ?? videoMetadata.durationMs,
    width: imageDimensions.width,
    height: imageDimensions.height,
    page_count: readPdfPageCount(input.rawBytes),
    frame_count: videoMetadata.frameCount,
    codec: wavMetadata.codec ?? videoMetadata.codec,
    magic_matched: input.magicMatched
  };
}

function buildAttachmentMetadataIndexEntries(input: {
  document: DocumentRecord;
  metadata: AttachmentMetadataSnapshot;
  processingRunId: string | undefined;
}): CreateDocumentMetadataIndexInput[] {
  const base = {
    projectId: input.document.projectId,
    documentId: input.document.id,
    processingRunId: input.processingRunId ?? null,
    source: "raw",
    metadata: {
      source: "document.route",
      raw_original_unchanged: true
    }
  };
  const entries: CreateDocumentMetadataIndexInput[] = [
    metadataNumberEntry(base, input.document.id, "size_bytes", input.metadata.size_bytes, "bytes"),
    metadataTextEntry(base, input.document.id, "mime_type", input.metadata.mime_type),
    metadataTextEntry(base, input.document.id, "checksum_sha256", input.metadata.checksum_sha256),
    metadataTextEntry(base, input.document.id, "media_type", input.metadata.media_type),
    metadataBooleanEntry(base, input.document.id, "magic_matched", input.metadata.magic_matched)
  ];

  if (input.metadata.extension) {
    entries.push(metadataTextEntry(base, input.document.id, "extension", input.metadata.extension));
  }
  if (input.metadata.container) {
    entries.push(metadataTextEntry(base, input.document.id, "container", input.metadata.container));
  }
  if (input.metadata.duration_ms !== null) {
    entries.push(metadataNumberEntry(base, input.document.id, "duration_ms", input.metadata.duration_ms, "ms"));
  }
  if (input.metadata.width !== null) {
    entries.push(metadataNumberEntry(base, input.document.id, "width", input.metadata.width, "px"));
  }
  if (input.metadata.height !== null) {
    entries.push(metadataNumberEntry(base, input.document.id, "height", input.metadata.height, "px"));
  }
  if (input.metadata.page_count !== null) {
    entries.push(metadataNumberEntry(base, input.document.id, "page_count", input.metadata.page_count, "pages"));
  }
  if (input.metadata.frame_count !== null) {
    entries.push(metadataNumberEntry(base, input.document.id, "frame_count", input.metadata.frame_count, "frames"));
  }
  if (input.metadata.codec) {
    entries.push(metadataTextEntry(base, input.document.id, "codec", input.metadata.codec));
  }

  return entries;
}

function metadataTextEntry(
  base: Omit<CreateDocumentMetadataIndexInput, "id" | "key" | "valueText">,
  documentId: string,
  key: string,
  valueText: string
): CreateDocumentMetadataIndexInput {
  return {
    ...base,
    id: deterministicMetadataIndexId(documentId, "raw", key),
    key,
    valueText
  };
}

function metadataNumberEntry(
  base: Omit<CreateDocumentMetadataIndexInput, "id" | "key" | "valueNumber" | "unit">,
  documentId: string,
  key: string,
  valueNumber: number,
  unit: string
): CreateDocumentMetadataIndexInput {
  return {
    ...base,
    id: deterministicMetadataIndexId(documentId, "raw", key),
    key,
    valueNumber,
    unit
  };
}

function metadataBooleanEntry(
  base: Omit<CreateDocumentMetadataIndexInput, "id" | "key" | "valueBoolean">,
  documentId: string,
  key: string,
  valueBoolean: boolean
): CreateDocumentMetadataIndexInput {
  return {
    ...base,
    id: deterministicMetadataIndexId(documentId, "raw", key),
    key,
    valueBoolean
  };
}

function deterministicMetadataIndexId(documentId: string, source: string, key: string): string {
  return `metadata_${hashIdentifier(`${documentId}:${source}:${key}`).slice(0, 32)}`;
}

function normalizeExtension(filename: string): string | null {
  const extension = path.extname(filename).toLowerCase();
  return extension.length > 1 ? extension.slice(1) : null;
}

function inferContainerFromMime(mimeType: string): string | null {
  const parts = mimeType.toLowerCase().split("/");
  const subtype = parts[1];
  return subtype && subtype.length > 0 ? subtype : null;
}

function readImageDimensions(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20)
    };
  }
  if (bytes.length >= 10 && (matchesAsciiBuffer(bytes, 0, "GIF87a") || matchesAsciiBuffer(bytes, 0, "GIF89a"))) {
    return {
      width: bytes.readUInt16LE(6),
      height: bytes.readUInt16LE(8)
    };
  }
  const webpDimensions = readWebpDimensions(bytes);
  if (webpDimensions.width !== null && webpDimensions.height !== null) {
    return webpDimensions;
  }

  return readJpegDimensions(bytes);
}

function readWebpDimensions(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length < 16 || !matchesAsciiBuffer(bytes, 0, "RIFF") || !matchesAsciiBuffer(bytes, 8, "WEBP")) {
    return { width: null, height: null };
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (chunkId === "VP8X" && chunkSize >= 10 && payloadOffset + 10 <= bytes.length) {
      return {
        width: 1 + readUInt24LE(bytes, payloadOffset + 4),
        height: 1 + readUInt24LE(bytes, payloadOffset + 7)
      };
    }
    if (chunkId === "VP8 " && chunkSize >= 10 && payloadOffset + 10 <= bytes.length && matchesBytesBuffer(bytes, payloadOffset + 3, [0x9d, 0x01, 0x2a])) {
      return {
        width: bytes.readUInt16LE(payloadOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(payloadOffset + 8) & 0x3fff
      };
    }
    if (chunkId === "VP8L" && chunkSize >= 5 && payloadOffset + 5 <= bytes.length && bytes[payloadOffset] === 0x2f) {
      const byte1 = bytes[payloadOffset + 1] ?? 0;
      const byte2 = bytes[payloadOffset + 2] ?? 0;
      const byte3 = bytes[payloadOffset + 3] ?? 0;
      const byte4 = bytes[payloadOffset + 4] ?? 0;
      return {
        width: 1 + byte1 + ((byte2 & 0x3f) << 8),
        height: 1 + ((byte2 & 0xc0) >> 6) + (byte3 << 2) + ((byte4 & 0x0f) << 10)
      };
    }
    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  return { width: null, height: null };
}

function readJpegDimensions(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { width: null, height: null };
  }

  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (offset + 4 > bytes.length) {
      break;
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) {
      break;
    }
    if (isJpegStartOfFrame(marker) && offset + 8 < bytes.length) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + segmentLength;
  }

  return { width: null, height: null };
}

function isJpegStartOfFrame(marker: number): boolean {
  return [
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf
  ].includes(marker);
}

function readPdfPageCount(bytes: Buffer): number | null {
  if (!matchesAsciiBuffer(bytes, 0, "%PDF")) {
    return null;
  }
  return bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? null;
}

function readWavMetadata(bytes: Buffer): { durationMs: number | null; codec: string | null } {
  if (bytes.length < 12 || !matchesAsciiBuffer(bytes, 0, "RIFF") || !matchesAsciiBuffer(bytes, 8, "WAVE")) {
    return { durationMs: null, codec: null };
  }

  let offset = 12;
  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let audioFormat: number | null = null;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (chunkId === "fmt " && chunkSize >= 16 && payloadOffset + 16 <= bytes.length) {
      audioFormat = bytes.readUInt16LE(payloadOffset);
      byteRate = bytes.readUInt32LE(payloadOffset + 8);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }
    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  const durationMs = byteRate && dataSize !== null
    ? Math.round((dataSize / byteRate) * 1000)
    : null;
  const codec = audioFormat === null
    ? null
    : audioFormat === 1
      ? "pcm"
      : `wav_format_${audioFormat}`;

  return { durationMs, codec };
}

function readFallbackVideoMetadata(bytes: Buffer): { durationMs: number | null; codec: string | null; frameCount: number | null } {
  const manifest = readVideoManifest(bytes);
  return {
    durationMs: manifest?.durationMs ?? null,
    codec: manifest?.codec ?? null,
    frameCount: manifest?.frames.length ?? null
  };
}

function matchesAsciiBuffer(bytes: Buffer, offset: number, expected: string): boolean {
  if (offset < 0 || bytes.length < offset + expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function matchesBytesBuffer(bytes: Buffer, offset: number, expected: number[]): boolean {
  if (offset < 0 || bytes.length < offset + expected.length) {
    return false;
  }
  return expected.every((value, index) => bytes[offset + index] === value);
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16);
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

function stageDetail(stage: string, status: ProcessingJobStageStatus, metadata: Record<string, unknown> = {}): ProcessingJobStageDetail {
  const reason = typeof metadata.reason === "string" ? metadata.reason : undefined;
  const required = typeof metadata.required === "boolean" ? metadata.required : undefined;
  const jobId = typeof metadata.job_id === "string" ? metadata.job_id : undefined;
  const queueJobId = typeof metadata.queue_job_id === "string" ? metadata.queue_job_id : undefined;
  const detailMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) =>
    !["reason", "required", "job_id", "queue_job_id"].includes(key)
  ));
  return {
    stage,
    status,
    ...(reason ? { reason } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(jobId ? { jobId } : {}),
    ...(queueJobId ? { queueJobId } : {}),
    ...(Object.keys(detailMetadata).length > 0 ? { metadata: detailMetadata } : {})
  };
}

function routeStageForKind(kind: DocumentFileKind): string {
  switch (kind) {
    case "text":
      return "text";
    case "pdf":
      return "pdf";
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "unknown":
      return "unsupported";
  }
}

function routeSkippedStageStatus(skipped: DocumentRouteSkip): ProcessingJobStageStatus {
  if (skipped.reason === "disabled") {
    return "disabled";
  }
  return skipped.required ? "partial_failed" : "skipped";
}

function blockedByScanError(document: DocumentRecord, stage: string): ProcessingError {
  return new ProcessingError(
    "blocked_by_scan",
    `Document ${document.id} is blocked by antivirus status ${document.status} before ${stage}.`
  );
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

function enrichChunkWithArtifactRefs(
  chunk: TextChunk,
  processingRunId: string,
  textArtifactId: string,
  pageRefs: ExtractedPageArtifactRef[],
  semanticRefs: ExtractedSemanticArtifactRef[],
  transcriptRefs: ExtractedTranscriptSegmentRef[],
  faceRefs: ExtractedFaceObservationRef[]
): TextChunk {
  const artifactId = deterministicArtifactId(processingRunId, "text_chunk", chunk.index);
  const textSpanId = deterministicTextSpanId(artifactId, 0);
  const overlappingPages = pageRefsForChunk(chunk, pageRefs);
  const overlappingTranscriptSegments = transcriptRefsForChunk(chunk, transcriptRefs);
  const keyframeRefs = semanticRefs.filter((artifact) => artifact.artifact_type === "video_keyframe");
  const pageSourceRefs = overlappingPages.map((page) => ({ type: "artifact" as const, id: page.artifact_id }));
  const semanticSourceRefs = semanticRefs.map((artifact) => ({ type: "artifact" as const, id: artifact.artifact_id }));
  const transcriptSourceRefs = uniqueStrings(overlappingTranscriptSegments.map((segment) => segment.artifact_id))
    .map((artifactId) => ({ type: "artifact" as const, id: artifactId }));
  const faceSourceRefs = faceRefs.map((observation) => ({ type: "artifact" as const, id: observation.artifact_id }));
  return {
    ...chunk,
    metadata: {
      ...chunk.metadata,
      processing_run_id: processingRunId,
      text_artifact_id: textArtifactId,
      artifact_id: artifactId,
      text_span_id: textSpanId,
      page_numbers: overlappingPages.map((page) => page.page_number),
      page_artifact_ids: overlappingPages.map((page) => page.artifact_id),
      semantic_artifact_ids: semanticRefs.map((artifact) => artifact.artifact_id),
      semantic_artifact_types: semanticRefs.map((artifact) => artifact.artifact_type),
      video_keyframe_artifact_ids: keyframeRefs.map((artifact) => artifact.artifact_id),
      video_keyframe_count: keyframeRefs.length,
      transcript_artifact_ids: uniqueStrings(overlappingTranscriptSegments.map((segment) => segment.artifact_id)),
      transcript_segment_span_ids: overlappingTranscriptSegments.map((segment) => segment.text_span_id),
      transcript_time_ranges: overlappingTranscriptSegments.map((segment) => ({
        start_ms: segment.start_ms,
        end_ms: segment.end_ms
      })),
      face_observation_artifact_ids: faceRefs.map((observation) => observation.artifact_id),
      face_identity_ids: faceRefs.map((observation) => observation.face_identity_id),
      source_refs: [
        { type: "document", id: chunk.documentId },
        { type: "processing_run", id: processingRunId },
        { type: "artifact", id: textArtifactId },
        ...pageSourceRefs,
        ...semanticSourceRefs,
        ...transcriptSourceRefs,
        ...faceSourceRefs,
        { type: "artifact", id: artifactId },
        { type: "chunk", id: chunk.id }
      ]
    }
  };
}

function pageRefsForChunk(chunk: TextChunk, pageRefs: ExtractedPageArtifactRef[]): ExtractedPageArtifactRef[] {
  if (pageRefs.length === 0) {
    return [];
  }
  const startOffset = chunk.metadata.start_offset;
  const endOffset = chunk.metadata.end_offset;
  const overlapping = pageRefs.filter((page) => page.end_offset > startOffset && page.start_offset < endOffset);
  if (overlapping.length > 0) {
    return overlapping;
  }
  return pageRefs.filter((page) => page.start_offset <= startOffset && page.end_offset >= startOffset);
}

function transcriptRefsForChunk(chunk: TextChunk, transcriptRefs: ExtractedTranscriptSegmentRef[]): ExtractedTranscriptSegmentRef[] {
  if (transcriptRefs.length === 0) {
    return [];
  }
  const startOffset = chunk.metadata.start_offset;
  const endOffset = chunk.metadata.end_offset;
  const overlapping = transcriptRefs.filter((segment) => segment.end_offset > startOffset && segment.start_offset < endOffset);
  if (overlapping.length > 0) {
    return overlapping;
  }
  return transcriptRefs.filter((segment) => segment.start_offset <= startOffset && segment.end_offset >= startOffset);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
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

function deterministicFaceObservationId(artifactId: string): string {
  return `faceobs_${hashIdentifier(artifactId).slice(0, 32)}`;
}

function deterministicFaceEmbeddingId(artifactId: string): string {
  return `faceemb_${hashIdentifier(artifactId).slice(0, 32)}`;
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function derivedObjectKey(storageKey: string, suffix: string): string {
  return `${storageKey}.${suffix}`;
}

function documentVectorMetadata(document: DocumentRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    size_bytes: document.sizeBytes,
    mime_type: document.mimeType,
    original_filename: document.originalFilename
  };
  const documentMetadata = typeof document.metadata === "object" && document.metadata !== null
    ? document.metadata
    : {};
  const attachmentMetadata = readRecordFromRecord(documentMetadata, "attachment_metadata");
  for (const key of [
    "extension",
    "checksum_sha256",
    "media_type",
    "container",
    "duration_ms",
    "width",
    "height",
    "page_count",
    "frame_count",
    "codec",
    "magic_matched"
  ]) {
    const value = attachmentMetadata?.[key] ?? documentMetadata[key];
    if (value !== undefined && value !== null) {
      metadata[key] = value;
    }
  }
  return metadata;
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

function readNumberFromRecord(record: Record<string, unknown>, key: string): number | null {
  return typeof record[key] === "number" ? record[key] : null;
}

function readRecordFromRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readExtractionPageRefs(metadata: unknown): ExtractedPageArtifactRef[] {
  const record = typeof metadata === "object" && metadata !== null ? metadata as Record<string, unknown> : null;
  const value = record?.page_artifacts;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ExtractedPageArtifactRef => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const recordItem = item as Record<string, unknown>;
    return typeof recordItem.artifact_id === "string"
      && typeof recordItem.page_number === "number"
      && typeof recordItem.start_offset === "number"
      && typeof recordItem.end_offset === "number";
  });
}

function readExtractionSemanticArtifactRefs(metadata: unknown): ExtractedSemanticArtifactRef[] {
  const record = typeof metadata === "object" && metadata !== null ? metadata as Record<string, unknown> : null;
  const value = record?.semantic_artifacts;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ExtractedSemanticArtifactRef => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const recordItem = item as Record<string, unknown>;
    return typeof recordItem.artifact_id === "string"
      && typeof recordItem.artifact_type === "string"
      && typeof recordItem.span_type === "string";
  });
}

function readExtractionTranscriptSegmentRefs(metadata: unknown): ExtractedTranscriptSegmentRef[] {
  const record = typeof metadata === "object" && metadata !== null ? metadata as Record<string, unknown> : null;
  const value = record?.transcript_segments;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ExtractedTranscriptSegmentRef => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const recordItem = item as Record<string, unknown>;
    return typeof recordItem.artifact_id === "string"
      && typeof recordItem.text_span_id === "string"
      && typeof recordItem.segment_index === "number"
      && typeof recordItem.start_offset === "number"
      && typeof recordItem.end_offset === "number"
      && typeof recordItem.start_ms === "number"
      && typeof recordItem.end_ms === "number";
  });
}

function readExtractionFaceObservationRefs(metadata: unknown): ExtractedFaceObservationRef[] {
  const record = typeof metadata === "object" && metadata !== null ? metadata as Record<string, unknown> : null;
  const value = record?.face_observations;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ExtractedFaceObservationRef => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const recordItem = item as Record<string, unknown>;
    return typeof recordItem.artifact_id === "string"
      && typeof recordItem.observation_id === "string"
      && typeof recordItem.face_identity_id === "string";
  });
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
