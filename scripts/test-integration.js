import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import pg from "../packages/db/node_modules/pg/lib/index.js";

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerComposeFiles = ["-f", "docker-compose.yml", "-f", "docker-compose.test.yml"];
const testRunId = `task30_${Date.now()}_${randomUUID().slice(0, 8)}`;
const projectId = `project_${testRunId}`;
const bootstrapToken = `token_${testRunId}`;
const postgresPort = process.env.MINDORY_TEST_POSTGRES_PORT ?? "55432";
const redisPort = process.env.MINDORY_TEST_REDIS_PORT ?? "56379";
const qdrantPort = process.env.MINDORY_TEST_QDRANT_PORT ?? "56333";
const databaseUrl = process.env.MINDORY_TEST_DATABASE_URL ?? `postgresql://mindory:mindory@127.0.0.1:${postgresPort}/mindory`;
const redisUrl = process.env.MINDORY_TEST_REDIS_URL ?? `redis://127.0.0.1:${redisPort}`;
const qdrantUrl = process.env.MINDORY_TEST_QDRANT_URL ?? `http://127.0.0.1:${qdrantPort}`;
const storagePath = path.join(os.tmpdir(), `mindory-integration-${testRunId}`);
const queuePrefix = `mindory:test:${testRunId}`;
const nativePdfFixture = JSON.parse(await readFile(path.join(root, "fixtures/docling/native-pdf.json"), "utf8"));
const scannedPdfFixture = JSON.parse(await readFile(path.join(root, "fixtures/docling/scanned-pdf.json"), "utf8"));
const testEnv = {
  ...process.env,
  MINDORY_LOG_LEVEL: "error",
  MINDORY_DATABASE_URL: databaseUrl,
  MINDORY_REDIS_URL: redisUrl,
  MINDORY_QUEUE_PREFIX: queuePrefix,
  MINDORY_CACHE_PREFIX: `mindory:test-cache:${testRunId}`,
  MINDORY_STORAGE_PROVIDER: "local-fs",
  MINDORY_STORAGE_LOCAL_PATH: storagePath,
  MINDORY_INSTALL_ALLOW_EXPERIMENTAL: "true",
  MINDORY_AV_ENABLED: "false",
  MINDORY_AV_PROVIDER: "disabled",
  MINDORY_AV_MODE: "disabled",
  MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED: "true",
  MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED: "true",
  MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED: "true",
  MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED: "true",
  MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES: "3",
  MINDORY_LLM_ASR_ENABLED: "true",
  MINDORY_LLM_ASR_PROVIDER: "local-http",
  MINDORY_LLM_ASR_MODEL: "whisper-tiny-fallback",
  MINDORY_LLM_FACE_DETECTION_ENABLED: "true",
  MINDORY_LLM_FACE_RECOGNITION_ENABLED: "true",
  MINDORY_LLM_TEXT_EMBEDDING_ENABLED: "false",
  MINDORY_LLM_TEXT_EMBEDDING_PROVIDER: "disabled",
  MINDORY_WORKER_CONCURRENCY: "1"
};

await buildWorkspaces();
await startIntegrationInfrastructure();
await waitForTcp("127.0.0.1", Number(postgresPort), "PostgreSQL");
await waitForTcp("127.0.0.1", Number(redisPort), "Redis");
await waitForTcp("127.0.0.1", Number(qdrantPort), "Qdrant");
await waitForPostgres();
await waitForQdrant();
await runMigration();
await mkdir(storagePath, { recursive: true });

const modules = await loadRuntimeModules();

test("API request guard rate-limits non-health requests", async () => {
  const config = modules.loadMindoryConfig({
    ...testEnv,
    MINDORY_API_RATE_LIMIT_ENABLED: "true",
    MINDORY_API_RATE_LIMIT_WINDOW_MS: "60000",
    MINDORY_API_RATE_LIMIT_MAX: "1"
  });
  const apiApp = await modules.buildApiApp({ config, logger: false, allowDependencyFreeRoutes: true });

  try {
    const firstHealth = await apiApp.inject({ method: "GET", url: "/health" });
    const secondHealth = await apiApp.inject({ method: "GET", url: "/health" });
    assert.equal(firstHealth.statusCode, 200);
    assert.equal(secondHealth.statusCode, 200);

    const firstApiResponse = await apiApp.inject({
      method: "GET",
      url: `/v1/projects/${encodeURIComponent(projectId)}`,
      headers: {
        authorization: "Bearer request-guard-test"
      }
    });
    assert.notEqual(firstApiResponse.statusCode, 429);
    assert.equal(firstApiResponse.headers["x-ratelimit-limit"], "1");
    assert.equal(firstApiResponse.headers["x-ratelimit-remaining"], "0");

    const secondApiResponse = await apiApp.inject({
      method: "GET",
      url: `/v1/projects/${encodeURIComponent(projectId)}`,
      headers: {
        authorization: "Bearer request-guard-test"
      }
    });
    const body = JSON.parse(secondApiResponse.body);
    assert.equal(secondApiResponse.statusCode, 429);
    assert.equal(body.error.code, "rate_limited");
  } finally {
    await apiApp.close();
  }
});

test("sync_scan upload waits for antivirus verdict and applies policies", { timeout: 120_000 }, async () => {
  const scanRunId = `task94_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const scanStoragePath = path.join(os.tmpdir(), `mindory-sync-scan-${scanRunId}`);
  const clamd = await startClamdProtocolServer();

  try {
    await mkdir(scanStoragePath, { recursive: true });
    await withSyncScanApi({
      runId: scanRunId,
      storagePath: scanStoragePath,
      clamavPort: clamd.port,
      onInfected: "quarantine",
      onScanFailure: "block"
    }, async ({ apiUrl, projectId: syncProjectId, token: syncToken }) => {
      const cleanUpload = await uploadRawDocument({
        apiUrl,
        projectId: syncProjectId,
        token: syncToken,
        filename: "clean-sync-scan.txt",
        text: "clean document should wait for a ClamAV verdict before routing."
      });
      assert.equal(cleanUpload.document.status, "scan_clean");
      assert.equal(cleanUpload.scan_job, null);
      assert.equal(typeof cleanUpload.route_job?.id, "string", "clean sync_scan upload should enqueue routing after the verdict.");
      const cleanDocument = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(cleanUpload.document.id)}?projectId=${encodeURIComponent(syncProjectId)}`, undefined, syncToken);
      assert.equal(cleanDocument.metadata.antivirus.verdict, "clean");
      assert.equal(cleanDocument.metadata.antivirus.rawReply, "stream: OK");

      const infectedUpload = await uploadRawDocument({
        apiUrl,
        projectId: syncProjectId,
        token: syncToken,
        filename: "infected-sync-scan.txt",
        text: "EICAR-STANDARD-ANTIVIRUS-TEST-FILE"
      });
      assert.equal(infectedUpload.document.status, "quarantined");
      assert.equal(infectedUpload.scan_job, null);
      assert.equal(infectedUpload.route_job, null);
      const infectedDocument = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(infectedUpload.document.id)}?projectId=${encodeURIComponent(syncProjectId)}`, undefined, syncToken);
      assert.equal(infectedDocument.metadata.antivirus.verdict, "infected");
      assert.equal(infectedDocument.metadata.antivirus.signature, "Eicar-Test-Signature");
    });

    await withSyncScanApi({
      runId: `${scanRunId}_delete`,
      storagePath: path.join(scanStoragePath, "delete-policy"),
      clamavPort: clamd.port,
      onInfected: "delete",
      onScanFailure: "block"
    }, async ({ apiUrl, projectId: syncProjectId, token: syncToken, runtime }) => {
      const infectedUpload = await uploadRawDocument({
        apiUrl,
        projectId: syncProjectId,
        token: syncToken,
        filename: "infected-delete-sync-scan.txt",
        text: "EICAR-STANDARD-ANTIVIRUS-TEST-FILE"
      });
      assert.equal(infectedUpload.document.status, "scan_infected");
      assert.equal(infectedUpload.route_job, null);
      assert.equal(await runtime.documents.uploadService.storage.objectExists(infectedUpload.document.storage_key), false, "delete policy must remove the stored RAW object before returning.");
    });

    const unavailablePort = await getFreePort();
    await withSyncScanApi({
      runId: `${scanRunId}_block_failure`,
      storagePath: path.join(scanStoragePath, "block-failure"),
      clamavPort: unavailablePort,
      onInfected: "quarantine",
      onScanFailure: "block"
    }, async ({ apiUrl, projectId: syncProjectId, token: syncToken }) => {
      const failedUpload = await uploadRawDocument({
        apiUrl,
        projectId: syncProjectId,
        token: syncToken,
        filename: "scanner-down-block.txt",
        text: "scanner down should block when policy is block."
      });
      assert.equal(failedUpload.document.status, "quarantined");
      assert.equal(failedUpload.route_job, null);
      const failedDocument = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(failedUpload.document.id)}?projectId=${encodeURIComponent(syncProjectId)}`, undefined, syncToken);
      assert.match(failedDocument.metadata.antivirus_error, /ClamAV scan failed before a verdict/i);
    });

    await withSyncScanApi({
      runId: `${scanRunId}_warn_failure`,
      storagePath: path.join(scanStoragePath, "warn-failure"),
      clamavPort: unavailablePort,
      onInfected: "quarantine",
      onScanFailure: "allow_with_warning"
    }, async ({ apiUrl, projectId: syncProjectId, token: syncToken }) => {
      const warningUpload = await uploadRawDocument({
        apiUrl,
        projectId: syncProjectId,
        token: syncToken,
        filename: "scanner-down-warning.txt",
        text: "scanner down should continue when policy allows warnings."
      });
      assert.equal(warningUpload.document.status, "scan_failed");
      assert.equal(typeof warningUpload.route_job?.id, "string", "allow-with-warning sync_scan upload should still route.");
      const warningDocument = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(warningUpload.document.id)}?projectId=${encodeURIComponent(syncProjectId)}`, undefined, syncToken);
      assert.match(warningDocument.metadata.antivirus_error, /ClamAV scan failed before a verdict/i);
    });
  } finally {
    await clamd.close();
    await rm(scanStoragePath, { recursive: true, force: true });
  }
});

test("MVP runtime integration covers auth, upload, worker jobs and context", { timeout: 120_000 }, async () => {
  const fakeOcr = await startLocalHttpOcrServer({
    pages: scannedPdfFixture.ocr_pages,
    imageText: "Image OCR provider text detects passport at airport.",
    visionCaption: "Vision provider caption sees passport in hand at airport with nature.",
    labels: ["passport", "airport", "nature", "people"],
    asrText: "ASR provider transcript mentions source-backed context and durable memory recall.",
    asrSegments: [{
      segmentIndex: 0,
      text: "ASR provider transcript mentions source-backed context and durable memory recall.",
      startMs: 0,
      endMs: 1000,
      confidence: 0.98
    }]
  });
  const fakeKeyframeCommand = await writeFakeKeyframeExtractorScript(storagePath);
  let doclingService = await startDoclingService({
    MINDORY_LLM_OCR_ENABLED: "true",
    MINDORY_LLM_OCR_PROVIDER: "local-http",
    MINDORY_LLM_OCR_MODEL: "mindory-test-ocr",
    MINDORY_LLM_LOCAL_HTTP_BASE_URL: fakeOcr.baseUrl
  });
  const config = modules.loadMindoryConfig({
    ...testEnv,
    MINDORY_DOCLING_ENABLED: "true",
    MINDORY_DOCLING_URL: doclingService.baseUrl,
    MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER: "local-command",
    MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND: process.execPath,
    MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_ARGS: JSON.stringify([fakeKeyframeCommand, "{input}", "{maxKeyframes}"]),
    MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS: "30000",
    MINDORY_LLM_OCR_ENABLED: "true",
    MINDORY_LLM_OCR_PROVIDER: "local-http",
    MINDORY_LLM_OCR_MODEL: "mindory-test-ocr",
    MINDORY_LLM_VISION_CAPTIONING_ENABLED: "true",
    MINDORY_LLM_VISION_CAPTIONING_PROVIDER: "local-http",
    MINDORY_LLM_VISION_CAPTIONING_MODEL: "mindory-test-vision",
    MINDORY_LLM_IMAGE_EMBEDDING_ENABLED: "true",
    MINDORY_LLM_IMAGE_EMBEDDING_PROVIDER: "local-http",
    MINDORY_LLM_IMAGE_EMBEDDING_MODEL: "mindory-test-image-embedding",
    MINDORY_LLM_IMAGE_EMBEDDING_DIMENSIONS: "1536",
    MINDORY_LLM_ASR_ENABLED: "true",
    MINDORY_LLM_ASR_PROVIDER: "local-http",
    MINDORY_LLM_ASR_MODEL: "mindory-test-asr",
    MINDORY_LLM_LOCAL_HTTP_BASE_URL: fakeOcr.baseUrl
  });
  let apiApp = null;
  let workerRuntime = null;
  let managementDatabase = null;
  let managementQueue = null;

  try {
    await cleanupProject(projectId);
    await seedProjectToken({
      projectId,
      token: bootstrapToken,
      tokenId: `tok_${testRunId}`,
      permissions: [...modules.MINDORY_PERMISSIONS]
    });

    const apiRuntime = modules.buildApiRuntimeDependencies(config);
    apiApp = await modules.buildApiApp({ config, ...apiRuntime, logger: false });
    await apiApp.listen({ host: "127.0.0.1", port: 0 });
    const apiUrl = addressToUrl(apiApp.server.address());

    workerRuntime = modules.buildWorkerRuntime(config);
    await workerRuntime.start();

    managementDatabase = modules.createMindoryDatabaseClient(databaseUrl);
    managementQueue = new modules.BullMqProcessingJobQueue({
      redisUrl,
      queuePrefix
    });
    const managementStore = new modules.DbProcessingJobStore(managementDatabase.db, () => `job_${randomUUID()}`);

    await assertAuthEnforcement(apiUrl);
    const childToken = await assertTokenLifecycle(apiUrl);
    const { sessionId, messageId } = await createConversation(apiUrl);
    const { documentId, routeJobId } = await uploadAndProcessDocument(apiUrl);
    await uploadAndProcessPdfDocument(apiUrl);
    await uploadAndProcessScannedPdfDocument(apiUrl);
    doclingService = await assertDoclingFailureAndRetry(apiUrl, doclingService, {
      MINDORY_LLM_OCR_ENABLED: "true",
      MINDORY_LLM_OCR_PROVIDER: "local-http",
      MINDORY_LLM_OCR_MODEL: "mindory-test-ocr",
      MINDORY_LLM_LOCAL_HTTP_BASE_URL: fakeOcr.baseUrl
    });
    const imageDocument = await uploadAndProcessImageDocument(apiUrl);
    await assertFaceSubsystem(apiUrl, imageDocument.documentId);
    const audioDocument = await uploadAndProcessAudioDocument(apiUrl);
    const videoDocument = await uploadAndProcessVideoDocument(apiUrl);
    await assertUnifiedArtifactSearch(apiUrl, {
      imageDocumentId: imageDocument.documentId,
      audioDocumentId: audioDocument.documentId,
      videoDocumentId: videoDocument.documentId
    });
    await assertJobsApi(apiUrl, managementStore, sessionId, documentId, routeJobId);
    await assertDocumentRecompute(apiUrl, documentId);
    await assertMemoryAndContext(apiUrl, sessionId, messageId, documentId);
    await assertRevokedTokenIsRejected(apiUrl, childToken.id, childToken.rawToken);
  } finally {
    if (workerRuntime) {
      await workerRuntime.close();
    }
    if (apiApp) {
      await apiApp.close();
    }
    if (managementQueue) {
      await managementQueue.queue.obliterate({ force: true });
      await managementQueue.close();
    }
    if (managementDatabase) {
      await managementDatabase.close();
    }
    await doclingService?.close();
    await fakeOcr.close();
    await cleanupProject(projectId);
    await rm(storagePath, { recursive: true, force: true });
  }
});

test("MVP runtime integration indexes document chunks with configured embeddings", { timeout: 120_000 }, async () => {
  const indexedRunId = `task31_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const indexedProjectId = `project_${indexedRunId}`;
  const indexedToken = `token_${indexedRunId}`;
  const indexedStoragePath = path.join(os.tmpdir(), `mindory-integration-${indexedRunId}`);
  const indexedQueuePrefix = `mindory:test:${indexedRunId}`;
  const fakeEmbeddings = await startOpenAiCompatibleEmbeddingServer({ dimensions: 1536 });
  const indexedEnv = {
    ...testEnv,
    MINDORY_QUEUE_PREFIX: indexedQueuePrefix,
    MINDORY_CACHE_PREFIX: `mindory:test-cache:${indexedRunId}`,
    MINDORY_STORAGE_LOCAL_PATH: indexedStoragePath,
    MINDORY_LLM_TEXT_EMBEDDING_ENABLED: "true",
    MINDORY_LLM_TEXT_EMBEDDING_PROVIDER: "openai-compatible",
    MINDORY_LLM_TEXT_EMBEDDING_MODEL: "mindory-test-embedding",
    MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS: "1536",
    MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL: fakeEmbeddings.baseUrl,
    MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE: "api-key",
    MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY: "test-key"
  };
  const config = modules.loadMindoryConfig(indexedEnv);
  let apiApp = null;
  let workerRuntime = null;
  let managementDatabase = null;
  let managementQueue = null;

  try {
    await mkdir(indexedStoragePath, { recursive: true });
    await cleanupProjectInDatabase(indexedProjectId, databaseUrl);
    await seedProjectTokenInDatabase({
      projectId: indexedProjectId,
      token: indexedToken,
      tokenId: `tok_${indexedRunId}`,
      permissions: [...modules.MINDORY_PERMISSIONS]
    }, databaseUrl);

    const apiRuntime = modules.buildApiRuntimeDependencies(config);
    apiApp = await modules.buildApiApp({ config, ...apiRuntime, logger: false });
    await apiApp.listen({ host: "127.0.0.1", port: 0 });
    const apiUrl = addressToUrl(apiApp.server.address());

    workerRuntime = modules.buildWorkerRuntime(config);
    await workerRuntime.start();

    managementDatabase = modules.createMindoryDatabaseClient(databaseUrl);
    managementQueue = new modules.BullMqProcessingJobQueue({
      redisUrl,
      queuePrefix: indexedQueuePrefix
    });
    const documentId = await uploadAndIndexDocument({
      apiUrl,
      projectId: indexedProjectId,
      token: indexedToken
    });
    const vectorRows = await countVectorEmbeddings(indexedProjectId, databaseUrl);
    assert.ok(vectorRows > 0, "configured embeddings must persist pgvector rows.");
    const linkedChunks = await countLinkedDocumentChunks(indexedProjectId, documentId, databaseUrl);
    assert.equal(linkedChunks, vectorRows, "indexed chunks should store embedding ids.");

    const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
      projectIds: [indexedProjectId],
      query: "semantic source-backed retrieval",
      limit: 5,
      metadataFilters: [{ key: "size_bytes", operator: "gt", valueNumber: 10, unit: "bytes" }]
    }, indexedToken);
    assert.ok(search.hits.some((hit) => hit.documentId === documentId), "semantic search should return the indexed document.");
    assert.ok(search.hits.every((hit) => Array.isArray(hit.sourceRefs) && hit.sourceRefs.some((ref) => ref.type === "chunk")), "semantic search hits must include chunk source refs.");
    assert.ok(search.hits.some((hit) => hit.sourceRefs.some((ref) => ref.type === "artifact")), "semantic search hits must include artifact source refs.");
    const filteredOutSearch = await requestJson(apiUrl, "POST", "/v1/documents/search", {
      projectIds: [indexedProjectId],
      query: "semantic source-backed retrieval",
      limit: 5,
      metadataFilters: [{ key: "size_bytes", operator: "lt", valueNumber: 1, unit: "bytes" }]
    }, indexedToken);
    assert.ok(!filteredOutSearch.hits.some((hit) => hit.documentId === documentId), "semantic search should enforce metadata filters.");
    assert.ok(fakeEmbeddings.calls.length >= 2, "embedding provider should be called for chunks and query search.");
  } finally {
    if (workerRuntime) {
      await workerRuntime.close();
    }
    if (apiApp) {
      await apiApp.close();
    }
    if (managementQueue) {
      await managementQueue.queue.obliterate({ force: true });
      await managementQueue.close();
    }
    if (managementDatabase) {
      await managementDatabase.close();
    }
    await fakeEmbeddings.close();
    await cleanupProjectInDatabase(indexedProjectId, databaseUrl);
    await rm(indexedStoragePath, { recursive: true, force: true });
  }
});

test("MVP runtime integration indexes and searches document chunks with Qdrant", { timeout: 120_000 }, async () => {
  const qdrantRunId = `task91_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const qdrantProjectId = `project_${qdrantRunId}`;
  const qdrantToken = `token_${qdrantRunId}`;
  const qdrantStoragePath = path.join(os.tmpdir(), `mindory-integration-${qdrantRunId}`);
  const qdrantQueuePrefix = `mindory:test:${qdrantRunId}`;
  const qdrantCollectionPrefix = `mindory_${qdrantRunId}`;
  const qdrantCollectionName = `${qdrantCollectionPrefix}_document_chunks`;
  const fakeEmbeddings = await startOpenAiCompatibleEmbeddingServer({ dimensions: 1536 });
  const qdrantEnv = {
    ...testEnv,
    MINDORY_QUEUE_PREFIX: qdrantQueuePrefix,
    MINDORY_CACHE_PREFIX: `mindory:test-cache:${qdrantRunId}`,
    MINDORY_STORAGE_LOCAL_PATH: qdrantStoragePath,
    MINDORY_VECTOR_PROVIDER: "qdrant",
    MINDORY_QDRANT_URL: qdrantUrl,
    MINDORY_QDRANT_COLLECTION_PREFIX: qdrantCollectionPrefix,
    MINDORY_LLM_TEXT_EMBEDDING_ENABLED: "true",
    MINDORY_LLM_TEXT_EMBEDDING_PROVIDER: "openai-compatible",
    MINDORY_LLM_TEXT_EMBEDDING_MODEL: "mindory-test-embedding",
    MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS: "1536",
    MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL: fakeEmbeddings.baseUrl,
    MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE: "api-key",
    MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY: "test-key"
  };
  const config = modules.loadMindoryConfig(qdrantEnv);
  let apiApp = null;
  let workerRuntime = null;
  let managementDatabase = null;
  let managementQueue = null;

  try {
    await mkdir(qdrantStoragePath, { recursive: true });
    await cleanupProjectInDatabase(qdrantProjectId, databaseUrl);
    await seedProjectTokenInDatabase({
      projectId: qdrantProjectId,
      token: qdrantToken,
      tokenId: `tok_${qdrantRunId}`,
      permissions: [...modules.MINDORY_PERMISSIONS]
    }, databaseUrl);

    const apiRuntime = modules.buildApiRuntimeDependencies(config);
    apiApp = await modules.buildApiApp({ config, ...apiRuntime, logger: false });
    await apiApp.listen({ host: "127.0.0.1", port: 0 });
    const apiUrl = addressToUrl(apiApp.server.address());

    workerRuntime = modules.buildWorkerRuntime(config);
    await workerRuntime.start();

    managementDatabase = modules.createMindoryDatabaseClient(databaseUrl);
    managementQueue = new modules.BullMqProcessingJobQueue({
      redisUrl,
      queuePrefix: qdrantQueuePrefix
    });
    const documentId = await uploadAndIndexDocument({
      apiUrl,
      projectId: qdrantProjectId,
      token: qdrantToken
    });
    const pgvectorRows = await countVectorEmbeddings(qdrantProjectId, databaseUrl);
    assert.equal(pgvectorRows, 0, "Qdrant-selected indexing must not write pgvector rows.");
    const linkedChunks = await countLinkedDocumentChunks(qdrantProjectId, documentId, databaseUrl);
    assert.ok(linkedChunks > 0, "Qdrant-selected indexing must link chunk embedding ids.");

    const qdrantIndex = new modules.QdrantVectorIndex({
      url: qdrantUrl,
      collectionPrefix: qdrantCollectionPrefix,
      dimensions: 1536
    });
    const directHits = await qdrantIndex.searchDocumentChunks({
      projectIds: [qdrantProjectId],
      embedding: deterministicEmbedding("semantic source-backed retrieval", 1536),
      limit: 5
    });
    assert.ok(directHits.some((hit) => hit.documentId === documentId), "worker indexing should write selected chunks to Qdrant.");

    const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
      projectIds: [qdrantProjectId],
      query: "semantic source-backed retrieval",
      limit: 5,
      metadataFilters: [{ key: "size_bytes", operator: "gt", valueNumber: 10, unit: "bytes" }]
    }, qdrantToken);
    assert.ok(search.hits.some((hit) => hit.documentId === documentId), "Qdrant-backed semantic search should return the indexed document.");
    assert.ok(search.hits.every((hit) => Array.isArray(hit.sourceRefs) && hit.sourceRefs.some((ref) => ref.type === "chunk")), "Qdrant-backed search hits must include chunk source refs.");
    assert.ok(search.hits.some((hit) => hit.sourceRefs.some((ref) => ref.type === "artifact")), "Qdrant-backed search hits must include artifact source refs.");
    const filteredOutSearch = await requestJson(apiUrl, "POST", "/v1/documents/search", {
      projectIds: [qdrantProjectId],
      query: "semantic source-backed retrieval",
      limit: 5,
      metadataFilters: [{ key: "size_bytes", operator: "lt", valueNumber: 1, unit: "bytes" }]
    }, qdrantToken);
    assert.ok(!filteredOutSearch.hits.some((hit) => hit.documentId === documentId), "Qdrant-backed search should enforce metadata filters.");
  } finally {
    if (workerRuntime) {
      await workerRuntime.close();
    }
    if (apiApp) {
      await apiApp.close();
    }
    if (managementQueue) {
      await managementQueue.queue.obliterate({ force: true });
      await managementQueue.close();
    }
    if (managementDatabase) {
      await managementDatabase.close();
    }
    await fakeEmbeddings.close();
    await deleteQdrantCollection(qdrantUrl, qdrantCollectionName);
    await cleanupProjectInDatabase(qdrantProjectId, databaseUrl);
    await rm(qdrantStoragePath, { recursive: true, force: true });
  }
});

test("Qdrant vector adapter bootstraps collection and searches chunks", { timeout: 60_000 }, async () => {
  const collectionPrefix = `mindory_${testRunId}`;
  const collectionName = `${collectionPrefix}_document_chunks`;
  const artifactCollectionName = `${collectionPrefix}_document_artifacts`;
  const index = new modules.QdrantVectorIndex({
    url: qdrantUrl,
    collectionPrefix,
    dimensions: 4
  });
  const documentId = `doc_qdrant_${testRunId}`;

  try {
    const health = await index.healthcheck();
    assert.equal(health.ok, true);
    assert.equal(health.collectionName, collectionName);
    assert.equal(health.artifactCollectionName, artifactCollectionName);

    const upserted = await index.upsertDocumentChunks({
      chunks: [
        {
          projectId,
          documentId,
          chunkId: "chunk_qdrant_1",
          content: "Qdrant vector adapter keeps source refs for the first chunk.",
          embedding: [1, 0, 0, 0],
          model: "mindory-test-vector",
          dimensions: 4,
          metadata: {
            source_refs: [{ type: "chunk", id: "chunk_qdrant_1" }],
            category: "alpha",
            size_bytes: 64
          }
        },
        {
          projectId,
          documentId,
          chunkId: "chunk_qdrant_2",
          content: "Second Qdrant chunk is intentionally less similar.",
          embedding: [0, 1, 0, 0],
          model: "mindory-test-vector",
          dimensions: 4,
          metadata: {
            source_refs: [{ type: "chunk", id: "chunk_qdrant_2" }],
            category: "beta",
            size_bytes: 256
          }
        },
        {
          projectId: `other_${projectId}`,
          documentId,
          chunkId: "chunk_qdrant_other_project",
          content: "Other project chunk must not leak into project-scoped search.",
          embedding: [1, 0, 0, 0],
          model: "mindory-test-vector",
          dimensions: 4,
          metadata: {
            source_refs: [{ type: "chunk", id: "chunk_qdrant_other_project" }],
            category: "alpha",
            size_bytes: 32
          }
        }
      ]
    });
    assert.equal(upserted.length, 3);
    assert.match(upserted[0].embeddingId, /^[0-9a-f-]{36}$/);

    const hits = await index.searchDocumentChunks({
      projectIds: [projectId],
      embedding: [1, 0, 0, 0],
      limit: 5
    });
    assert.equal(hits[0]?.chunkId, "chunk_qdrant_1");
    assert.deepEqual(hits[0]?.metadata.source_refs, [{ type: "chunk", id: "chunk_qdrant_1" }]);
    assert(!hits.some((hit) => hit.projectId !== projectId), "Qdrant search must stay project scoped.");

    const filteredHits = await index.searchDocumentChunks({
      projectIds: [projectId],
      embedding: [1, 0, 0, 0],
      limit: 5,
      metadataFilters: [
        { key: "category", operator: "eq", valueText: "alpha" },
        { key: "size_bytes", operator: "lt", valueNumber: 100 }
      ]
    });
    assert.deepEqual(filteredHits.map((hit) => hit.chunkId), ["chunk_qdrant_1"]);

    const upsertedArtifacts = await index.upsertArtifactVectors({
      artifacts: [{
        projectId,
        documentId,
        artifactId: "artifact_image_vector_1",
        artifactType: "image_embedding",
        content: "Image embedding artifact for passport object search.",
        embedding: [1, 0, 0, 0],
        model: "mindory-test-image-vector",
        dimensions: 4,
        metadata: {
          source_refs: [{ type: "artifact", id: "artifact_image_vector_1" }],
          category: "image",
          object_label: "passport"
        }
      }]
    });
    assert.equal(upsertedArtifacts[0]?.artifactId, "artifact_image_vector_1");
    const artifactVectorHits = await index.searchArtifactVectors({
      projectIds: [projectId],
      embedding: [1, 0, 0, 0],
      artifactTypes: ["image_embedding"],
      limit: 5
    });
    assert.equal(artifactVectorHits[0]?.artifactId, "artifact_image_vector_1");
    assert.equal(artifactVectorHits[0]?.artifactType, "image_embedding");
    assert.deepEqual(artifactVectorHits[0]?.metadata.source_refs, [{ type: "artifact", id: "artifact_image_vector_1" }]);

    await index.deleteDocumentChunks(projectId, documentId);
    const afterDelete = await index.searchDocumentChunks({
      projectIds: [projectId],
      embedding: [1, 0, 0, 0],
      limit: 5
    });
    assert.equal(afterDelete.length, 0);
    await index.deleteDocumentArtifactVectors(projectId, documentId);
    const afterArtifactDelete = await index.searchArtifactVectors({
      projectIds: [projectId],
      embedding: [1, 0, 0, 0],
      artifactTypes: ["image_embedding"],
      limit: 5
    });
    assert.equal(afterArtifactDelete.length, 0);
  } finally {
    await deleteQdrantCollection(qdrantUrl, collectionName);
    await deleteQdrantCollection(qdrantUrl, artifactCollectionName);
  }
});

async function assertAuthEnforcement(apiUrl) {
  const missing = await fetch(`${apiUrl}/v1/projects/${encodeURIComponent(projectId)}`, {
    headers: { accept: "application/json" }
  });
  assert.equal(missing.status, 401, "missing bearer token should return 401");

  const invalid = await fetch(`${apiUrl}/v1/projects/${encodeURIComponent(projectId)}`, {
    headers: {
      accept: "application/json",
      authorization: "Bearer invalid-token"
    }
  });
  assert.equal(invalid.status, 401, "invalid bearer token should return 401");

  const project = await requestJson(apiUrl, "GET", `/v1/projects/${encodeURIComponent(projectId)}`);
  assert.equal(project.id, projectId);
}

async function assertTokenLifecycle(apiUrl) {
  const created = await requestJson(apiUrl, "POST", "/v1/tokens", {
    projectId,
    name: "integration child token",
    permissions: ["project:read", "token:read"]
  });
  assert.equal(typeof created.token, "string", "token create should return the raw token once");
  assert.ok(created.access_token.id, "token create should return metadata");
  assert.doesNotMatch(JSON.stringify(created.access_token), /token_hash|tokenHash/);

  const listed = await requestJson(apiUrl, "GET", `/v1/tokens?projectId=${encodeURIComponent(projectId)}`);
  assert.ok(listed.tokens.some((token) => token.id === created.access_token.id), "token list should include created token metadata");
  assert.doesNotMatch(JSON.stringify(listed), new RegExp(created.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(listed), /token_hash|tokenHash/);

  return {
    id: created.access_token.id,
    rawToken: created.token
  };
}

async function createConversation(apiUrl) {
  const userPeerId = `peer_user_${testRunId}`;
  const agentPeerId = `peer_agent_${testRunId}`;
  const sessionId = `sess_${testRunId}`;

  await requestJson(apiUrl, "POST", "/v1/peers", {
    id: userPeerId,
    projectId,
    type: "human",
    name: "Integration User",
    externalId: `user_${testRunId}`
  });
  await requestJson(apiUrl, "POST", "/v1/peers", {
    id: agentPeerId,
    projectId,
    type: "agent",
    name: "Integration Agent",
    externalId: `agent_${testRunId}`
  });
  await requestJson(apiUrl, "POST", "/v1/sessions", {
    id: sessionId,
    projectId,
    peerIds: [userPeerId, agentPeerId],
    title: "Integration test session"
  });

  const message = await requestJson(apiUrl, "POST", `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
    projectId,
    authorPeerId: userPeerId,
    role: "user",
    content: "Remember that source-backed context matters in integration tests."
  });

  return {
    sessionId,
    messageId: message.id
  };
}

async function uploadAndProcessDocument(apiUrl) {
  const documentText = [
    "Mindory integration document.",
    "source-backed context should include chunked document evidence.",
    "The worker pipeline must extract text and persist chunks."
  ].join("\n");
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Integration document");
  form.append("file", new Blob([documentText], { type: "text/plain" }), "integration.txt");

  const uploadResponse = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bootstrapToken}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`document upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  const documentId = upload.document.id;
  const routeJobId = upload.route_job?.id;
  assert.equal(typeof routeJobId, "string", "document upload should enqueue a route job when scan is disabled");

  await waitFor(async () => {
    const status = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    return status.status === "chunked";
  }, "document to reach chunked status");

  const routeJob = await waitForJobStatus(apiUrl, routeJobId, "succeeded");
  assert.equal(routeJob.type, "document.route");

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "source-backed context",
    limit: 5
  });
  assert.ok(search.hits.length > 0, "document search should find chunked text");
  assert.ok(search.hits.some((hit) => hit.sourceRefs.some((ref) => ref.type === "artifact")), "document search should return artifact-backed source refs.");
  const metadataSearch = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "source-backed context",
    limit: 5,
    metadataFilters: [{ key: "size_bytes", operator: "lte", valueNumber: 1_000_000, unit: "bytes" }]
  });
  assert.ok(metadataSearch.hits.some((hit) => hit.documentId === documentId), "document search should allow size metadata filters.");
  const filteredOutSearch = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "source-backed context",
    limit: 5,
    metadataFilters: [{ key: "size_bytes", operator: "lt", valueNumber: 1, unit: "bytes" }]
  });
  assert.ok(!filteredOutSearch.hits.some((hit) => hit.documentId === documentId), "document search should enforce metadata filter bounds.");
  const textSpans = await countArtifactTextSpans(projectId, documentId, databaseUrl);
  assert.ok(textSpans > 0, "text pipeline should persist artifact text spans.");
  const metadataIndexRows = await countDocumentMetadataIndexRows(projectId, documentId, databaseUrl);
  assert.ok(metadataIndexRows >= 5, "route processing should persist typed metadata index rows.");
  const mediaMetadata = await getDocumentMediaMetadata(projectId, documentId, databaseUrl);
  assert.equal(mediaMetadata.media_type, "text");
  assert.equal(mediaMetadata.checksum_sha256.length, 64);
  assert.equal(mediaMetadata.metadata.raw_original_unchanged, true);

  return {
    documentId,
    routeJobId
  };
}

async function uploadAndProcessPdfDocument(apiUrl) {
  const pdf = buildMinimalPdf(nativePdfFixture.pages);
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Integration PDF document");
  form.append("file", new Blob([pdf], { type: nativePdfFixture.mime_type }), nativePdfFixture.filename);

  const uploadResponse = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bootstrapToken}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`PDF document upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  const documentId = upload.document.id;
  const routeJobId = upload.route_job?.id;
  assert.equal(typeof routeJobId, "string", "PDF upload should enqueue a route job when scan is disabled");

  await waitFor(async () => {
    const status = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    return status.status === "chunked";
  }, "PDF document to reach chunked status");

  const routeJob = await waitForJobStatus(apiUrl, routeJobId, "succeeded");
  assert.equal(routeJob.type, "document.route");
  const document = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(document.metadata.routing.classification.kind, "pdf");
  assert.equal(document.metadata.extraction.processing_stage, "pdf");
  assert.equal(document.metadata.extraction.docling_service.enabled, true);
  assert.equal(document.metadata.extraction.docling_service.status, "succeeded");
  assert.equal(document.metadata.extraction.page_count, 2);

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "Docling service native PDF page two",
    limit: 5,
    metadataFilters: [{ key: "extension", valueText: "pdf" }]
  });
  const pdfHit = search.hits.find((hit) => hit.documentId === documentId);
  assert.ok(pdfHit, "PDF document search should find extracted native text.");
  assert.ok(pdfHit.sourceRefs.some((ref) => ref.type === "artifact"), "PDF search should include artifact source refs.");
  assert.ok(pdfHit.metadata.page_numbers.includes(2), "PDF chunk metadata should include page numbers.");
  assert.ok(pdfHit.metadata.page_artifact_ids.length > 0, "PDF chunk metadata should include page artifact ids.");

  const pageArtifacts = await countDocumentArtifacts(projectId, documentId, "pdf_page", databaseUrl);
  assert.equal(pageArtifacts, 2, "PDF extraction should persist one pdf_page artifact per page.");
  const pageSpans = await countDocumentTextSpans(projectId, documentId, "pdf_native_text", databaseUrl);
  assert.equal(pageSpans, 2, "PDF extraction should persist page-level native text spans.");
}

async function uploadAndProcessScannedPdfDocument(apiUrl) {
  const pdf = buildMinimalPdf(scannedPdfFixture.pages);
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Integration scanned PDF document");
  form.append("file", new Blob([pdf], { type: scannedPdfFixture.mime_type }), scannedPdfFixture.filename);

  const uploadResponse = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bootstrapToken}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`Scanned PDF document upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  const documentId = upload.document.id;

  await waitFor(async () => {
    const status = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    return status.status === "chunked";
  }, "scanned PDF document to reach chunked status");

  const document = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(document.metadata.extraction.docling_service.enabled, true);
  assert.equal(document.metadata.extraction.docling_service.status, "succeeded");
  assert.equal(document.metadata.extraction.ocr.status, "succeeded");
  assert.equal(document.metadata.extraction.ocr.pages_extracted, 1);

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "Docling service OCR text",
    limit: 5,
    metadataFilters: [{ key: "extension", valueText: "pdf" }]
  });
  const pdfHit = search.hits.find((hit) => hit.documentId === documentId);
  assert.ok(pdfHit, "Scanned PDF document search should find OCR text.");
  assert.ok(pdfHit.sourceRefs.some((ref) => ref.type === "artifact"), "Scanned PDF search should include artifact source refs.");
  assert.ok(pdfHit.metadata.page_numbers.includes(1), "Scanned PDF chunk metadata should include OCR page number.");

  const pageArtifacts = await countDocumentArtifacts(projectId, documentId, "pdf_page", databaseUrl);
  assert.equal(pageArtifacts, 1, "Scanned PDF OCR should persist one pdf_page artifact.");
  const ocrSpans = await countDocumentTextSpans(projectId, documentId, "ocr_text", databaseUrl);
  assert.equal(ocrSpans, 1, "Scanned PDF OCR should persist page-level OCR text spans.");
}

async function assertDoclingFailureAndRetry(apiUrl, doclingService, envOverrides) {
  const restartPort = doclingService.port;
  await doclingService.close();

  const pdf = buildMinimalPdf(["Docling service retry path recovers after endpoint restart."]);
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Integration Docling retry PDF");
  form.append("file", new Blob([pdf], { type: "application/pdf" }), "docling-retry.pdf");

  const uploadResponse = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bootstrapToken}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`Docling retry PDF upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  const documentId = upload.document.id;
  const failedJob = await waitForDocumentJobStatus(apiUrl, documentId, "document.extract", "failed", 90);
  assert.match(failedJob.last_error, /Docling service request failed|fetch failed|ECONNREFUSED/i);
  assert.equal(failedJob.details.status, "failed");
  assert.equal(failedJob.details.error.retryable, true);

  const restarted = await startDoclingService(envOverrides, restartPort);
  const retry = await requestJson(apiUrl, "POST", `/v1/jobs/${encodeURIComponent(failedJob.id)}/retry`, {
    projectId
  });
  assert.equal(retry.retry.processing_job_id, failedJob.id);

  await waitFor(async () => {
    const status = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    return status.status === "chunked";
  }, "Docling failed extraction retry to reach chunked status", 90);
  const retriedJob = await waitForJobStatus(apiUrl, failedJob.id, "succeeded");
  assert.ok(retriedJob.attempts >= 2, "retried Docling extract job should record another attempt.");

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "retry path recovers",
    limit: 5,
    metadataFilters: [{ key: "extension", valueText: "pdf" }]
  });
  const retryHit = search.hits.find((hit) => hit.documentId === documentId);
  assert.ok(retryHit, "retried Docling PDF should become searchable.");
  assert.ok(retryHit.sourceRefs.some((ref) => ref.type === "artifact"), "retried Docling PDF search should include artifact source refs.");

  return restarted;
}

async function uploadAndProcessImageDocument(apiUrl) {
  const image = buildMinimalPng({
    width: 16,
    height: 10,
    text: "passport in hand at airport with nature and 3 people"
  });
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Integration image document");
  form.append("file", new Blob([image], { type: "image/png" }), "nature-3-people-passport-airport.png");

  const uploadResponse = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bootstrapToken}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`image document upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  const documentId = upload.document.id;
  const routeJobId = upload.route_job?.id;
  assert.equal(typeof routeJobId, "string", "image upload should enqueue a route job when scan is disabled");

  await waitFor(async () => {
    const status = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    return status.status === "chunked";
  }, "image document to reach chunked status");

  const routeJob = await waitForJobStatus(apiUrl, routeJobId, "succeeded");
  assert.equal(routeJob.type, "document.route");
  const document = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(document.metadata.routing.classification.kind, "image");
  assert.equal(document.metadata.extraction.processing_stage, "image");
  assert.equal(document.metadata.extraction.image_semantic, true);
  assert.equal(document.metadata.extraction.capabilities.ocr.status, "provider_ocr");
  assert.equal(document.metadata.extraction.capabilities.image_captioning.status, "provider_caption");
  assert.equal(document.metadata.extraction.capabilities.image_embedding.status, "provider_embedded");
  assert.equal(document.metadata.extraction.capabilities.object_detection.status, "provider_detected");
  assert.equal(document.metadata.extraction.capabilities.face_detection.status, "provider_detected");
  assert.equal(document.metadata.extraction.capabilities.face_recognition.status, "provider_recognized");

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "Vision provider caption passport airport",
    limit: 5,
    metadataFilters: [{ key: "extension", valueText: "png" }]
  });
  const imageHit = search.hits.find((hit) => hit.documentId === documentId);
  assert.ok(imageHit, "image document search should find semantic image text.");
  assert.ok(imageHit.sourceRefs.some((ref) => ref.type === "artifact"), "image search should include artifact source refs.");
  assert.ok(imageHit.metadata.semantic_artifact_ids.length >= 3, "image chunk metadata should include semantic artifact ids.");
  assert.ok(imageHit.metadata.semantic_artifact_types.includes("image_caption"), "image chunk metadata should include caption artifact type.");

  assert.equal(await countDocumentArtifacts(projectId, documentId, "image_caption", databaseUrl), 1);
  assert.equal(await countDocumentArtifacts(projectId, documentId, "image_analysis", databaseUrl), 1);
  assert.equal(await countDocumentArtifacts(projectId, documentId, "image_embedding", databaseUrl), 1);
  assert.equal(await countDocumentArtifacts(projectId, documentId, "object_detection", databaseUrl), 1);
  assert.equal(await countDocumentArtifacts(projectId, documentId, "ocr_text", databaseUrl), 1);
  assert.equal(await countDocumentArtifactVectors(projectId, documentId, databaseUrl), 1);
  assert.equal(await countDocumentTextSpans(projectId, documentId, "image_caption", databaseUrl), 1);
  assert.equal(await countDocumentTextSpans(projectId, documentId, "image_analysis", databaseUrl), 1);
  assert.equal(await countDocumentTextSpans(projectId, documentId, "object_detection", databaseUrl), 1);
  assert.equal(await countDocumentTextSpans(projectId, documentId, "ocr_text", databaseUrl), 1);

  return {
    documentId,
    routeJobId
  };
}

async function assertFaceSubsystem(apiUrl, documentId) {
  const identities = await requestJson(apiUrl, "GET", `/v1/faces/identities?projectId=${encodeURIComponent(projectId)}&limit=20`);
  const observations = await requestJson(apiUrl, "GET", `/v1/faces/observations?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent(documentId)}&limit=20`);
  assert.equal(observations.observations.length, 3, "image face fallback should create one observation per detected person count.");
  assert.equal(new Set(observations.observations.map((observation) => observation.face_identity_id)).size, 3, "distinct fallback faces should create distinct candidate identities.");
  assert.ok(observations.observations.every((observation) => observation.artifact_id && observation.bounding_box), "face observations should be source-backed by artifacts and bounding boxes.");
  assert.ok(identities.identities.length >= 3, "face identity API should list image-derived identities.");
  assert.equal(await countDocumentArtifacts(projectId, documentId, "face_observation", databaseUrl), 3);

  const [firstObservation, secondObservation] = observations.observations;
  const firstIdentityId = firstObservation.face_identity_id;
  const secondIdentityId = secondObservation.face_identity_id;
  assert.notEqual(firstIdentityId, secondIdentityId, "merge test requires two separate face identities.");

  const renamed = await requestJson(apiUrl, "PATCH", `/v1/faces/identities/${encodeURIComponent(firstIdentityId)}`, {
    projectId,
    label: "Integration Person A"
  });
  assert.equal(renamed.label, "Integration Person A", "face identity rename should persist label.");

  const merged = await requestJson(apiUrl, "POST", `/v1/faces/identities/${encodeURIComponent(secondIdentityId)}/merge`, {
    projectId,
    targetIdentityId: firstIdentityId
  });
  assert.equal(merged.source.status, "archived", "merged source identity should be archived.");
  assert.equal(merged.target.id, firstIdentityId);
  assert.ok(merged.reassigned_observations >= 1, "merge should reassign source observations to target identity.");

  const targetObservations = await requestJson(apiUrl, "GET", `/v1/faces/observations?projectId=${encodeURIComponent(projectId)}&identityId=${encodeURIComponent(firstIdentityId)}&limit=20`);
  assert.ok(targetObservations.observations.length >= 2, "target identity should include reassigned observations.");
}

async function uploadAndProcessAudioDocument(apiUrl) {
  const audio = buildMinimalWav({
    durationMs: 1000,
    sampleRate: 16_000,
    transcript: "audio transcript mentions source-backed context and durable memory recall."
  });
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Integration audio document");
  form.append("file", new Blob([audio], { type: "audio/wav" }), "integration-audio-memory.wav");

  const uploadResponse = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bootstrapToken}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`audio document upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  const documentId = upload.document.id;
  const routeJobId = upload.route_job?.id;
  assert.equal(typeof routeJobId, "string", "audio upload should enqueue a route job when scan is disabled");

  await waitFor(async () => {
    const status = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    return status.status === "chunked";
  }, "audio document to reach chunked status");

  const routeJob = await waitForJobStatus(apiUrl, routeJobId, "succeeded");
  assert.equal(routeJob.type, "document.route");
  const document = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(document.metadata.routing.classification.kind, "audio");
  assert.equal(document.metadata.extraction.processing_stage, "audio");
  assert.equal(document.metadata.extraction.audio_transcript, true);
  assert.equal(document.metadata.extraction.transcript_segment_count, 1);
  assert.equal(document.metadata.extraction.capabilities.asr.status, "provider_asr");

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "ASR provider transcript durable memory recall",
    limit: 5,
    metadataFilters: [
      { key: "extension", valueText: "wav" },
      { key: "duration_ms", operator: "between", minNumber: 900, maxNumber: 1100, unit: "ms" }
    ]
  });
  const audioHit = search.hits.find((hit) => hit.documentId === documentId);
  assert.ok(audioHit, "audio document search should find transcript text.");
  assert.ok(audioHit.sourceRefs.some((ref) => ref.type === "artifact"), "audio search should include artifact source refs.");
  assert.ok(audioHit.metadata.transcript_artifact_ids.length > 0, "audio chunk metadata should include transcript artifact ids.");
  assert.ok(audioHit.metadata.transcript_time_ranges.some((range) => range.start_ms === 0 && range.end_ms === 1000), "audio chunk metadata should include transcript time ranges.");

  assert.equal(await countDocumentArtifacts(projectId, documentId, "transcript", databaseUrl), 1);
  assert.equal(await countDocumentTextSpans(projectId, documentId, "transcript_segment", databaseUrl), 1);
  const mediaMetadata = await getDocumentMediaMetadata(projectId, documentId, databaseUrl);
  assert.equal(mediaMetadata.media_type, "audio");
  assert.equal(mediaMetadata.codec, "pcm");
  assert.equal(mediaMetadata.duration_ms, 1000);

  return {
    documentId,
    routeJobId
  };
}

async function uploadAndProcessVideoDocument(apiUrl) {
  const video = buildVideoManifestFile({
    durationMs: 12_000,
    codec: "manifest-h264",
    frames: [
      { timestampMs: 0, description: "opening frame shows a passport in hand at an airport", labels: ["passport", "airport"] },
      { timestampMs: 3000, description: "second frame shows two dogs near luggage", labels: ["dogs", "luggage"] },
      { timestampMs: 6000, description: "third frame shows nature through a window", labels: ["nature", "window"] },
      { timestampMs: 9000, description: "fourth frame should be skipped by max keyframes", labels: ["skipped"] },
      { timestampMs: 11000, description: "fifth frame should also be skipped", labels: ["skipped"] }
    ]
  });
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Integration video document");
  form.append("file", new Blob([video], { type: "video/mp4" }), "integration-video-keyframes.mp4");

  const uploadResponse = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bootstrapToken}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`video document upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  const documentId = upload.document.id;
  const routeJobId = upload.route_job?.id;
  assert.equal(typeof routeJobId, "string", "video upload should enqueue a route job when scan is disabled");

  await waitFor(async () => {
    const status = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    return status.status === "chunked";
  }, "video document to reach chunked status");

  const routeJob = await waitForJobStatus(apiUrl, routeJobId, "succeeded");
  assert.equal(routeJob.type, "document.route");
  const document = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(document.metadata.routing.classification.kind, "video");
  assert.equal(document.metadata.extraction.processing_stage, "video");
  assert.equal(document.metadata.extraction.video_keyframes, true);
  assert.equal(document.metadata.extraction.frame_count, 3);
  assert.equal(document.metadata.extraction.manifest_frame_count, 5);
  assert.equal(document.metadata.extraction.max_keyframes, 3);
  assert.equal(document.metadata.extraction.keyframe_provider, "local-command");
  assert.equal(document.metadata.extraction.capabilities.vision_captioning.status, "provider_caption");
  assert.equal(document.metadata.extraction.capabilities.ocr.status, "provider_ocr");

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "passport airport dogs",
    limit: 5,
    metadataFilters: [
      { key: "extension", valueText: "mp4" },
      { key: "duration_ms", operator: "between", minNumber: 10_000, maxNumber: 15_000, unit: "ms" },
      { key: "frame_count", operator: "eq", valueNumber: 5, unit: "frames" }
    ]
  });
  const videoHit = search.hits.find((hit) => hit.documentId === documentId);
  assert.ok(videoHit, "video document search should find keyframe descriptions.");
  assert.ok(videoHit.sourceRefs.some((ref) => ref.type === "artifact"), "video search should include artifact source refs.");
  assert.equal(videoHit.metadata.video_keyframe_artifact_ids.length, 3, "video chunk metadata should include capped keyframe artifacts.");
  assert.ok(videoHit.metadata.semantic_artifact_types.includes("video_keyframe"), "video chunk metadata should include video_keyframe artifact type.");

  assert.equal(await countDocumentArtifacts(projectId, documentId, "video_keyframe", databaseUrl), 3);
  assert.equal(await countDocumentTextSpans(projectId, documentId, "video_keyframe_description", databaseUrl), 3);
  const mediaMetadata = await getDocumentMediaMetadata(projectId, documentId, databaseUrl);
  assert.equal(mediaMetadata.media_type, "video");
  assert.equal(mediaMetadata.duration_ms, 12_000);
  assert.equal(mediaMetadata.codec, "manifest-h264");

  return {
    documentId,
    routeJobId
  };
}

async function assertUnifiedArtifactSearch(apiUrl, input) {
  const unifiedImageSearch = await requestJson(apiUrl, "POST", "/v1/search", {
    projectIds: [projectId],
    query: "passport airport",
    targets: ["documents", "artifacts"],
    artifactTypes: ["ocr_text", "image_caption", "image_analysis", "object_detection", "image_embedding"],
    limit: 20,
    metadataFilters: [{ key: "extension", valueText: "png" }]
  });
  assert.ok(unifiedImageSearch.hits.some((hit) => hit.kind === "document_chunk" && hit.document_id === input.imageDocumentId), "unified search should include image document chunk hits.");
  assert.ok(unifiedImageSearch.hits.some((hit) => hit.kind === "artifact_span" && hit.document_id === input.imageDocumentId), "unified search should include image artifact span hits.");
  assert.ok(unifiedImageSearch.hits.every((hit) => hit.source_refs.length > 0), "unified search hits must include source refs.");

  const unifiedFaceSearch = await requestJson(apiUrl, "POST", "/v1/search", {
    projectIds: [projectId],
    query: "Integration Person A",
    targets: ["faces"],
    faceIdentityStatuses: ["candidate", "confirmed"],
    limit: 10,
    metadataFilters: [{ key: "extension", valueText: "png" }]
  });
  const faceUnifiedHit = unifiedFaceSearch.hits.find((hit) => hit.kind === "face_observation" && hit.document_id === input.imageDocumentId);
  assert.ok(faceUnifiedHit, "unified search should find renamed face identity observations.");
  assert.ok(faceUnifiedHit.source_refs.some((ref) => ref.type === "face_identity"), "unified face search hits should include face identity source refs.");
  assert.ok(faceUnifiedHit.source_refs.some((ref) => ref.type === "face_observation"), "unified face search hits should include face observation source refs.");

  const metadataOnlySearch = await requestJson(apiUrl, "POST", "/v1/search", {
    projectIds: [projectId],
    targets: ["artifacts"],
    artifactTypes: ["video_keyframe"],
    spanTypes: ["video_keyframe_description"],
    limit: 10,
    metadataFilters: [{ key: "frame_count", operator: "eq", valueNumber: 5, unit: "frames" }]
  });
  assert.ok(metadataOnlySearch.hits.some((hit) => hit.kind === "artifact_span" && hit.document_id === input.videoDocumentId), "unified metadata-only search should find video keyframe artifacts without a text query.");

  const imageSearch = await requestJson(apiUrl, "POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "passport airport",
    artifactTypes: ["ocr_text", "image_caption", "image_analysis"],
    limit: 10,
    metadataFilters: [{ key: "extension", valueText: "png" }]
  });
  assert.ok(imageSearch.hits.some((hit) => hit.document_id === input.imageDocumentId), "artifact search should find image OCR/caption artifacts.");
  assert.ok(imageSearch.hits.every((hit) => hit.source_refs.some((ref) => ref.type === "artifact")), "artifact search hits should include artifact source refs.");

  const faceSearch = await requestJson(apiUrl, "POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "face observation",
    artifactTypes: ["face_observation"],
    spanTypes: ["face_observation"],
    limit: 10,
    metadataFilters: [{ key: "extension", valueText: "png" }]
  });
  const faceHit = faceSearch.hits.find((hit) => hit.document_id === input.imageDocumentId);
  assert.ok(faceHit, "artifact search should find face observation spans.");
  assert.ok(faceHit.source_refs.some((ref) => ref.type === "face_identity"), "face artifact search hits should include face identity source refs.");

  const audioSearch = await requestJson(apiUrl, "POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "durable memory recall",
    artifactTypes: ["transcript"],
    spanTypes: ["transcript_segment"],
    limit: 10,
    metadataFilters: [{ key: "extension", valueText: "wav" }]
  });
  const audioHit = audioSearch.hits.find((hit) => hit.document_id === input.audioDocumentId);
  assert.ok(audioHit, "artifact search should find audio transcript spans.");
  assert.equal(audioHit.metadata.start_ms, 0);
  assert.equal(audioHit.metadata.end_ms, 1000);

  const videoSearch = await requestJson(apiUrl, "POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "dogs luggage",
    artifactTypes: ["video_keyframe"],
    spanTypes: ["video_keyframe_description"],
    limit: 10,
    metadataFilters: [{ key: "frame_count", operator: "eq", valueNumber: 5, unit: "frames" }]
  });
  const videoHit = videoSearch.hits.find((hit) => hit.document_id === input.videoDocumentId);
  assert.ok(videoHit, "artifact search should find video keyframe spans.");
  assert.equal(videoHit.metadata.timestamp_ms, 3000);
  assert.equal(videoHit.source_position.timestamp_ms, 3000);
}

async function uploadAndIndexDocument(input) {
  const documentText = [
    "Mindory indexed document.",
    "semantic source-backed retrieval should return vector-backed chunks.",
    "The worker pipeline must embed chunks, index them and serve document search."
  ].join("\n");
  const form = new FormData();
  form.append("projectId", input.projectId);
  form.append("title", "Indexed integration document");
  form.append("file", new Blob([documentText], { type: "text/plain" }), "indexed-integration.txt");

  const uploadResponse = await fetch(`${input.apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.token}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`document upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  const documentId = upload.document.id;
  assert.equal(typeof upload.route_job?.id, "string", "document upload should enqueue a route job when scan is disabled");

  await waitFor(async () => {
    const status = await requestJson(input.apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(input.projectId)}`, undefined, input.token);
    return status.status === "indexed";
  }, "document to reach indexed status", 90);

  return documentId;
}

async function assertJobsApi(apiUrl, store, sessionId, documentId, routeJobId) {
  const listed = await requestJson(apiUrl, "GET", `/v1/jobs?projectId=${encodeURIComponent(projectId)}&limit=20`);
  assert.ok(listed.jobs.some((job) => job.id === routeJobId), "job list should include document route job");

  const routeJob = await requestJson(apiUrl, "GET", `/v1/jobs/${encodeURIComponent(routeJobId)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(routeJob.status, "succeeded");
  assert.equal(routeJob.details.status, "succeeded");
  assert.ok(routeJob.details.stages.some((stage) => stage.stage === "route" && stage.status === "succeeded"), "route job should expose route stage details.");
  assert.ok(routeJob.details.stages.some((stage) => stage.stage === "text" && stage.status === "pending"), "route job should expose planned extraction stage.");

  const chunkJobSummary = listed.jobs.find((job) => job.type === "document.chunk" && job.target_id === documentId);
  assert.ok(chunkJobSummary, "job list should include document chunk job");
  const chunkJob = await requestJson(apiUrl, "GET", `/v1/jobs/${encodeURIComponent(chunkJobSummary.id)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(chunkJob.status, "succeeded");
  assert.ok(chunkJob.details.stages.some((stage) => stage.stage === "embed" && stage.status === "disabled"), "chunk job should expose disabled embedding stage.");

  const failedSeed = await store.createPendingJob({
    projectId,
    type: "document.route",
    targetType: "document",
    targetId: documentId,
    idempotencyKey: `integration.document.failed:${documentId}`,
    processorVersion: "document-route-v1",
    metadata: {
      source: "integration-test"
    }
  });
  await store.markJobRunning(failedSeed.id);
  await store.markJobFailed(failedSeed.id, Object.assign(new Error("Synthetic readable failure."), { code: "document_route_failed" }));
  const failedJob = await requestJson(apiUrl, "GET", `/v1/jobs/${encodeURIComponent(failedSeed.id)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(failedJob.status, "failed");
  assert.equal(failedJob.details.status, "failed");
  assert.equal(failedJob.details.error.code, "document_route_failed");
  assert.equal(failedJob.details.error.retryable, true);

  const retrySeed = await store.createPendingJob({
    projectId,
    type: "session.summarize",
    targetType: "session",
    targetId: sessionId,
    idempotencyKey: `integration.session.retry:${sessionId}`,
    processorVersion: "session-summary-v1",
    metadata: {
      source: "integration-test"
    }
  });
  const retried = await requestJson(apiUrl, "POST", `/v1/jobs/${encodeURIComponent(retrySeed.id)}/retry`, {
    projectId
  });
  assert.equal(retried.retry.processing_job_id, retrySeed.id);
  await waitForJobStatus(apiUrl, retrySeed.id, "succeeded");
}

async function assertDocumentRecompute(apiUrl, documentId) {
  const first = await requestJson(apiUrl, "POST", `/v1/documents/${encodeURIComponent(documentId)}/recompute`, {
    projectId,
    stages: ["text"],
    reason: "integration_recompute",
    requestId: `${testRunId}_recompute_1`
  });
  assert.equal(first.job.id.length > 0, true, "recompute response should include a processing job id.");
  assert.equal(first.stages[0], "text");
  await waitForJobStatus(apiUrl, first.job.id, "succeeded");
  await waitForDocumentRun(apiUrl, documentId, first.processing_run_id);

  const second = await requestJson(apiUrl, "POST", `/v1/documents/${encodeURIComponent(documentId)}/recompute`, {
    projectId,
    stages: ["text"],
    reason: "integration_recompute",
    requestId: `${testRunId}_recompute_2`
  });
  await waitForJobStatus(apiUrl, second.job.id, "succeeded");
  await waitForDocumentRun(apiUrl, documentId, second.processing_run_id);

  const listed = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}/processing-runs?projectId=${encodeURIComponent(projectId)}`);
  const firstRun = listed.processing_runs.find((run) => run.id === first.processing_run_id);
  const secondRun = listed.processing_runs.find((run) => run.id === second.processing_run_id);
  assert.ok(firstRun, "processing run list should include the first recompute run.");
  assert.ok(secondRun, "processing run list should include the second recompute run.");
  assert.equal(firstRun.status, "superseded", "older derived processing run should be superseded by recompute.");
  assert.equal(firstRun.metadata.superseded_by_run_id, second.processing_run_id);
  assert.equal(secondRun.status, "succeeded", "latest recompute processing run should succeed.");
  assert.equal(secondRun.metadata.raw_original_unchanged, true, "recompute must record that RAW original was not mutated.");
  assert.equal(secondRun.source_document_storage_key, firstRun.source_document_storage_key, "recompute should keep the same RAW storage key.");
}

async function waitForDocumentRun(apiUrl, documentId, processingRunId) {
  await waitFor(async () => {
    const document = await requestJson(apiUrl, "GET", `/v1/documents/${encodeURIComponent(documentId)}?projectId=${encodeURIComponent(projectId)}`);
    return ["chunked", "indexed"].includes(document.status) && document.metadata?.routing?.processing_run_id === processingRunId;
  }, `document ${documentId} to finish recompute run ${processingRunId}`, 90);
}

async function assertMemoryAndContext(apiUrl, sessionId, messageId, documentId) {
  const memory = await requestJson(apiUrl, "POST", "/v1/memories", {
    projectId,
    type: "preference",
    text: "source-backed context matters in integration tests",
    status: "active",
    importance: 0.8,
    confidence: 0.9,
    sourceRefs: [{ type: "message", id: messageId }]
  });
  assert.equal(memory.source_refs[0].id, messageId);

  const context = await requestJson(apiUrl, "POST", "/v1/context/build", {
    projectIds: [projectId],
    sessionId,
    query: "source-backed context",
    tokenBudget: 3000
  });
  assert.ok(context.blocks.some((block) => block.type === "memory" && block.content.includes("source-backed context")));
  assert.ok(context.blocks.some((block) => block.type === "document_chunk" && block.metadata.document_id === documentId));
}

async function assertRevokedTokenIsRejected(apiUrl, tokenId, rawToken) {
  const revoked = await requestJson(apiUrl, "POST", `/v1/tokens/${encodeURIComponent(tokenId)}/revoke`, {
    projectId
  });
  assert.equal(revoked.access_token.status, "revoked");

  const response = await fetch(`${apiUrl}/v1/projects/${encodeURIComponent(projectId)}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${rawToken}`
    }
  });
  assert.equal(response.status, 401, "revoked token should no longer authenticate");
}

async function withSyncScanApi(options, callback) {
  const syncProjectId = `project_${options.runId}`;
  const syncToken = `token_${options.runId}`;
  const syncEnv = {
    ...testEnv,
    MINDORY_QUEUE_PREFIX: `mindory:sync-scan:${options.runId}`,
    MINDORY_CACHE_PREFIX: `mindory:sync-scan-cache:${options.runId}`,
    MINDORY_STORAGE_LOCAL_PATH: options.storagePath,
    MINDORY_AV_ENABLED: "true",
    MINDORY_AV_PROVIDER: "clamav",
    MINDORY_AV_MODE: "sync_scan",
    MINDORY_AV_ON_INFECTED: options.onInfected,
    MINDORY_AV_ON_SCAN_FAILURE: options.onScanFailure,
    MINDORY_CLAMAV_HOST: "127.0.0.1",
    MINDORY_CLAMAV_PORT: String(options.clamavPort)
  };
  const config = modules.loadMindoryConfig(syncEnv);
  let apiApp = null;
  let runtime = null;

  try {
    await mkdir(options.storagePath, { recursive: true });
    await cleanupProjectInDatabase(syncProjectId, databaseUrl);
    await seedProjectTokenInDatabase({
      projectId: syncProjectId,
      token: syncToken,
      tokenId: `tok_${options.runId}`,
      permissions: [...modules.MINDORY_PERMISSIONS]
    }, databaseUrl);

    runtime = modules.buildApiRuntimeDependencies(config);
    apiApp = await modules.buildApiApp({ config, ...runtime, logger: false });
    await apiApp.listen({ host: "127.0.0.1", port: 0 });
    await callback({
      apiUrl: addressToUrl(apiApp.server.address()),
      projectId: syncProjectId,
      token: syncToken,
      runtime
    });
  } finally {
    if (apiApp) {
      await apiApp.close();
    } else if (runtime) {
      await runtime.close();
    }
    await cleanupProjectInDatabase(syncProjectId, databaseUrl);
  }
}

async function uploadRawDocument(input) {
  const form = new FormData();
  form.append("projectId", input.projectId);
  form.append("title", input.filename);
  form.append("file", new Blob([input.text], { type: "text/plain" }), input.filename);

  const uploadResponse = await fetch(`${input.apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.token}`
    },
    body: form
  });
  if (uploadResponse.status !== 202) {
    throw new Error(`sync_scan document upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }
  return uploadResponse.json();
}

function startClamdProtocolServer() {
  const command = Buffer.from("zINSTREAM\0", "utf8");
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let replied = false;

    socket.on("data", (chunk) => {
      if (replied) {
        return;
      }
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      if (buffer.length < command.length) {
        return;
      }
      if (!buffer.subarray(0, command.length).equals(command)) {
        replied = true;
        socket.end("stream: ClamAV protocol error FOUND\0");
        return;
      }
      const parsed = parseClamdInstreamBody(buffer.subarray(command.length));
      if (!parsed.complete) {
        return;
      }
      replied = true;
      const body = parsed.body.toString("utf8");
      socket.end(body.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string", "clamd protocol server must listen on a TCP address.");
      resolve({
        port: address.port,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error);
              return;
            }
            closeResolve();
          });
        })
      });
    });
  });
}

function parseClamdInstreamBody(buffer) {
  let offset = 0;
  const chunks = [];
  while (offset + 4 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    offset += 4;
    if (chunkLength === 0) {
      return {
        complete: true,
        body: Buffer.concat(chunks)
      };
    }
    if (offset + chunkLength > buffer.length) {
      return {
        complete: false,
        body: Buffer.alloc(0)
      };
    }
    chunks.push(buffer.subarray(offset, offset + chunkLength));
    offset += chunkLength;
  }
  return {
    complete: false,
    body: Buffer.alloc(0)
  };
}

async function requestJson(apiUrl, method, pathname, body = undefined, token = bootstrapToken) {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForJobStatus(apiUrl, jobId, status) {
  let latest = null;
  await waitFor(async () => {
    latest = await requestJson(apiUrl, "GET", `/v1/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`);
    return latest.status === status;
  }, `job ${jobId} to reach ${status}`);
  return latest;
}

async function waitForDocumentJobStatus(apiUrl, documentId, type, status, attempts = 60) {
  let latest = null;
  await waitFor(async () => {
    const listed = await requestJson(apiUrl, "GET", `/v1/jobs?projectId=${encodeURIComponent(projectId)}&type=${encodeURIComponent(type)}&limit=50`);
    latest = listed.jobs.find((job) => job.target_id === documentId);
    return latest?.status === status;
  }, `${type} job for ${documentId} to reach ${status}`, attempts);
  return latest;
}

async function waitFor(check, label, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function seedProjectToken(input) {
  await seedProjectTokenInDatabase(input, databaseUrl);
}

async function seedProjectTokenInDatabase(input, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        insert into projects (id, name, metadata)
        values ($1, $2, $3::jsonb)
      `,
      [input.projectId, "Integration Test Project", JSON.stringify({ test_run_id: input.projectId })]
    );
    await client.query(
      `
        insert into access_tokens (id, project_id, name, token_hash, status, metadata)
        values ($1, $2, $3, $4, 'active', $5::jsonb)
      `,
      [input.tokenId, input.projectId, "Integration bootstrap token", hashAccessToken(input.token), JSON.stringify({ test_run_id: input.projectId })]
    );
    await client.query(
      `
        insert into access_token_project_scopes (token_id, project_id, permissions)
        values ($1, $2, $3::text[])
      `,
      [input.tokenId, input.projectId, input.permissions]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function cleanupProject(id) {
  await cleanupProjectInDatabase(id, databaseUrl);
}

async function cleanupProjectInDatabase(id, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("delete from access_token_project_scopes where project_id = $1", [id]);
    await client.query("delete from access_tokens where project_id = $1", [id]);
    await client.query("delete from projects where id = $1", [id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function countVectorEmbeddings(id, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query("select count(*)::int as count from chunk_vector_embeddings where project_id = $1", [id]);
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function countLinkedDocumentChunks(id, documentId, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "select count(*)::int as count from chunks where project_id = $1 and document_id = $2 and embedding_id is not null",
      [id, documentId]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function countArtifactTextSpans(id, documentId, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "select count(*)::int as count from document_artifact_text_spans where project_id = $1 and document_id = $2",
      [id, documentId]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function countDocumentArtifacts(id, documentId, artifactType, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "select count(*)::int as count from document_artifacts where project_id = $1 and document_id = $2 and artifact_type = $3",
      [id, documentId, artifactType]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function countDocumentTextSpans(id, documentId, spanType, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "select count(*)::int as count from document_artifact_text_spans where project_id = $1 and document_id = $2 and span_type = $3",
      [id, documentId, spanType]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function countDocumentArtifactVectors(id, documentId, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "select count(*)::int as count from document_artifact_vectors where project_id = $1 and document_id = $2",
      [id, documentId]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function countDocumentMetadataIndexRows(id, documentId, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "select count(*)::int as count from document_metadata_index where project_id = $1 and document_id = $2",
      [id, documentId]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function getDocumentMediaMetadata(id, documentId, connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "select media_type, duration_ms, codec, checksum_sha256, metadata from document_media_metadata where project_id = $1 and document_id = $2",
      [id, documentId]
    );
    assert.equal(result.rows.length, 1, "document_media_metadata should contain one row for the document.");
    return result.rows[0];
  } finally {
    await client.end();
  }
}

function startOpenAiCompatibleEmbeddingServer(options) {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/embeddings") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      const body = JSON.parse(await readRequestBody(request));
      const texts = Array.isArray(body.input) ? body.input : [body.input];
      calls.push({ model: body.model, input: texts });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        model: body.model ?? "mindory-test-embedding",
        data: texts.map((text, index) => ({
          index,
          embedding: deterministicEmbedding(String(text), options.dimensions)
        }))
      }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "embedding_server_error" }));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string", "Fake embeddings server must listen on a TCP address.");
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        calls,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error);
              return;
            }
            closeResolve();
          });
        })
      });
    });
  });
}

function startLocalHttpOcrServer(options) {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || !["/ocr", "/vision/caption", "/vision/objects", "/embeddings/images", "/asr", "/faces/detect", "/faces/recognize"].includes(request.url ?? "")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      const body = JSON.parse(await readRequestBody(request));
      calls.push({ model: body.model, mimeType: body.mime_type });
      if (request.url === "/vision/caption") {
        const frameText = decodeBase64Text(body.data_base64);
        const frameCaption = videoFrameCaption(frameText);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          model: body.model ?? "mindory-test-vision",
          caption: frameCaption.caption ?? options.visionCaption,
          labels: frameCaption.labels ?? options.labels
        }));
        return;
      }
      if (request.url === "/vision/objects") {
        const frameText = decodeBase64Text(body.data_base64);
        const frameCaption = videoFrameCaption(frameText);
        const labels = frameCaption.labels ?? options.labels;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          model: body.model ?? "mindory-test-vision",
          labels,
          objects: [{
            label: labels[0] ?? "passport",
            confidence: 0.97,
            bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, unit: "ratio" }
          }]
        }));
        return;
      }
      if (request.url === "/embeddings/images") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          model: body.model ?? "mindory-test-image-embedding",
          data: [{ index: 0, embedding: deterministicEmbedding("image artifact vector", 1536) }]
        }));
        return;
      }
      if (request.url === "/asr") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          model: body.model ?? "mindory-test-asr",
          text: options.asrText,
          segments: options.asrSegments.map((segment) => ({
            segment_index: segment.segmentIndex,
            text: segment.text,
            start_ms: segment.startMs,
            end_ms: segment.endMs,
            confidence: segment.confidence
          })),
          duration_seconds: 1
        }));
        return;
      }
      if (request.url === "/faces/detect" || request.url === "/faces/recognize") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          model: body.model ?? "mindory-test-face",
          faces: [0, 1, 2].map((index) => ({
            bounding_box: {
              x: 0.1 + index * 0.22,
              y: 0.2,
              width: 0.16,
              height: 0.32,
              unit: "ratio"
            },
            embedding: oneHotEmbedding(index, 512),
            confidence: 0.97,
            label: `person-${index + 1}`
          }))
        }));
        return;
      }
      const isImage = String(body.mime_type ?? "").startsWith("image/");
      const frameText = decodeBase64Text(body.data_base64);
      const videoOcrText = videoFrameOcrText(frameText);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        model: body.model ?? "mindory-test-ocr",
        text: isImage ? videoOcrText ?? options.imageText : options.pages.map((page) => page.text).join("\n\n"),
        pages: (isImage ? [{ pageNumber: 1, text: videoOcrText ?? options.imageText, confidence: 0.97 }] : options.pages).map((page) => ({
          page_number: page.pageNumber,
          text: page.text,
          confidence: page.confidence
        }))
      }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "ocr_server_error" }));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string", "Fake OCR server must listen on a TCP address.");
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        calls,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error);
              return;
            }
            closeResolve();
          });
        })
      });
    });
  });
}

async function startDoclingService(envOverrides, portOverride = null) {
  const port = portOverride ?? await getFreePort();
  const child = spawn(process.execPath, ["scripts/docling-service.mjs"], {
    cwd: root,
    env: {
      ...testEnv,
      ...envOverrides,
      MINDORY_DOCLING_HOST: "127.0.0.1",
      MINDORY_DOCLING_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  await waitForDoclingHealth(`http://127.0.0.1:${port}/health`, child, logs);
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((resolve, reject) => {
      if (closed) {
        resolve();
        return;
      }
      closed = true;
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      child.once("error", reject);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 2_000).unref();
    })
  };
}

async function waitForDoclingHealth(url, child, logs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Docling service exited before becoming healthy: ${logs.join("").trim()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the child process binds the HTTP port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Docling service did not become healthy: ${logs.join("").trim()}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        assert.ok(address && typeof address !== "string", "free port probe must return a TCP address.");
        resolve(address.port);
      });
    });
  });
}

async function writeFakeKeyframeExtractorScript(directory) {
  const scriptPath = path.join(directory, "fake-video-keyframes.mjs");
  await writeFile(scriptPath, `
const frame = text => Buffer.from(text, "utf8").toString("base64");
console.log(JSON.stringify({
  durationMs: 12000,
  codec: "manifest-h264",
  frames: [
    { timestampMs: 0, description: "opening frame shows a passport in hand at an airport", labels: ["passport", "airport"], mime_type: "image/png", data_base64: frame("video-frame passport airport") },
    { timestampMs: 3000, description: "second frame shows two dogs near luggage", labels: ["dogs", "luggage"], mime_type: "image/png", data_base64: frame("video-frame dogs luggage") },
    { timestampMs: 6000, description: "third frame shows nature through a window", labels: ["nature", "window"], mime_type: "image/png", data_base64: frame("video-frame nature window") },
    { timestampMs: 9000, description: "fourth frame should be skipped by max keyframes", labels: ["skipped"], mime_type: "image/png", data_base64: frame("video-frame skipped fourth") },
    { timestampMs: 11000, description: "fifth frame should also be skipped", labels: ["skipped"], mime_type: "image/png", data_base64: frame("video-frame skipped fifth") }
  ]
}));
`, "utf8");
  return scriptPath;
}

function decodeBase64Text(value) {
  return typeof value === "string" ? Buffer.from(value, "base64").toString("utf8") : "";
}

function videoFrameCaption(text) {
  if (text.includes("dogs")) {
    return { caption: "Vision provider frame caption sees two dogs near luggage.", labels: ["dogs", "luggage"] };
  }
  if (text.includes("nature")) {
    return { caption: "Vision provider frame caption sees nature through a window.", labels: ["nature", "window"] };
  }
  if (text.includes("passport")) {
    return { caption: "Vision provider frame caption sees passport in hand at airport.", labels: ["passport", "airport"] };
  }
  return {};
}

function videoFrameOcrText(text) {
  if (text.startsWith("video-frame ")) {
    return `Frame OCR provider text ${text.replace(/^video-frame\s+/, "")}.`;
  }
  return null;
}

function oneHotEmbedding(index, dimensions) {
  return Array.from({ length: dimensions }, (_, valueIndex) => valueIndex === index ? 1 : 0);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function deterministicEmbedding(text, dimensions) {
  const digest = createHash("sha256").update(text, "utf8").digest();
  return Array.from({ length: dimensions }, (_, index) => {
    const byte = digest[index % digest.length];
    return Number(((byte / 255) * 2 - 1).toFixed(6));
  });
}

function buildMinimalPdf(pageTexts) {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    `2 0 obj\n<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pageTexts.length} >>\nendobj`
  ];
  for (const [index, text] of pageTexts.entries()) {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const content = `BT /F1 12 Tf 72 720 Td (${escapePdfLiteralString(text)}) Tj ET`;
    objects.push(`${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjectId} 0 R >>\nendobj`);
    objects.push(`${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream\nendobj`);
  }
  return Buffer.from([
    "%PDF-1.4",
    ...objects,
    "trailer\n<< /Root 1 0 R >>",
    "%%EOF"
  ].join("\n"), "latin1");
}

function escapePdfLiteralString(value) {
  return value.replace(/[()\\]/g, (match) => `\\${match}`);
}

function buildMinimalPng(input) {
  const pixelBytesPerRow = input.width * 3;
  const rawRows = Buffer.alloc((pixelBytesPerRow + 1) * input.height);
  for (let y = 0; y < input.height; y += 1) {
    const rowStart = y * (pixelBytesPerRow + 1);
    rawRows[rowStart] = 0;
    for (let x = 0; x < input.width; x += 1) {
      const pixelStart = rowStart + 1 + x * 3;
      rawRows[pixelStart] = 0xe8;
      rawRows[pixelStart + 1] = 0xf3;
      rawRows[pixelStart + 2] = 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(input.width, 0);
  ihdr.writeUInt32BE(input.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from(`Description\0${input.text}`, "utf8")),
    pngChunk("IDAT", deflateSync(rawRows)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function buildMinimalWav(input) {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.round((input.sampleRate * input.durationMs) / 1000);
  const data = Buffer.alloc(sampleCount * channels * bytesPerSample);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(input.sampleRate, 4);
  fmt.writeUInt32LE(input.sampleRate * channels * bytesPerSample, 8);
  fmt.writeUInt16LE(channels * bytesPerSample, 12);
  fmt.writeUInt16LE(bitsPerSample, 14);
  const transcript = Buffer.concat([
    Buffer.from(input.transcript, "utf8"),
    Buffer.from([0])
  ]);
  const info = Buffer.concat([
    Buffer.from("INFO", "latin1"),
    riffChunk("ICMT", transcript)
  ]);
  const chunks = [
    riffChunk("fmt ", fmt),
    riffChunk("data", data),
    riffChunk("LIST", info)
  ];
  const size = 4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(size, 4);
  header.write("WAVE", 8, "latin1");
  return Buffer.concat([header, ...chunks]);
}

function buildVideoManifestFile(input) {
  return Buffer.from(`MINDORY_VIDEO_MANIFEST\n${JSON.stringify(input)}`, "utf8");
}

function riffChunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, "latin1");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hashAccessToken(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function buildWorkspaces() {
  if (process.env.MINDORY_TEST_SKIP_BUILD === "true") {
    return;
  }
  runCommand(process.execPath, ["scripts/typecheck-workspaces.js"], {
    env: process.env
  });
}

async function startIntegrationInfrastructure() {
  if (process.env.MINDORY_TEST_SKIP_DOCKER === "true") {
    return;
  }
  const docker = resolveDockerBinary();
  runCommand(docker, ["compose", ...dockerComposeFiles, "--profile", "qdrant", "up", "-d", "postgres", "redis", "qdrant"], {
    env: dockerEnv()
  });
}

async function runMigration() {
  runCommand(process.execPath, ["packages/db/scripts/migrate.mjs"], {
    env: testEnv
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: options.env
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

async function waitForTcp(host, port, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await canConnect(host, port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become reachable on ${host}:${port}.`);
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch {
      try {
        await client.end();
      } catch {
        // Ignore close errors while PostgreSQL is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error("PostgreSQL did not become query-ready.");
}

async function waitForQdrant() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${qdrantUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry while Qdrant finishes booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Qdrant did not become healthy at ${qdrantUrl}.`);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function loadRuntimeModules() {
  const [
    apiApp,
    apiRuntime,
    workerRuntime,
    config,
    auth,
    db,
    queue,
    coreQueue,
    qdrant
  ] = await Promise.all([
    import("../apps/api/dist/app.js"),
    import("../apps/api/dist/runtime.js"),
    import("../apps/worker/dist/runtime.js"),
    import("../packages/config/dist/index.js"),
    import("../packages/auth/dist/index.js"),
    import("../packages/db/dist/index.js"),
    import("../packages/queue/bullmq/dist/index.js"),
    import("../packages/core/dist/queue.js"),
    import("../packages/vector/qdrant/dist/index.js")
  ]);

  return {
    ...apiApp,
    ...apiRuntime,
    ...workerRuntime,
    ...config,
    ...auth,
    ...db,
    ...queue,
    ...coreQueue,
    ...qdrant
  };
}

async function deleteQdrantCollection(baseUrl, collectionName) {
  try {
    await fetch(`${baseUrl}/collections/${encodeURIComponent(collectionName)}`, {
      method: "DELETE"
    });
  } catch {
    // Collection cleanup is best-effort; the test collection name is unique.
  }
}

function addressToUrl(address) {
  assert.ok(address && typeof address !== "string", "API server must listen on a TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

function resolveDockerBinary() {
  return process.env.MINDORY_TEST_DOCKER_BIN || "/usr/local/bin/docker";
}

function dockerEnv() {
  return {
    ...process.env,
    PATH: [
      "/Applications/Docker.app/Contents/Resources/bin",
      "/usr/local/bin",
      process.env.PATH ?? ""
    ].join(":"),
    MINDORY_TEST_POSTGRES_PORT: postgresPort,
    MINDORY_TEST_REDIS_PORT: redisPort,
    MINDORY_TEST_QDRANT_PORT: qdrantPort,
    MINDORY_QDRANT_HTTP_PORT: qdrantPort,
    MINDORY_QDRANT_GRPC_PORT: String(Number(qdrantPort) + 1)
  };
}
