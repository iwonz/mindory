import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function assertIncludes(content, token, label) {
  assert(content.includes(token), `${label} must include ${token}.`);
}

function assertNotIncludes(content, token, label) {
  assert(!content.includes(token), `${label} must not include ${token}.`);
}

const rootPackage = readJson("package.json");
const llmPackage = readJson("packages/llm/package.json");
const apiPackage = readJson("apps/api/package.json");
const workerPackage = readJson("apps/worker/package.json");
const rootTsconfig = read("tsconfig.json");
const workspaceValidator = read("scripts/validate-workspace.js");
const llm = read("packages/llm/src/index.ts");
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");
const apiRuntime = read("apps/api/src/runtime.ts");
const workerPipeline = read("apps/worker/src/document-pipeline.ts");
const workerRuntime = read("apps/worker/src/runtime.ts");
const integration = read("scripts/test-integration.js");
const docs = [
  read("docs/CONFIGURATION.md"),
  read("docs/DOCUMENT_PIPELINE.md"),
  read("docs/LLM_ADAPTER.md")
].join("\n");

assert(rootPackage.scripts?.["llm:validate"] === "node scripts/validate-llm-adapter.js", "Root package must expose llm:validate.");
assert(llmPackage.name === "@mindory/llm", "packages/llm must define @mindory/llm.");
assert(llmPackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/llm must depend on @mindory/config.");
assert(llmPackage.dependencies?.["@mindory/core"] === "workspace:*", "@mindory/llm must depend on @mindory/core.");
assertIncludes(rootTsconfig, "\"packages/llm\"", "tsconfig.json");
assertIncludes(workspaceValidator, "[\"packages/llm\", \"@mindory/llm\"]", "scripts/validate-workspace.js");

for (const token of [
  "buildMindoryLlmRuntime",
  "buildMindoryEmbeddingsProvider",
  "openAiCompatibleBearerToken",
  "oauth-bearer",
  "OpenAICompatibleEmbeddingsProvider",
  "OllamaEmbeddingsProvider"
]) {
  assertIncludes(llm, token, "packages/llm/src/index.ts");
}

for (const token of [
  "MINDORY_LLM_PROVIDER",
  "MINDORY_LLM_EMBEDDING_MODEL",
  "MINDORY_LLM_CHAT_MODEL",
  "MINDORY_LLM_EMBEDDING_DIMENSIONS",
  "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_LLM_OLLAMA_BASE_URL"
]) {
  assertIncludes(config, token, "packages/config/src/index.ts");
  assertIncludes(envExample, token, ".env.example");
  assertIncludes(compose, token, "docker-compose.yml");
  assertIncludes(docs, token, "LLM docs");
}

assert(apiPackage.dependencies?.["@mindory/llm"] === "workspace:*", "@mindory/api must depend on @mindory/llm.");
assert(workerPackage.dependencies?.["@mindory/llm"] === "workspace:*", "@mindory/worker must depend on @mindory/llm.");
assert(!apiPackage.dependencies?.["@mindory/embeddings-openai-compatible"], "@mindory/api must not depend on provider packages directly.");
assert(!workerPackage.dependencies?.["@mindory/embeddings-openai-compatible"], "@mindory/worker must not depend on provider packages directly.");

for (const source of [apiRuntime, workerPipeline]) {
  assertIncludes(source, "@mindory/llm", "API/worker runtime source");
  assertNotIncludes(source, "@mindory/embeddings-openai-compatible", "API/worker runtime source");
  assertNotIncludes(source, "@mindory/embeddings-ollama", "API/worker runtime source");
}

assertIncludes(apiRuntime, "config.llm.embeddingDimensions", "apps/api/src/runtime.ts");
assertIncludes(workerRuntime, "config.llm.embeddingDimensions", "apps/worker/src/runtime.ts");

console.log("Unified LLM adapter validated.");
