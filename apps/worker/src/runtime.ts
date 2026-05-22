import { randomUUID } from "node:crypto";
import { loadMindoryConfig, PGVECTOR_EMBEDDING_DIMENSIONS, type MindoryConfig } from "@mindory/config";
import { ProcessingJobDispatcher, type ProcessingJobProcessor } from "@mindory/core/queue";
import type { ObjectStorage } from "@mindory/core/storage";
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
import { BullMqProcessingJobQueue } from "@mindory/queue-bullmq";
import { LocalFsObjectStorage } from "@mindory/storage-local-fs";
import { S3ObjectStorage } from "@mindory/storage-s3";
import { PgVectorChunkIndex } from "@mindory/vector-pgvector";
import { QdrantVectorIndex } from "@mindory/vector-qdrant";
import { buildDocumentPipelineProcessors, type DocumentPipelineProcessorOptions } from "./document-pipeline.js";
import { buildMemoryRuntimeProcessors } from "./memory-pipeline.js";
import { buildWorkerBaseRunner, type WorkerBaseRunner } from "./runner.js";

export interface WorkerRuntime {
  runner: WorkerBaseRunner;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function buildWorkerRuntime(config: MindoryConfig = loadMindoryConfig()): WorkerRuntime {
  const database = createMindoryDatabaseClient(config.database.url);
  const queue = new BullMqProcessingJobQueue({
    redisUrl: config.redis.url,
    queuePrefix: config.redis.queuePrefix
  });
  const storage = buildObjectStorage(config);
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
  const llm = buildMindoryLlm(config);
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
    processorOptions.vectorIndex = buildVectorIndex(config, database.db);
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
    processors
  });

  return {
    runner,
    start: () => runner.start(),
    close: async () => {
      await runner.close();
      await queue.close();
      await database.close();
    }
  };
}

function buildVectorIndex(config: MindoryConfig, db: MindoryDatabase): PgVectorChunkIndex | QdrantVectorIndex {
  const dimensions = config.llm.textEmbedding.dimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS;
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
