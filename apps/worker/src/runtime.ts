import { randomUUID } from "node:crypto";
import { loadMindoryConfig, PGVECTOR_EMBEDDING_DIMENSIONS, type MindoryConfig } from "@mindory/config";
import { ProcessingJobDispatcher, type ProcessingJobProcessor } from "@mindory/core/queue";
import type {
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
import type { ObjectStorage, PutObjectInput, StoredObject, StoredObjectBody } from "@mindory/core/storage";
import {
  createMindoryDatabaseClient,
  DbDocumentChunkRepository,
  DbDocumentRepository,
  DbDerivedArtifactRepository,
  DbMemoryRepository,
  DbProcessingJobStore,
  DbSessionRepository,
  type MindoryDatabase
} from "@mindory/db";
import { buildMindoryLlm } from "@mindory/llm";
import { PrometheusMetricsRegistry, type PrometheusMetricsHttpServer } from "@mindory/observability";
import { BullMqProcessingJobQueue } from "@mindory/queue-bullmq";
import { LocalFsObjectStorage } from "@mindory/storage-local-fs";
import { S3ObjectStorage } from "@mindory/storage-s3";
import { PgVectorChunkIndex } from "@mindory/vector-pgvector";
import { QdrantVectorIndex } from "@mindory/vector-qdrant";
import { buildDocumentPipelineProcessors, type DocumentPipelineProcessorOptions } from "./document-pipeline.js";
import { buildMemoryRuntimeProcessors } from "./memory-pipeline.js";
import { createWorkerMetricsServer } from "./metrics-server.js";
import { buildWorkerBaseRunner, type WorkerBaseRunner } from "./runner.js";

export interface WorkerRuntime {
  runner: WorkerBaseRunner;
  metrics: PrometheusMetricsRegistry;
  metricsServer: PrometheusMetricsHttpServer;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function buildWorkerRuntime(config: MindoryConfig = loadMindoryConfig()): WorkerRuntime {
  const metrics = new PrometheusMetricsRegistry();
  const database = createMindoryDatabaseClient(config.database.url);
  const queue = new BullMqProcessingJobQueue({
    redisUrl: config.redis.url,
    queuePrefix: config.redis.queuePrefix
  });
  const storage = instrumentObjectStorage(buildObjectStorage(config), metrics);
  const documents = new DbDocumentRepository(database.db);
  const artifacts = new DbDerivedArtifactRepository(database.db);
  const chunks = new DbDocumentChunkRepository(database.db);
  const sessions = new DbSessionRepository(database.db);
  const memories = new DbMemoryRepository(database.db);
  const store = new DbProcessingJobStore(database.db, () => `job_${randomUUID()}`);
  const dispatcher = new ProcessingJobDispatcher({
    store,
    queue
  });
  const llm = buildMindoryLlm(config, {
    auditSink: (audit) => metrics.recordModelOperation(audit)
  });
  const processorOptions: DocumentPipelineProcessorOptions = {
    config,
    storage,
    documents,
    artifacts,
    chunks,
    jobs: dispatcher,
    llm
  } satisfies Parameters<typeof buildDocumentPipelineProcessors>[0];
  const embeddings = llm.textEmbeddings;
  if (embeddings) {
    processorOptions.embeddings = embeddings;
  }
  if (embeddings || llm.imageEmbeddings) {
    processorOptions.vectorIndex = instrumentVectorIndex(buildVectorIndex(config, database.db), metrics);
  }
  const documentProcessors = buildDocumentPipelineProcessors(processorOptions);
  const memoryProcessors = new Map<string, ProcessingJobProcessor>(buildMemoryRuntimeProcessors({
    sessions,
    memories
  }).map((processor) => [processor.type, processor]));
  const processors = {
    getProcessor: (type: Parameters<typeof documentProcessors.getProcessor>[0]) => (
      documentProcessors.getProcessor(type) ?? memoryProcessors.get(type)
    )
  };
  const runner = buildWorkerBaseRunner({
    config,
    store,
    processors,
    metrics
  });
  const metricsServer = createWorkerMetricsServer(config, metrics, queue);

  return {
    runner,
    metrics,
    metricsServer,
    start: async () => {
      await runner.start();
      await metricsServer.start();
    },
    close: async () => {
      await metricsServer.close();
      await runner.close();
      await queue.close();
      await database.close();
    }
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

function configuredVectorDimensions(config: MindoryConfig): number {
  const textDimensions = config.llm.textEmbedding.enabled
    ? config.llm.textEmbedding.dimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS
    : null;
  const imageDimensions = config.llm.imageEmbedding.enabled
    ? config.llm.imageEmbedding.dimensions ?? textDimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS
    : null;
  return textDimensions ?? imageDimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS;
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

class MetricsObjectStorage implements ObjectStorage {
  readonly provider;

  constructor(private readonly inner: ObjectStorage, private readonly metrics: PrometheusMetricsRegistry) {
    this.provider = inner.provider;
  }

  putObject(input: PutObjectInput): Promise<StoredObject> {
    return recordStorage(this.metrics, this.provider, "put_object", () => this.inner.putObject(input));
  }

  getObject(key: string): Promise<StoredObjectBody> {
    return recordStorage(this.metrics, this.provider, "get_object", () => this.inner.getObject(key));
  }

  statObject(key: string): Promise<StoredObject> {
    return recordStorage(this.metrics, this.provider, "stat_object", () => this.inner.statObject(key));
  }

  objectExists(key: string): Promise<boolean> {
    return recordStorage(this.metrics, this.provider, "object_exists", () => this.inner.objectExists(key));
  }

  deleteObject(key: string): Promise<void> {
    return recordStorage(this.metrics, this.provider, "delete_object", () => this.inner.deleteObject(key));
  }
}

class MetricsVectorIndex implements VectorIndex {
  readonly provider;

  constructor(private readonly inner: VectorIndex, private readonly metrics: PrometheusMetricsRegistry) {
    this.provider = inner.provider;
  }

  upsertDocumentChunks(input: UpsertVectorChunksInput): Promise<VectorIndexResult[]> {
    return recordVector(this.metrics, this.provider, "upsert_document_chunks", () => this.inner.upsertDocumentChunks(input));
  }

  upsertArtifactVectors(input: UpsertVectorArtifactsInput): Promise<VectorArtifactIndexResult[]> {
    return recordVector(this.metrics, this.provider, "upsert_artifact_vectors", () => this.inner.upsertArtifactVectors(input));
  }

  deleteDocumentChunks(projectId: string, documentId: string): Promise<void> {
    return recordVector(this.metrics, this.provider, "delete_document_chunks", () => this.inner.deleteDocumentChunks(projectId, documentId));
  }

  deleteDocumentArtifactVectors(projectId: string, documentId: string): Promise<void> {
    return recordVector(this.metrics, this.provider, "delete_document_artifact_vectors", () => this.inner.deleteDocumentArtifactVectors(projectId, documentId));
  }

  searchDocumentChunks(input: SearchVectorChunksInput): Promise<VectorSearchHit[]> {
    return recordVector(this.metrics, this.provider, "search_document_chunks", () => this.inner.searchDocumentChunks(input));
  }

  searchArtifactVectors(input: SearchVectorArtifactsInput): Promise<VectorArtifactSearchHit[]> {
    return recordVector(this.metrics, this.provider, "search_artifact_vectors", () => this.inner.searchArtifactVectors(input));
  }
}

function instrumentObjectStorage(storage: ObjectStorage, metrics: PrometheusMetricsRegistry): ObjectStorage {
  return new MetricsObjectStorage(storage, metrics);
}

function instrumentVectorIndex<T extends VectorIndex>(vectorIndex: T, metrics: PrometheusMetricsRegistry): T {
  return new MetricsVectorIndex(vectorIndex, metrics) as unknown as T;
}

async function recordStorage<T>(metrics: PrometheusMetricsRegistry, provider: string, operation: string, run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await run();
    metrics.recordStorageOperation({ provider, operation, status: "success", durationMs: performance.now() - startedAt });
    return result;
  } catch (error) {
    metrics.recordStorageOperation({ provider, operation, status: "failed", durationMs: performance.now() - startedAt });
    throw error;
  }
}

async function recordVector<T>(metrics: PrometheusMetricsRegistry, provider: string, operation: string, run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await run();
    metrics.recordVectorOperation({ provider, operation, status: "success", durationMs: performance.now() - startedAt });
    return result;
  } catch (error) {
    metrics.recordVectorOperation({ provider, operation, status: "failed", durationMs: performance.now() - startedAt });
    throw error;
  }
}
