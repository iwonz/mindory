import { randomUUID } from "node:crypto";
import { PGVECTOR_EMBEDDING_DIMENSIONS, type MindoryConfig } from "@mindory/config";
import { DocumentUploadService } from "@mindory/core/documents";
import { FaceService } from "@mindory/core/faces";
import { ContextBuilder, MemoryService } from "@mindory/core/memory";
import type { DocumentChunkSearchRepository } from "@mindory/core/memory";
import type { EmbeddingsProvider } from "@mindory/core/processing";
import { ProcessingJobDispatcher } from "@mindory/core/queue";
import { DocumentRecomputeService } from "@mindory/core/recompute";
import { UnifiedSearchService } from "@mindory/core/search";
import type { ObjectStorage } from "@mindory/core/storage";
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
import { ClamAvScanner } from "@mindory/processor-antivirus-clamav";
import { BullMqProcessingJobQueue } from "@mindory/queue-bullmq";
import { LocalFsObjectStorage } from "@mindory/storage-local-fs";
import { S3ObjectStorage } from "@mindory/storage-s3";
import { PgVectorChunkIndex, PgVectorDocumentChunkSearchRepository } from "@mindory/vector-pgvector";
import { QdrantDocumentChunkSearchRepository, QdrantVectorIndex } from "@mindory/vector-qdrant";
import type { BuildApiAppOptions } from "./app.js";

export interface ApiRuntimeDependencies extends Pick<
  BuildApiAppOptions,
  "artifacts" | "auth" | "close" | "context" | "documents" | "faces" | "jobs" | "memories" | "peers" | "projects" | "search" | "sessions" | "tokens"
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
  const artifactRepository = new DbDerivedArtifactRepository(database.db);
  const chunkSearchRepository = buildDocumentChunkSearchRepository(config, database.db);
  const memoryRepository = new DbMemoryRepository(database.db);
  const processingJobStore = new DbProcessingJobStore(database.db, () => `job_${randomUUID()}`);
  const jobDispatcher = new ProcessingJobDispatcher({
    store: processingJobStore,
    queue
  });
  const storage = buildObjectStorage(config);
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
    memories: {
      memoryService: new MemoryService({
        repository: memoryRepository
      })
    },
    search: {
      unifiedSearchService: new UnifiedSearchService({
        documentRepository: chunkSearchRepository,
        artifactRepository
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

function buildDocumentChunkSearchRepository(config: MindoryConfig, db: MindoryDatabase): DocumentChunkSearchRepository {
  const embeddings = buildEmbeddingsProvider(config);
  if (!embeddings) {
    return new DbDocumentChunkSearchRepository(db);
  }

  const vectorIndex = buildVectorIndex(config, db);
  if (vectorIndex.provider === "qdrant") {
    return new QdrantDocumentChunkSearchRepository({
      embeddings,
      vectorIndex
    });
  }

  return new PgVectorDocumentChunkSearchRepository({
    embeddings,
    vectorIndex
  });
}

function buildEmbeddingsProvider(config: MindoryConfig): EmbeddingsProvider | undefined {
  return buildMindoryLlm(config).textEmbeddings;
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
