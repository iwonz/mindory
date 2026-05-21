import { randomUUID } from "node:crypto";
import { loadMindoryConfig, PGVECTOR_EMBEDDING_DIMENSIONS, type MindoryConfig } from "@mindory/config";
import { ProcessingJobDispatcher, type ProcessingJobProcessor } from "@mindory/core/queue";
import {
  createMindoryDatabaseClient,
  DbDocumentChunkRepository,
  DbDocumentRepository,
  DbMemoryRepository,
  DbProcessingJobStore,
  DbSessionRepository
} from "@mindory/db";
import { BullMqProcessingJobQueue } from "@mindory/queue-bullmq";
import { LocalFsObjectStorage } from "@mindory/storage-local-fs";
import { PgVectorChunkIndex } from "@mindory/vector-pgvector";
import { buildDocumentPipelineProcessors, buildEmbeddingsProvider, type DocumentPipelineProcessorOptions } from "./document-pipeline.js";
import { buildMemoryRuntimeProcessors } from "./memory-pipeline.js";
import { buildWorkerBaseRunner, type WorkerBaseRunner } from "./runner.js";

export interface WorkerRuntime {
  runner: WorkerBaseRunner;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function buildWorkerRuntime(config: MindoryConfig = loadMindoryConfig()): WorkerRuntime {
  if (config.storage.provider !== "local-fs") {
    throw new Error("Only local-fs object storage is wired in the worker runtime. S3/MinIO remains a future adapter task.");
  }

  const database = createMindoryDatabaseClient(config.database.url);
  const queue = new BullMqProcessingJobQueue({
    redisUrl: config.redis.url,
    queuePrefix: config.redis.queuePrefix
  });
  const storage = new LocalFsObjectStorage({
    rootPath: config.storage.localPath
  });
  const documents = new DbDocumentRepository(database.db);
  const chunks = new DbDocumentChunkRepository(database.db);
  const sessions = new DbSessionRepository(database.db);
  const memories = new DbMemoryRepository(database.db);
  const store = new DbProcessingJobStore(database.db, () => `job_${randomUUID()}`);
  const dispatcher = new ProcessingJobDispatcher({
    store,
    queue
  });
  const processorOptions: DocumentPipelineProcessorOptions = {
    config,
    storage,
    documents,
    chunks,
    jobs: dispatcher
  } satisfies Parameters<typeof buildDocumentPipelineProcessors>[0];
  const embeddings = buildEmbeddingsProvider(config);
  if (embeddings) {
    processorOptions.embeddings = embeddings;
    processorOptions.vectorIndex = new PgVectorChunkIndex({
      db: database.db,
      dimensions: config.modelRuntime.textEmbedding.dimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS
    });
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
