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
const modelRuntimePackage = readJson("packages/model-runtime/package.json");
const apiPackage = readJson("apps/api/package.json");
const workerPackage = readJson("apps/worker/package.json");
const rootTsconfig = read("tsconfig.json");
const workspaceValidator = read("scripts/validate-workspace.js");
const modelRuntime = read("packages/model-runtime/src/index.ts");
const config = read("packages/config/src/index.ts");
const configCatalog = read("packages/config/src/catalog.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");
const apiRuntime = read("apps/api/src/runtime.ts");
const workerPipeline = read("apps/worker/src/document-pipeline.ts");
const workerRuntime = read("apps/worker/src/runtime.ts");
const integration = read("scripts/test-integration.js");
const docs = [
  read("docs/CONFIGURATION.md"),
  read("docs/DOCUMENT_PIPELINE.md"),
  read("docs/MODEL_RUNTIME.md")
].join("\n");

assert(rootPackage.scripts?.["model-runtime:validate"] === "node scripts/validate-model-runtime.js", "Root package must expose model-runtime:validate.");
assert(!rootPackage.scripts?.["llm:validate"], "Root package must not expose the old llm:validate script.");
assert(modelRuntimePackage.name === "@mindory/model-runtime", "packages/model-runtime must define @mindory/model-runtime.");
assert(modelRuntimePackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/model-runtime must depend on @mindory/config.");
assert(modelRuntimePackage.dependencies?.["@mindory/core"] === "workspace:*", "@mindory/model-runtime must depend on @mindory/core.");
assertIncludes(rootTsconfig, "\"packages/model-runtime\"", "tsconfig.json");
assertNotIncludes(rootTsconfig, "\"packages/llm\"", "tsconfig.json");
assertIncludes(workspaceValidator, "[\"packages/model-runtime\", \"@mindory/model-runtime\"]", "scripts/validate-workspace.js");
assertNotIncludes(workspaceValidator, "[\"packages/llm\", \"@mindory/llm\"]", "scripts/validate-workspace.js");

for (const token of [
  "buildMindoryModelRuntime",
  "buildMindoryTextEmbeddingsProvider",
  "ModelCapabilityRegistry",
  "ModelCapabilityDescriptor",
  "ModelRuntimeProviderDescriptor",
  "openAiCompatibleBearerToken",
  "oauth-bearer",
  "text-embedding",
  "image-embedding",
  "image-captioning",
  "ocr",
  "asr",
  "face-detection",
  "face-recognition",
  "OpenAICompatibleEmbeddingsProvider",
  "OllamaEmbeddingsProvider"
]) {
  assertIncludes(modelRuntime, token, "packages/model-runtime/src/index.ts");
}

for (const token of [
  "readModelEmbeddingCapabilityConfig(env, \"TEXT_EMBEDDING\")",
  "readModelEmbeddingCapabilityConfig(env, \"IMAGE_EMBEDDING\"",
  "readModelCapabilityConfig(env, \"IMAGE_CAPTIONING\")",
  "readModelCapabilityConfig(env, \"OCR\"",
  "readModelCapabilityConfig(env, \"ASR\")",
  "readModelCapabilityConfig(env, \"FACE_DETECTION\"",
  "readModelCapabilityConfig(env, \"FACE_RECOGNITION\"",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL",
  "MINDORY_MODEL_RUNTIME_LOCAL_BASE_URL"
]) {
  assertIncludes(config, token, "packages/config/src/index.ts");
}

for (const token of [
  "CLIP ViT-L-16-SigLIP2-256__webli",
  "ESLAV__PP-OCRv5_mobile",
  "buffalo_l",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL",
  "MINDORY_MODEL_RUNTIME_LOCAL_BASE_URL"
]) {
  assertIncludes(configCatalog, token, "packages/config/src/catalog.ts");
}

assertIncludes(compose, "profiles: [\"local-models\"]", "docker-compose.yml");
assertIncludes(compose, "model-runtime", "docker-compose.yml");
assertIncludes(envExample, "MINDORY_E2E_MODEL_PROFILE=disabled", ".env.example");
assertIncludes(docs, "local-models", "model runtime docs");

for (const token of [
  "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED",
  "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_PROVIDER",
  "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_MODEL",
  "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS",
  "MINDORY_MODEL_RUNTIME_IMAGE_EMBEDDING_MODEL",
  "CLIP ViT-L-16-SigLIP2-256__webli",
  "MINDORY_MODEL_RUNTIME_OCR_MODEL",
  "ESLAV__PP-OCRv5_mobile",
  "MINDORY_MODEL_RUNTIME_FACE_DETECTION_MODEL",
  "buffalo_l",
  "MINDORY_MODEL_RUNTIME_FACE_RECOGNITION_MODEL",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL",
  "MINDORY_MODEL_RUNTIME_LOCAL_BASE_URL"
]) {
  assertIncludes(envExample, token, ".env.example");
  assertIncludes(compose, token, "docker-compose.yml");
  assertIncludes(docs, token, "model runtime docs");
}

assert(apiPackage.dependencies?.["@mindory/model-runtime"] === "workspace:*", "@mindory/api must depend on @mindory/model-runtime.");
assert(workerPackage.dependencies?.["@mindory/model-runtime"] === "workspace:*", "@mindory/worker must depend on @mindory/model-runtime.");
assert(!apiPackage.dependencies?.["@mindory/llm"], "@mindory/api must not depend on @mindory/llm.");
assert(!workerPackage.dependencies?.["@mindory/llm"], "@mindory/worker must not depend on @mindory/llm.");
assert(!apiPackage.dependencies?.["@mindory/embeddings-openai-compatible"], "@mindory/api must not depend on provider packages directly.");
assert(!workerPackage.dependencies?.["@mindory/embeddings-openai-compatible"], "@mindory/worker must not depend on provider packages directly.");

for (const source of [apiRuntime, workerPipeline]) {
  assertIncludes(source, "@mindory/model-runtime", "API/worker runtime source");
  assertNotIncludes(source, "@mindory/llm", "API/worker runtime source");
  assertNotIncludes(source, "@mindory/embeddings-openai-compatible", "API/worker runtime source");
  assertNotIncludes(source, "@mindory/embeddings-ollama", "API/worker runtime source");
}

assertIncludes(apiRuntime, "config.modelRuntime.textEmbedding.dimensions", "apps/api/src/runtime.ts");
assertIncludes(workerRuntime, "config.modelRuntime.textEmbedding.dimensions", "apps/worker/src/runtime.ts");
assertIncludes(integration, "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED", "scripts/test-integration.js");
assertNotIncludes(integration, "MINDORY_LLM_", "scripts/test-integration.js");
assertNotIncludes(config, "MINDORY_LLM_", "packages/config/src/index.ts");

console.log("Model runtime adapter validated.");
