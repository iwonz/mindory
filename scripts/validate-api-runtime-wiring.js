import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "apps/api/src/runtime.ts",
  "apps/api/src/routes/artifacts.ts",
  "apps/api/src/routes/tokens.ts",
  "apps/api/src/routes/peers.ts",
  "apps/api/src/routes/sessions.ts",
  "apps/api/src/routes/faces.ts",
  "apps/api/src/routes/jobs.ts",
  "packages/db/src/client.ts"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `${file} is required.`);
}

const rootPackage = readJson("package.json");
const apiPackage = readJson("apps/api/package.json");
const dbPackage = readJson("packages/db/package.json");
const app = read("apps/api/src/app.ts");
const server = read("apps/api/src/server.ts");
const runtime = read("apps/api/src/runtime.ts");
const errors = read("apps/api/src/errors.ts");
const artifactRoutes = read("apps/api/src/routes/artifacts.ts");
const projectRoutes = read("apps/api/src/routes/projects.ts");
const tokenRoutes = read("apps/api/src/routes/tokens.ts");
const peerRoutes = read("apps/api/src/routes/peers.ts");
const sessionRoutes = read("apps/api/src/routes/sessions.ts");
const documentRoutes = read("apps/api/src/routes/documents.ts");
const faceRoutes = read("apps/api/src/routes/faces.ts");
const jobRoutes = read("apps/api/src/routes/jobs.ts");
const memoryRoutes = read("apps/api/src/routes/memories.ts");
const contextRoutes = read("apps/api/src/routes/context.ts");
const dbClient = read("packages/db/src/client.ts");
const dbIndex = read("packages/db/src/index.ts");

assert(rootPackage.scripts?.["api:runtime:validate"] === "node scripts/validate-api-runtime-wiring.js", "Root package must expose api:runtime:validate.");
assert(apiPackage.dependencies?.["@mindory/db"] === "workspace:*", "@mindory/api must depend on @mindory/db for runtime wiring.");
assert(dbPackage.exports?.["./client"], "@mindory/db must export ./client.");
assert(dbIndex.includes('export * from "./client.js";'), "@mindory/db root index must export client.");

for (const symbol of ["Pool", "drizzle", "createMindoryDatabaseClient", "close()"]) {
  assert(dbClient.includes(symbol), `Database client must include ${symbol}.`);
}

for (const symbol of [
  "buildApiRuntimeDependencies",
  "createMindoryDatabaseClient",
  "DbProjectRepository",
  "DbPeerRepository",
  "DbSessionRepository",
  "DbAccessTokenRepository",
  "DbDocumentRepository",
  "DbDerivedArtifactRepository",
  "DbDocumentChunkSearchRepository",
  "DbProcessingJobStore",
  "DbMemoryRepository",
  "LocalFsObjectStorage",
  "BullMqProcessingJobQueue",
  "ProcessingJobDispatcher",
  "DocumentUploadService",
  "DocumentRecomputeService",
  "PgVectorChunkIndex",
  "PgVectorDocumentChunkSearchRepository",
  "buildMindoryLlm",
  "FaceService",
  "MemoryService",
  "ContextBuilder"
]) {
  assert(runtime.includes(symbol), `API runtime wiring must include ${symbol}.`);
}

assert(server.includes("buildApiRuntimeDependencies"), "API server must build runtime dependencies.");
assert(server.includes("buildApiApp({ config, ...runtime })"), "API server must pass runtime dependencies to app builder.");
assert(app.includes("registerPeerRoutes"), "API app must register peer routes.");
assert(app.includes("registerArtifactRoutes"), "API app must register artifact routes.");
assert(app.includes("registerTokenRoutes"), "API app must register token routes.");
assert(app.includes("registerSessionRoutes"), "API app must register session routes.");
assert(app.includes("registerFaceRoutes"), "API app must register face routes.");
assert(app.includes("options.close"), "API app must close runtime dependencies on shutdown.");
assert(errors.includes("isRepositoryNotFoundError"), "API error handler must map repository not-found errors.");

for (const token of ["projectRepository", "createProject", "listProjects", "getProject"]) {
  assert(projectRoutes.includes(token), `Project routes must use ${token}.`);
}

for (const route of ['"/v1/tokens"', '"/v1/tokens/:id/revoke"', '"/v1/tokens/:id/rotate"']) {
  assert(tokenRoutes.includes(route), `Token routes must include ${route}.`);
}
for (const token of ["createAccessToken", "listAccessTokens", "revokeAccessToken", "rotateAccessToken", "hashAccessToken", "generateAccessTokenSecret"]) {
  assert(tokenRoutes.includes(token), `Token routes must use ${token}.`);
}
assert(tokenRoutes.includes('"token:read"'), "Token listing must require token:read permission.");
assert(tokenRoutes.includes('"token:write"'), "Token mutations must require token:write permission.");
assert(!tokenRoutes.includes("token_hash"), "Token API responses must not expose token_hash.");

for (const route of ['"/v1/peers"', '"/v1/peers/:id"']) {
  assert(peerRoutes.includes(route), `Peer routes must include ${route}.`);
}
for (const token of ["peerRepository", "upsertPeer", "listPeers", "getPeer"]) {
  assert(peerRoutes.includes(token), `Peer routes must use ${token}.`);
}

for (const route of ['"/v1/sessions"', '"/v1/sessions/:id"', '"/v1/sessions/:id/messages"']) {
  assert(sessionRoutes.includes(route), `Session routes must include ${route}.`);
}
for (const token of ["sessionRepository", "createSession", "appendMessage", "listMessages", "jobDispatcher", "session.summarize", "memory.derive"]) {
  assert(sessionRoutes.includes(token), `Session routes must use ${token}.`);
}

for (const route of ['"/v1/documents"', '"/v1/documents/:id"', '"/v1/documents/:id/status"', '"/v1/documents/:id/processing-runs"', '"/v1/documents/:id/recompute"', '"/v1/documents/search"']) {
  assert(documentRoutes.includes(route), `Document routes must include ${route}.`);
}
for (const token of ["documentRepository", "chunkSearchRepository", "artifactRepository", "recomputeService", "listDocuments", "searchDocumentChunks", "listProcessingRuns", "requestRecompute"]) {
  assert(documentRoutes.includes(token), `Document routes must use ${token}.`);
}

assert(artifactRoutes.includes('"/v1/artifacts/search"'), "Artifact routes must include POST /v1/artifacts/search.");
for (const token of ["artifactRepository", "searchArtifacts", "metadataFilters", "artifactTypes", "spanTypes", "\"document:search\""]) {
  assert(artifactRoutes.includes(token), `Artifact routes must use ${token}.`);
}

for (const route of ['"/v1/faces/identities"', '"/v1/faces/identities/:id"', '"/v1/faces/observations"', '"/v1/faces/identities/:id/merge"']) {
  assert(faceRoutes.includes(route), `Face routes must include ${route}.`);
}
for (const token of ["FaceService", "listIdentities", "listObservations", "renameIdentity", "mergeIdentities", "\"face:read\"", "\"face:write\""]) {
  assert(faceRoutes.includes(token), `Face routes must use ${token}.`);
}

assert(memoryRoutes.includes("MemoryService"), "Memory routes must remain wired through MemoryService dependency.");
assert(contextRoutes.includes("ContextBuilder"), "Context route must remain wired through ContextBuilder dependency.");
for (const route of ['"/v1/jobs/:id"', '"/v1/jobs"', '"/v1/jobs/:id/retry"']) {
  assert(jobRoutes.includes(route), `Job routes must include ${route}.`);
}
for (const token of ["jobStore", "jobDispatcher", "getJob", "listJobs", "retry"]) {
  assert(jobRoutes.includes(token) || runtime.includes(token), `Job API runtime must include ${token}.`);
}
assert(runtime.includes("uploadService"), "API runtime must inject DocumentUploadService into document routes.");
assert(runtime.includes("recomputeService"), "API runtime must inject DocumentRecomputeService into document routes.");
assert(runtime.includes("artifacts:") && runtime.includes("artifactRepository"), "API runtime must inject artifact repository into artifact routes.");
assert(runtime.includes("faceService"), "API runtime must inject FaceService into face routes.");
assert(runtime.includes("buildDocumentChunkSearchRepository"), "API runtime must choose text or pgvector document chunk search.");
assert(runtime.includes("buildEmbeddingsProvider"), "API runtime must build query embeddings when semantic search is configured.");
assert(runtime.includes("queue.close()"), "API runtime close hook must close the processing queue.");
assert(runtime.includes("database.close()"), "API runtime close hook must close the database pool.");
assert(runtime.includes("auth:") && runtime.includes("accessTokenRepository"), "API runtime must wire access token repository.");
assert(runtime.includes("tokens:") && runtime.includes("accessTokenRepository"), "API runtime must wire token operation routes.");
assert(projectRoutes.includes("requireProjectPermission"), "Project routes must enforce project authorization.");
assert(tokenRoutes.includes("requireProjectPermission"), "Token routes must enforce project authorization.");
assert(peerRoutes.includes("requireProjectPermission"), "Peer routes must enforce project authorization.");
assert(sessionRoutes.includes("requireProjectPermission"), "Session routes must enforce session/message authorization.");
assert(documentRoutes.includes("requireProjectPermission"), "Document routes must enforce document authorization.");
assert(artifactRoutes.includes("requireProjectPermissionForEach"), "Artifact routes must enforce artifact search authorization.");
assert(faceRoutes.includes("requireProjectPermission"), "Face routes must enforce face authorization.");
assert(jobRoutes.includes("requireProjectPermission"), "Job routes must enforce project authorization.");
assert(memoryRoutes.includes("requireProjectPermission"), "Memory routes must enforce memory authorization.");
assert(contextRoutes.includes("requireProjectPermissionForEach"), "Context route must enforce context authorization.");
assert(!runtime.includes("BullMqProcessingJobWorker"), "API runtime must not wire worker processors before TASK-19.");

console.log("API runtime repository wiring validated.");
