import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "packages/core/src/memory.ts",
  "packages/core/src/sessions.ts",
  "packages/db/src/repositories/sessions.ts",
  "apps/api/src/routes/memories.ts",
  "apps/api/src/routes/context.ts",
  "apps/api/src/routes/sessions.ts",
  "apps/worker/src/memory-pipeline.ts",
  "apps/worker/src/runtime.ts"
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
const apiPackage = readJson("apps/api/package.json");
const coreIndex = read("packages/core/src/index.ts");
const memory = read("packages/core/src/memory.ts");
const sessions = read("packages/core/src/sessions.ts");
const dbSessions = read("packages/db/src/repositories/sessions.ts");
const app = read("apps/api/src/app.ts");
const memoryRoutes = read("apps/api/src/routes/memories.ts");
const contextRoutes = read("apps/api/src/routes/context.ts");
const sessionRoutes = read("apps/api/src/routes/sessions.ts");
const memoryPipeline = read("apps/worker/src/memory-pipeline.ts");
const workerRuntime = read("apps/worker/src/runtime.ts");

assert(rootPackage.scripts?.["memory:validate"] === "node scripts/validate-memory-context.js", "Root package must expose memory:validate.");
assert(corePackage.exports?.["./memory"], "@mindory/core must export ./memory.");
assert(coreIndex.includes('export * from "./memory.js";'), "@mindory/core root index must export memory contracts.");
assert(apiPackage.dependencies?.["@mindory/core"] === "workspace:*", "@mindory/api must depend on @mindory/core.");

for (const symbol of [
  "SourceRef",
  "MemoryClaimRecord",
  "MemoryRepository",
  "MemoryService",
  "RememberMemoryInput",
  "SearchMemoryClaimsInput",
  "MemoryExplanation",
  "ContextBuilder",
  "BuildContextInput",
  "ContextBlock",
  "ContextSessionRepository",
  "DocumentChunkSearchRepository",
  "DerivedMemoryCandidate",
  "ConservativeMemoryDeriver",
  "DeriveMemoryCandidatesInput",
  "defaultContextTokenCounter",
  "MemoryError"
]) {
  assert(memory.includes(symbol), `@mindory/core memory module must define ${symbol}.`);
}

for (const token of [
  "\"semantic\"",
  "\"episodic\"",
  "\"preference\"",
  "\"decision\"",
  "\"task\"",
  "\"artifact_reference\"",
  "\"derived\"",
  "\"candidate\"",
  "\"active\"",
  "\"rejected\"",
  "\"archived\"",
  "\"session\"",
  "\"message\"",
  "\"document\"",
  "\"chunk\"",
  "\"memory\""
]) {
  assert(memory.includes(token), `Memory module must include ${token}.`);
}

assert(memory.includes("validateSourceRefs(input.sourceRefs)"), "Manual remember must require source references.");
assert(memory.includes("status: input.status ?? \"active\""), "Manual remember must default to active memories.");
assert(memory.includes("statuses: input.statuses ?? [\"active\"]"), "Memory search must default to active memories.");
assert(memory.includes("explicit-memory-cues-v1"), "Core memory module must include the conservative derivation strategy.");
assert(memory.includes("message.messageId"), "Conservative derivation must source candidate claims from messages.");
assert(memory.includes("appendWithinBudget"), "ContextBuilder must enforce token budget.");
assert(memory.includes("session_summary"), "ContextBuilder must support session summaries.");
assert(memory.includes("recent_message"), "ContextBuilder must support recent messages.");
assert(memory.includes("document_chunk"), "ContextBuilder must support document chunks.");
assert(!memory.includes("drizzle-orm"), "TASK-10 core memory module must not implement concrete Drizzle repositories.");
assert(sessions.includes("UpdateSessionSummaryInput"), "Session contracts must define summary update input.");
assert(sessions.includes("updateSessionSummary"), "Session repository contract must support summary updates.");
assert(dbSessions.includes("updateSessionSummary"), "DbSessionRepository must persist summary updates.");

assert(app.includes("registerMemoryRoutes"), "API app must register memory routes.");
assert(app.includes("registerContextRoutes"), "API app must register context routes.");
assert(app.includes("memories?: MemoryRouteDependencies"), "API app options must accept memory dependencies.");
assert(app.includes("context?: ContextRouteDependencies"), "API app options must accept context dependencies.");

for (const route of [
  "\"/v1/memories\"",
  "\"/v1/memories/:id\"",
  "\"/v1/memories/search\"",
  "\"/v1/memories/:id/explain\""
]) {
  assert(memoryRoutes.includes(route), `Memory routes must include ${route}.`);
}
assert(memoryRoutes.includes("app.delete"), "Memory routes must include DELETE /v1/memories/:id.");
assert(memoryRoutes.includes("MemoryService"), "Memory routes must accept MemoryService dependency.");
assert(memoryRoutes.includes("notImplemented"), "Memory routes must return explicit placeholder behavior when dependency is missing.");
assert(memoryRoutes.includes("sourceRefs"), "Memory remember route must accept sourceRefs.");

assert(contextRoutes.includes("\"/v1/context/build\""), "Context routes must include POST /v1/context/build.");
assert(contextRoutes.includes("ContextBuilder"), "Context route must accept ContextBuilder dependency.");
assert(contextRoutes.includes("projectIds"), "Context build route must accept projectIds.");
assert(contextRoutes.includes("tokenBudget"), "Context build route must accept tokenBudget.");
assert(contextRoutes.includes("notImplemented"), "Context route must return explicit placeholder behavior when dependency is missing.");

for (const token of ["jobDispatcher", "session.summarize", "memory.derive", "processing_jobs"]) {
  assert(sessionRoutes.includes(token), `Session routes must enqueue memory/context runtime jobs with ${token}.`);
}

for (const token of [
  "buildMemoryRuntimeProcessors",
  "SessionSummaryProcessor",
  "MemoryDerivationProcessor",
  "session.summarize",
  "memory.derive",
  "status: \"candidate\"",
  "sourceRefs",
  "ConservativeMemoryDeriver",
  "updateSessionSummary"
]) {
  assert(memoryPipeline.includes(token), `Worker memory pipeline must include ${token}.`);
}
assert(!memoryPipeline.includes("status: \"active\""), "Automatic derivation must not create active memory claims.");
assert(workerRuntime.includes("buildMemoryRuntimeProcessors"), "Worker runtime must register memory/context processors.");
assert(workerRuntime.includes("DbMemoryRepository"), "Worker runtime must wire memory repository.");
assert(workerRuntime.includes("DbSessionRepository"), "Worker runtime must wire session repository.");

console.log("Memory and context runtime validated.");
