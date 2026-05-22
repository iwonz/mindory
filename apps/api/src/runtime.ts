import { randomUUID } from "node:crypto";
import { PGVECTOR_EMBEDDING_DIMENSIONS, type MindoryConfig } from "@mindory/config";
import { DocumentUploadService } from "@mindory/core/documents";
import { FaceService } from "@mindory/core/faces";
import { ContextBuilder, MemoryService } from "@mindory/core/memory";
import type { DocumentChunkSearchRepository } from "@mindory/core/memory";
import type {
  EmbeddingsProvider,
  SearchVectorArtifactsInput,
  SearchVectorChunksInput,
  UpsertVectorArtifactsInput,
  UpsertVectorChunksInput,
  VectorArtifactIndexResult,
  VectorArtifactSearchHit,
  VectorIndex,
  VectorIndexResult,
  VectorSearchHit
} from "@mindory/core/processing";
import { ProcessingJobDispatcher } from "@mindory/core/queue";
import { DocumentRecomputeService } from "@mindory/core/recompute";
import { UnifiedSearchService } from "@mindory/core/search";
import type { ObjectStorage, PutObjectInput, StoredObject, StoredObjectBody } from "@mindory/core/storage";
import {
  DbAccessTokenRepository,
  createMindoryDatabaseClient,
  DbDocumentChunkSearchRepository,
  DbDocumentRepository,
  DbDerivedArtifactRepository,
  DbMemoryRepository,
  DbPeerRepository,
  DbProcessingJobStore,
  DbProjectRepository,
  DbSessionRepository,
  type MindoryDatabase
} from "@mindory/db";
import { buildMindoryLlm } from "@mindory/llm";
import {
  createMindoryTracer,
  createModelOperationLogEvent,
  createOtlpStructuredLogExporter,
  PrometheusMetricsRegistry,
  type MindoryTracer
} from "@mindory/observability";
import { ClamAvScanner } from "@mindory/processor-antivirus-clamav";
import { BullMqProcessingJobQueue } from "@mindory/queue-bullmq";
import { LocalFsObjectStorage } from "@mindory/storage-local-fs";
import { S3ObjectStorage } from "@mindory/storage-s3";
import { PgVectorArtifactSearchRepository, PgVectorChunkIndex, PgVectorDocumentChunkSearchRepository } from "@mindory/vector-pgvector";
import { QdrantArtifactSearchRepository, QdrantDocumentChunkSearchRepository, QdrantVectorIndex } from "@mindory/vector-qdrant";
import type { BuildApiAppOptions } from "./app.js";

export interface ApiRuntimeDependencies extends Pick<
  BuildApiAppOptions,
  "artifacts" | "auth" | "close" | "context" | "documents" | "faces" | "jobs" | "memories" | "metrics" | "peers" | "projects" | "search" | "sessions" | "tokens" | "tracing"
> {}

export function buildApiRuntimeDependencies(config: MindoryConfig): ApiRuntimeDependencies {
  const metrics = new PrometheusMetricsRegistry();
  const tracing = buildTracer(config, "api");
  const logExporter = createOtlpStructuredLogExporter({
    enabled: config.telemetry.logExportEnabled,
    serviceName: `${config.telemetry.serviceName}-api`,
    endpoint: config.telemetry.logExportEndpoint,
    headers: config.telemetry.logExportHeaders,
    timeoutMs: config.telemetry.logExportTimeoutMs
  });
  const database = createMindoryDatabaseClient(config.database.url);
  const queue = new BullMqProcessingJobQueue({
    redisUrl: config.redis.url,
    queuePrefix: config.redis.queuePrefix
  });
  const accessTokenRepository = new DbAccessTokenRepository(database.db);
  const projectRepository = new DbProjectRepository(database.db);
  const peerRepository = new DbPeerRepository(database.db);
  const sessionRepository = new DbSessionRepository(database.db);
  const documentRepository = new DbDocumentRepository(database.db);
  const artifactRepository = new DbDerivedArtifactRepository(database.db);
  const llm = buildMindoryLlm(config, {
    auditSink: (audit) => {
      metrics.recordModelOperation(audit);
      tracing.recordModelOperation(audit);
      logExporter.export(createModelOperationLogEvent(audit));
    }
  });
  const vectorSearch = buildVectorSearchRepositories(config, database.db, metrics, tracing, llm.textEmbeddings);
  const chunkSearchRepository = vectorSearch.documentRepository;
  const memoryRepository = new DbMemoryRepository(database.db);
  const processingJobStore = new DbProcessingJobStore(database.db, () => `job_${randomUUID()}`);
  const jobDispatcher = new ProcessingJobDispatcher({
    store: processingJobStore,
    queue,
    metadataFactory: () => tracing.currentTraceMetadata()
  });
  const storage = instrumentObjectStorage(buildObjectStorage(config), metrics, tracing);
  const uploadServiceOptions = {
    storage,
    documents: documentRepository,
    jobs: jobDispatcher,
    antivirusPolicy: {
      enabled: config.antivirus.enabled,
      provider: config.antivirus.provider,
      mode: config.antivirus.mode,
      onScanFailure: config.antivirus.onScanFailure,
      onInfected: config.antivirus.onInfected
    },
    routeAfterUpload: config.documentProcessing.routingEnabled,
    routeProcessorVersion: "document-route-v1"
  };
  const uploadScanner = buildUploadScanner(config);
  if (uploadScanner !== undefined) {
    Object.assign(uploadServiceOptions, { scanner: uploadScanner });
  }
  const uploadService = new DocumentUploadService(uploadServiceOptions);
  const recomputeService = new DocumentRecomputeService({
    documents: documentRepository,
    jobs: jobDispatcher,
    requestIdFactory: () => `recompute_${randomUUID()}`
  });

  return {
    artifacts: {
      artifactRepository
    },
    auth: {
      accessTokenRepository
    },
    tokens: {
      accessTokenRepository,
      idFactory: randomUUID
    },
    projects: {
      projectRepository
    },
    peers: {
      peerRepository
    },
    sessions: {
      sessionRepository,
      jobDispatcher,
      idFactory: randomUUID
    },
    documents: {
      uploadService,
      documentRepository,
      chunkSearchRepository,
      artifactRepository,
      recomputeService
    },
    faces: {
      faceService: new FaceService({
        repository: artifactRepository
      })
    },
    jobs: {
      jobStore: processingJobStore,
      jobDispatcher
    },
    metrics: {
      registry: metrics,
      queues: [queue]
    },
    tracing,
    memories: {
      memoryService: new MemoryService({
        repository: memoryRepository
      })
    },
    search: {
      unifiedSearchService: new UnifiedSearchService({
        documentRepository: chunkSearchRepository,
        artifactRepository,
        ...(vectorSearch.artifactRepository === undefined ? {} : { artifactVectorRepository: vectorSearch.artifactRepository })
      })
    },
    context: {
      contextBuilder: new ContextBuilder({
        memoryRepository,
        sessionRepository,
        documentRepository: chunkSearchRepository
      })
    },
    close: async () => {
      await logExporter.shutdown();
      await tracing.shutdown();
      await queue.close();
      await database.close();
    }
  };
}

function buildTracer(config: MindoryConfig, service: string): MindoryTracer {
  return createMindoryTracer({
    enabled: config.telemetry.tracesEnabled,
    serviceName: `${config.telemetry.serviceName}-${service}`,
    endpoint: config.telemetry.tracesEndpoint,
    headers: config.telemetry.tracesHeaders,
    timeoutMs: config.telemetry.tracesTimeoutMs,
    sampleRate: config.telemetry.sampleRate
  });
}

function buildUploadScanner(config: MindoryConfig): ClamAvScanner | undefined {
  if (!config.antivirus.enabled || config.antivirus.mode !== "sync_scan" || config.antivirus.provider !== "clamav") {
    return undefined;
  }
  return new ClamAvScanner({
    host: config.antivirus.clamavHost,
    port: config.antivirus.clamavPort
  });
}

function buildObjectStorage(config: MindoryConfig): ObjectStorage {
  if (config.storage.provider === "local-fs") {
    return new LocalFsObjectStorage({
      rootPath: config.storage.localPath
    });
  }

  return new S3ObjectStorage({
    endpoint: config.storage.s3.endpoint,
    region: config.storage.s3.region,
    bucket: config.storage.s3.bucket,
    accessKeyId: config.storage.s3.accessKeyId,
    secretAccessKey: config.storage.s3.secretAccessKey,
    forcePathStyle: config.storage.s3.forcePathStyle
  });
}

function buildVectorSearchRepositories(
  config: MindoryConfig,
  db: MindoryDatabase,
  metrics: PrometheusMetricsRegistry,
  tracing: MindoryTracer,
  embeddings: EmbeddingsProvider | undefined
): {
  documentRepository: DocumentChunkSearchRepository;
  artifactRepository?: PgVectorArtifactSearchRepository | QdrantArtifactSearchRepository;
} {
  if (!embeddings) {
    return {
      documentRepository: new DbDocumentChunkSearchRepository(db)
    };
  }

  const vectorIndex = instrumentVectorIndex(buildVectorIndex(config, db), metrics, tracing);
  if (vectorIndex.provider === "qdrant") {
    return {
      documentRepository: new QdrantDocumentChunkSearchRepository({
        embeddings,
        vectorIndex
      }),
      artifactRepository: new QdrantArtifactSearchRepository({
        embeddings,
        vectorIndex
      })
    };
  }

  return {
    documentRepository: new PgVectorDocumentChunkSearchRepository({
      embeddings,
      vectorIndex
    }),
    artifactRepository: new PgVectorArtifactSearchRepository({
      embeddings,
      vectorIndex
    })
  };
}

function buildVectorIndex(config: MindoryConfig, db: MindoryDatabase): PgVectorChunkIndex | QdrantVectorIndex {
  const dimensions = configuredVectorDimensions(config);
  if (config.vector.provider === "qdrant") {
    return new QdrantVectorIndex({
      url: config.vector.qdrantUrl,
      collectionPrefix: config.vector.qdrantCollectionPrefix,
      dimensions
    });
  }

  return new PgVectorChunkIndex({
    db,
    dimensions
  });
}

class MetricsObjectStorage implements ObjectStorage {
  readonly provider;

  constructor(private readonly inner: ObjectStorage, private readonly metrics: PrometheusMetricsRegistry, private readonly tracing: MindoryTracer) {
    this.provider = inner.provider;
  }

  putObject(input: PutObjectInput): Promise<StoredObject> {
    return recordStorage(this.metrics, this.tracing, this.provider, "put_object", () => this.inner.putObject(input));
  }

  getObject(key: string): Promise<StoredObjectBody> {
    return recordStorage(this.metrics, this.tracing, this.provider, "get_object", () => this.inner.getObject(key));
  }

  statObject(key: string): Promise<StoredObject> {
    return recordStorage(this.metrics, this.tracing, this.provider, "stat_object", () => this.inner.statObject(key));
  }

  objectExists(key: string): Promise<boolean> {
    return recordStorage(this.metrics, this.tracing, this.provider, "object_exists", () => this.inner.objectExists(key));
  }

  deleteObject(key: string): Promise<void> {
    return recordStorage(this.metrics, this.tracing, this.provider, "delete_object", () => this.inner.deleteObject(key));
  }
}

class MetricsVectorIndex implements VectorIndex {
  readonly provider;

  constructor(private readonly inner: VectorIndex, private readonly metrics: PrometheusMetricsRegistry, private readonly tracing: MindoryTracer) {
    this.provider = inner.provider;
  }

  upsertDocumentChunks(input: UpsertVectorChunksInput): Promise<VectorIndexResult[]> {
    return recordVector(this.metrics, this.tracing, this.provider, "upsert_document_chunks", () => this.inner.upsertDocumentChunks(input));
  }

  upsertArtifactVectors(input: UpsertVectorArtifactsInput): Promise<VectorArtifactIndexResult[]> {
    return recordVector(this.metrics, this.tracing, this.provider, "upsert_artifact_vectors", () => this.inner.upsertArtifactVectors(input));
  }

  deleteDocumentChunks(projectId: string, documentId: string): Promise<void> {
    return recordVector(this.metrics, this.tracing, this.provider, "delete_document_chunks", () => this.inner.deleteDocumentChunks(projectId, documentId));
  }

  deleteDocumentArtifactVectors(projectId: string, documentId: string): Promise<void> {
    return recordVector(this.metrics, this.tracing, this.provider, "delete_document_artifact_vectors", () => this.inner.deleteDocumentArtifactVectors(projectId, documentId));
  }

  searchDocumentChunks(input: SearchVectorChunksInput): Promise<VectorSearchHit[]> {
    return recordVector(this.metrics, this.tracing, this.provider, "search_document_chunks", () => this.inner.searchDocumentChunks(input));
  }

  searchArtifactVectors(input: SearchVectorArtifactsInput): Promise<VectorArtifactSearchHit[]> {
    return recordVector(this.metrics, this.tracing, this.provider, "search_artifact_vectors", () => this.inner.searchArtifactVectors(input));
  }
}

function instrumentObjectStorage(storage: ObjectStorage, metrics: PrometheusMetricsRegistry, tracing: MindoryTracer): ObjectStorage {
  return new MetricsObjectStorage(storage, metrics, tracing);
}

function instrumentVectorIndex<T extends VectorIndex>(vectorIndex: T, metrics: PrometheusMetricsRegistry, tracing: MindoryTracer): T {
  return new MetricsVectorIndex(vectorIndex, metrics, tracing) as unknown as T;
}

async function recordStorage<T>(metrics: PrometheusMetricsRegistry, tracing: MindoryTracer, provider: string, operation: string, run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await run();
    const durationMs = performance.now() - startedAt;
    metrics.recordStorageOperation({ provider, operation, status: "success", durationMs });
    tracing.recordOperation({ name: `storage.${operation}`, kind: "client", provider, operation, status: "success", durationMs });
    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    metrics.recordStorageOperation({ provider, operation, status: "failed", durationMs });
    tracing.recordOperation({ name: `storage.${operation}`, kind: "client", provider, operation, status: "failed", durationMs, attributes: { "error.type": error instanceof Error ? error.name : typeof error } });
    throw error;
  }
}

async function recordVector<T>(metrics: PrometheusMetricsRegistry, tracing: MindoryTracer, provider: string, operation: string, run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await run();
    const durationMs = performance.now() - startedAt;
    metrics.recordVectorOperation({ provider, operation, status: "success", durationMs });
    tracing.recordOperation({ name: `vector.${operation}`, kind: "client", provider, operation, status: "success", durationMs });
    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    metrics.recordVectorOperation({ provider, operation, status: "failed", durationMs });
    tracing.recordOperation({ name: `vector.${operation}`, kind: "client", provider, operation, status: "failed", durationMs, attributes: { "error.type": error instanceof Error ? error.name : typeof error } });
    throw error;
  }
}

function configuredVectorDimensions(config: MindoryConfig): number {
  const textDimensions = config.llm.textEmbedding.enabled
    ? config.llm.textEmbedding.dimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS
    : null;
  const imageDimensions = config.llm.imageEmbedding.enabled
    ? config.llm.imageEmbedding.dimensions ?? textDimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS
    : null;
  return textDimensions ?? imageDimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS;
}
