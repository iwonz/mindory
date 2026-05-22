import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
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
const databaseUrl = process.env.MINDORY_TEST_DATABASE_URL ?? `postgresql://mindory:mindory@127.0.0.1:${postgresPort}/mindory`;
const redisUrl = process.env.MINDORY_TEST_REDIS_URL ?? `redis://127.0.0.1:${redisPort}`;
const storagePath = path.join(os.tmpdir(), `mindory-integration-${testRunId}`);
const queuePrefix = `mindory:test:${testRunId}`;
const testEnv = {
  ...process.env,
  MINDORY_LOG_LEVEL: "error",
  MINDORY_DATABASE_URL: databaseUrl,
  MINDORY_REDIS_URL: redisUrl,
  MINDORY_QUEUE_PREFIX: queuePrefix,
  MINDORY_CACHE_PREFIX: `mindory:test-cache:${testRunId}`,
  MINDORY_STORAGE_PROVIDER: "local-fs",
  MINDORY_STORAGE_LOCAL_PATH: storagePath,
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
await waitForPostgres();
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
  const apiApp = await modules.buildApiApp({ config, logger: false });

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

test("MVP runtime integration covers auth, upload, worker jobs and context", { timeout: 120_000 }, async () => {
  const config = modules.loadMindoryConfig(testEnv);
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
  const pdf = buildMinimalPdf([
    "Native PDF extraction page one source-backed evidence.",
    "Second PDF page keeps OCR pipeline page refs searchable."
  ]);
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Integration PDF document");
  form.append("file", new Blob([pdf], { type: "application/pdf" }), "integration.pdf");

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
  assert.equal(document.metadata.extraction.page_count, 2);

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "OCR pipeline page refs",
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

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "passport airport nature 3 people",
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
  assert.equal(await countDocumentArtifacts(projectId, documentId, "ocr_text", databaseUrl), 1);
  assert.equal(await countDocumentTextSpans(projectId, documentId, "image_caption", databaseUrl), 1);
  assert.equal(await countDocumentTextSpans(projectId, documentId, "image_analysis", databaseUrl), 1);
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

  const search = await requestJson(apiUrl, "POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "durable memory recall",
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
    "semantic source-backed retrieval should return pgvector-backed chunks.",
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
  runCommand(docker, ["compose", ...dockerComposeFiles, "up", "-d", "postgres", "redis"], {
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
    coreQueue
  ] = await Promise.all([
    import("../apps/api/dist/app.js"),
    import("../apps/api/dist/runtime.js"),
    import("../apps/worker/dist/runtime.js"),
    import("../packages/config/dist/index.js"),
    import("../packages/auth/dist/index.js"),
    import("../packages/db/dist/index.js"),
    import("../packages/queue/bullmq/dist/index.js"),
    import("../packages/core/dist/queue.js")
  ]);

  return {
    ...apiApp,
    ...apiRuntime,
    ...workerRuntime,
    ...config,
    ...auth,
    ...db,
    ...queue,
    ...coreQueue
  };
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
    MINDORY_TEST_REDIS_PORT: redisPort
  };
}
