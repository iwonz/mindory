import { randomUUID } from "node:crypto";
import type { MindoryConfig } from "@mindory/config";
import { DocumentUploadService } from "@mindory/core/documents";
import { ContextBuilder, MemoryService } from "@mindory/core/memory";
import type { DocumentChunkSearchRepository } from "@mindory/core/memory";
import type { EmbeddingsProvider } from "@mindory/core/processing";
import { ProcessingJobDispatcher } from "@mindory/core/queue";
import {
  DbAccessTokenRepository,
  createMindoryDatabaseClient,
  DbDocumentChunkSearchRepository,
  DbDocumentRepository,
  DbMemoryRepository,
  DbPeerRepository,
  DbProcessingJobStore,
  DbProjectRepository,
  DbSessionRepository,
  type MindoryDatabase
} from "@mindory/db";
import { BullMqProcessingJobQueue } from "@mindory/queue-bullmq";
import { LocalFsObjectStorage } from "@mindory/storage-local-fs";
import { OpenAICompatibleEmbeddingsProvider, type OpenAICompatibleEmbeddingsOptions } from "@mindory/embeddings-openai-compatible";
import { OllamaEmbeddingsProvider } from "@mindory/embeddings-ollama";
import { PgVectorChunkIndex, PgVectorDocumentChunkSearchRepository } from "@mindory/vector-pgvector";
import type { BuildApiAppOptions } from "./app.js";

export interface ApiRuntimeDependencies extends Pick<
  BuildApiAppOptions,
  "auth" | "close" | "context" | "documents" | "jobs" | "memories" | "peers" | "projects" | "sessions"
> {}

export function buildApiRuntimeDependencies(config: MindoryConfig): ApiRuntimeDependencies {
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
  const chunkSearchRepository = buildDocumentChunkSearchRepository(config, database.db);
  const memoryRepository = new DbMemoryRepository(database.db);
  const processingJobStore = new DbProcessingJobStore(database.db, () => `job_${randomUUID()}`);
  const jobDispatcher = new ProcessingJobDispatcher({
    store: processingJobStore,
    queue
  });
  const storage = buildObjectStorage(config);
  const uploadService = new DocumentUploadService({
    storage,
    documents: documentRepository,
    jobs: jobDispatcher,
    antivirusPolicy: {
      enabled: config.antivirus.enabled,
      provider: config.antivirus.provider,
      mode: config.antivirus.mode,
      onScanFailure: config.antivirus.onScanFailure,
      onInfected: config.antivirus.onInfected
    }
  });

  return {
    auth: {
      accessTokenRepository
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
      chunkSearchRepository
    },
    jobs: {
      jobStore: processingJobStore,
      jobDispatcher
    },
    memories: {
      memoryService: new MemoryService({
        repository: memoryRepository
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
      await queue.close();
      await database.close();
    }
  };
}

function buildObjectStorage(config: MindoryConfig): LocalFsObjectStorage {
  if (config.storage.provider !== "local-fs") {
    throw new Error("Only local-fs object storage is wired in the API runtime. S3/MinIO remains a future adapter task.");
  }

  return new LocalFsObjectStorage({
    rootPath: config.storage.localPath
  });
}

function buildDocumentChunkSearchRepository(config: MindoryConfig, db: MindoryDatabase): DocumentChunkSearchRepository {
  const embeddings = buildEmbeddingsProvider(config);
  if (!embeddings) {
    return new DbDocumentChunkSearchRepository(db);
  }

  return new PgVectorDocumentChunkSearchRepository({
    embeddings,
    vectorIndex: new PgVectorChunkIndex({
      db,
      dimensions: config.embeddings.dimensions ?? 1536
    })
  });
}

function buildEmbeddingsProvider(config: MindoryConfig): EmbeddingsProvider | undefined {
  if (config.embeddings.provider === "openai-compatible") {
    const options: OpenAICompatibleEmbeddingsOptions = {
      baseUrl: config.embeddings.openaiCompatibleBaseUrl,
      model: config.embeddings.model
    };
    if (config.embeddings.openaiCompatibleApiKey) {
      options.apiKey = config.embeddings.openaiCompatibleApiKey;
    }
    if (config.embeddings.dimensions !== null) {
      options.dimensions = config.embeddings.dimensions;
    }
    return new OpenAICompatibleEmbeddingsProvider(options);
  }
  if (config.embeddings.provider === "ollama") {
    return new OllamaEmbeddingsProvider({
      baseUrl: config.embeddings.ollamaBaseUrl,
      model: config.embeddings.model
    });
  }
  return undefined;
}
