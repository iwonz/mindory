import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "packages/core/src/projects.ts",
  "packages/core/src/sessions.ts",
  "packages/db/src/repositories/documents.ts",
  "packages/db/src/repositories/index.ts",
  "packages/db/src/repositories/jobs.ts",
  "packages/db/src/repositories/memory.ts",
  "packages/db/src/repositories/projects.ts",
  "packages/db/src/repositories/sessions.ts",
  "packages/db/src/repositories/types.ts"
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
const corePackage = readJson("packages/core/package.json");
const dbPackage = readJson("packages/db/package.json");
const dbTsconfig = readJson("packages/db/tsconfig.json");
const coreIndex = read("packages/core/src/index.ts");
const dbIndex = read("packages/db/src/index.ts");
const projectsCore = read("packages/core/src/projects.ts");
const sessionsCore = read("packages/core/src/sessions.ts");
const processingCore = read("packages/core/src/processing.ts");
const repoIndex = read("packages/db/src/repositories/index.ts");
const repoTypes = read("packages/db/src/repositories/types.ts");
const projectRepos = read("packages/db/src/repositories/projects.ts");
const sessionRepos = read("packages/db/src/repositories/sessions.ts");
const documentRepos = read("packages/db/src/repositories/documents.ts");
const memoryRepos = read("packages/db/src/repositories/memory.ts");
const jobRepos = read("packages/db/src/repositories/jobs.ts");
const apiFiles = [
  "apps/api/src/routes/projects.ts",
  "apps/api/src/routes/documents.ts",
  "apps/api/src/routes/memories.ts",
  "apps/api/src/routes/context.ts"
].map(read).join("\n");

assert(rootPackage.scripts?.["db:repositories:validate"] === "node scripts/validate-db-repositories.js", "Root package must expose db:repositories:validate.");
assert(corePackage.exports?.["./projects"], "@mindory/core must export ./projects.");
assert(corePackage.exports?.["./sessions"], "@mindory/core must export ./sessions.");
assert(coreIndex.includes('export * from "./projects.js";'), "@mindory/core index must export project contracts.");
assert(coreIndex.includes('export * from "./sessions.js";'), "@mindory/core index must export session contracts.");
assert(dbPackage.exports?.["./repositories"], "@mindory/db must export ./repositories.");
assert(dbPackage.dependencies?.["@mindory/core"] === "workspace:*", "@mindory/db must depend on @mindory/core.");
assert(dbTsconfig.references?.some((reference) => reference.path === "../core"), "@mindory/db must reference @mindory/core.");
assert(dbIndex.includes('export * from "./repositories/index.js";'), "@mindory/db root index must export repositories.");

for (const symbol of ["ProjectRecord", "ProjectRepository", "PeerRecord", "PeerRepository", "ProjectError"]) {
  assert(projectsCore.includes(symbol), `Core project contracts must include ${symbol}.`);
}

for (const symbol of ["SessionRecord", "MessageRecord", "SessionRepository", "ContextSessionRepository", "UpdateSessionSummaryInput", "SessionError"]) {
  assert(sessionsCore.includes(symbol), `Core session contracts must include ${symbol}.`);
}

assert(repoTypes.includes("NodePgDatabase"), "Repository types must define a Drizzle NodePg database type.");
assert(repoTypes.includes("DbRepositoryError"), "Repository types must define DbRepositoryError.");

for (const exportName of ["documents", "jobs", "memory", "projects", "sessions", "types"]) {
  assert(repoIndex.includes(`./${exportName}.js`), `Repository index must export ${exportName}.`);
}

for (const symbol of ["DbProjectRepository", "DbPeerRepository", "createProject", "upsertPeer", "listProjects", "listPeers"]) {
  assert(projectRepos.includes(symbol), `Project repositories must include ${symbol}.`);
}

for (const symbol of ["DbSessionRepository", "createSession", "appendMessage", "listMessages", "updateSessionSummary", "getSessionSummary", "listRecentMessages"]) {
  assert(sessionRepos.includes(symbol), `Session repositories must include ${symbol}.`);
}
assert(sessionRepos.includes("if (input.summary !== undefined)"), "Session upsert must preserve existing summary when summary is omitted.");

for (const symbol of ["DocumentChunkRepository", "replaceDocumentChunks", "updateChunkEmbeddingIds"]) {
  assert(processingCore.includes(symbol), `Core processing contracts must include ${symbol}.`);
}

for (const symbol of ["DbDocumentRepository", "DbDocumentChunkSearchRepository", "DbDocumentChunkRepository", "createDocument", "updateDocumentStatus", "searchDocumentChunks", "replaceDocumentChunks"]) {
  assert(documentRepos.includes(symbol), `Document repositories must include ${symbol}.`);
}

for (const symbol of ["DbMemoryRepository", "createMemoryClaim", "searchMemoryClaims", "updateMemoryClaimStatus", "ilike"]) {
  assert(memoryRepos.includes(symbol), `Memory repositories must include ${symbol}.`);
}

for (const symbol of ["DbProcessingJobStore", "createPendingJob", "markJobRunning", "markJobSucceeded", "markJobFailed", "idempotencyKey"]) {
  assert(jobRepos.includes(symbol), `Processing job store must include ${symbol}.`);
}

assert(!apiFiles.includes("@mindory/db"), "TASK-14 must not wire API routes directly to @mindory/db.");
assert(apiFiles.includes("notImplemented"), "API routes should remain explicit placeholders until runtime wiring task.");

console.log("Database repository skeleton validated.");
