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
  MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED: "false",
  MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_PROVIDER: "disabled",
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
    await assertJobsApi(apiUrl, managementStore, sessionId, routeJobId);
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
    MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED: "true",
    MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_PROVIDER: "openai-compatible",
    MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_MODEL: "mindory-test-embedding",
    MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS: "1536",
    MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL: fakeEmbeddings.baseUrl,
    MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE: "api-key",
    MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY: "test-key"
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

async function assertJobsApi(apiUrl, store, sessionId, routeJobId) {
  const listed = await requestJson(apiUrl, "GET", `/v1/jobs?projectId=${encodeURIComponent(projectId)}&limit=20`);
  assert.ok(listed.jobs.some((job) => job.id === routeJobId), "job list should include document route job");

  const routeJob = await requestJson(apiUrl, "GET", `/v1/jobs/${encodeURIComponent(routeJobId)}?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(routeJob.status, "succeeded");

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
      "select media_type, checksum_sha256, metadata from document_media_metadata where project_id = $1 and document_id = $2",
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
