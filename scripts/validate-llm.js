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
  read("docs/LLM.md")
].join("\n");

assert(rootPackage.scripts?.["llm:validate"] === "node scripts/validate-llm.js", "Root package must expose llm:validate.");
assert(rootPackage.scripts?.["model-runtime:validate"] === undefined, "Root package must not expose model-runtime:validate.");
assert(llmPackage.name === "@mindory/llm", "packages/llm must define @mindory/llm.");
assert(llmPackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/llm must depend on @mindory/config.");
assert(llmPackage.dependencies?.["@mindory/core"] === "workspace:*", "@mindory/llm must depend on @mindory/core.");
assertIncludes(rootTsconfig, "\"packages/llm\"", "tsconfig.json");
assertNotIncludes(rootTsconfig, "\"packages/model-runtime\"", "tsconfig.json");
assertIncludes(workspaceValidator, "[\"packages/llm\", \"@mindory/llm\"]", "scripts/validate-workspace.js");
assertNotIncludes(workspaceValidator, "[\"packages/model-runtime\", \"@mindory/model-runtime\"]", "scripts/validate-workspace.js");

for (const token of [
  "buildMindoryLlm",
  "buildMindoryTextEmbeddingsProvider",
  "llmRoleState",
  "LlmRoleRegistry",
  "LlmRoleDescriptor",
  "LlmProviderDescriptor",
  "LlmOperationResult",
  "LlmOperationAudit",
  "disabledLlmOperationResult",
  "LlmChatProvider",
  "LlmTextEmbeddingProvider",
  "LlmOcrProvider",
  "LlmAsrProvider",
  "LlmVisionProvider",
  "LlmFaceProvider",
  "LlmGenerationProvider",
  "openAiCompatibleBearerToken",
  "oauth-bearer",
  "local-http",
  "local-command",
  "chat",
  "text-embedding",
  "image-embedding",
  "vision-captioning",
  "ocr",
  "asr",
  "face-detection",
  "face-recognition",
  "image-generation",
  "audio-generation",
  "OpenAICompatibleEmbeddingsProvider",
  "OllamaEmbeddingsProvider"
]) {
  assertIncludes(llm, token, "packages/llm/src/index.ts");
}

for (const token of [
  "readLlmCapabilityConfig(env, \"CHAT\")",
  "readLlmEmbeddingCapabilityConfig(env, \"TEXT_EMBEDDING\")",
  "readLlmEmbeddingCapabilityConfig(env, \"IMAGE_EMBEDDING\"",
  "readLlmCapabilityConfig(env, \"VISION_CAPTIONING\")",
  "readLlmCapabilityConfig(env, \"OCR\"",
  "readLlmCapabilityConfig(env, \"ASR\")",
  "readLlmCapabilityConfig(env, \"FACE_DETECTION\"",
  "readLlmCapabilityConfig(env, \"FACE_RECOGNITION\"",
  "readLlmCapabilityConfig(env, \"IMAGE_GENERATION\")",
  "readLlmCapabilityConfig(env, \"AUDIO_GENERATION\")",
  "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_LLM_OLLAMA_BASE_URL",
  "MINDORY_LLM_LOCAL_HTTP_BASE_URL",
  "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS"
]) {
  assertIncludes(config, token, "packages/config/src/index.ts");
}

for (const token of [
  "llmRoleEntries(\"CHAT\"",
  "llmRoleEntries(\"TEXT_EMBEDDING\"",
  "llmRoleEntries(\"VISION_CAPTIONING\"",
  "llmRoleEntries(\"IMAGE_GENERATION\"",
  "llmRoleEntries(\"AUDIO_GENERATION\"",
  "CLIP ViT-L-16-SigLIP2-256__webli",
  "ESLAV__PP-OCRv5_mobile",
  "buffalo_l",
  "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_LLM_OLLAMA_BASE_URL",
  "MINDORY_LLM_LOCAL_HTTP_BASE_URL",
  "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS"
]) {
  assertIncludes(configCatalog, token, "packages/config/src/catalog.ts");
}

for (const token of [
  "MINDORY_LLM_CHAT_ENABLED",
  "MINDORY_LLM_TEXT_EMBEDDING_ENABLED",
  "MINDORY_LLM_VISION_CAPTIONING_ENABLED",
  "MINDORY_LLM_IMAGE_GENERATION_ENABLED",
  "MINDORY_LLM_AUDIO_GENERATION_ENABLED",
  "MINDORY_LLM_TEXT_EMBEDDING_TIMEOUT_MS",
  "MINDORY_LLM_TEXT_EMBEDDING_CONCURRENCY",
  "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_LLM_OLLAMA_BASE_URL",
  "MINDORY_LLM_LOCAL_HTTP_BASE_URL",
  "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS"
]) {
  assertIncludes(envExample, token, ".env.example");
  assertIncludes(compose, token, "docker-compose.yml");
}

assertIncludes(compose, "profiles: [\"local-models\"]", "docker-compose.yml");
assertIncludes(compose, "service:'llm'", "docker-compose.yml");
assertIncludes(envExample, "MINDORY_E2E_MODEL_PROFILE=disabled", ".env.example");
assertIncludes(docs, "local-models", "LLM SDK docs");

for (const token of [
  "@mindory/llm",
  "MINDORY_LLM_TEXT_EMBEDDING_ENABLED",
  "MINDORY_LLM_TEXT_EMBEDDING_PROVIDER",
  "MINDORY_LLM_TEXT_EMBEDDING_MODEL",
  "MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS",
  "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN"
]) {
  assertIncludes(docs, token, "LLM SDK docs");
}

assert(apiPackage.dependencies?.["@mindory/llm"] === "workspace:*", "@mindory/api must depend on @mindory/llm.");
assert(workerPackage.dependencies?.["@mindory/llm"] === "workspace:*", "@mindory/worker must depend on @mindory/llm.");
assert(!apiPackage.dependencies?.["@mindory/model-runtime"], "@mindory/api must not depend on @mindory/model-runtime.");
assert(!workerPackage.dependencies?.["@mindory/model-runtime"], "@mindory/worker must not depend on @mindory/model-runtime.");
assert(!apiPackage.dependencies?.["@mindory/embeddings-openai-compatible"], "@mindory/api must not depend on provider packages directly.");
assert(!workerPackage.dependencies?.["@mindory/embeddings-openai-compatible"], "@mindory/worker must not depend on provider packages directly.");

for (const source of [apiRuntime, workerPipeline]) {
  assertIncludes(source, "@mindory/llm", "API/worker runtime source");
  assertNotIncludes(source, "@mindory/model-runtime", "API/worker runtime source");
  assertNotIncludes(source, "@mindory/embeddings-openai-compatible", "API/worker runtime source");
  assertNotIncludes(source, "@mindory/embeddings-ollama", "API/worker runtime source");
}

assertIncludes(apiRuntime, "config.llm.textEmbedding.dimensions", "apps/api/src/runtime.ts");
assertIncludes(workerRuntime, "config.llm.textEmbedding.dimensions", "apps/worker/src/runtime.ts");
assertIncludes(integration, "MINDORY_LLM_TEXT_EMBEDDING_ENABLED", "scripts/test-integration.js");
assertIncludes(workerPipeline, "llmRoleState(llm, \"asr\")", "apps/worker/src/document-pipeline.ts");
assertIncludes(workerPipeline, "llmRoleState(llm, \"ocr\")", "apps/worker/src/document-pipeline.ts");
assertIncludes(workerPipeline, "llmRoleState(llm, \"vision-captioning\")", "apps/worker/src/document-pipeline.ts");
assertIncludes(workerPipeline, "llmRoleState(llm, \"face-detection\")", "apps/worker/src/document-pipeline.ts");
assertIncludes(workerPipeline, "llmRoleState(llm, \"face-recognition\")", "apps/worker/src/document-pipeline.ts");
for (const token of [
  "options.config.llm.asr",
  "options.config.llm.ocr",
  "options.config.llm.faceDetection",
  "options.config.llm.faceRecognition",
  "options.config.llm.visionCaptioning",
  "options.config.llm.imageEmbedding"
]) {
  assertNotIncludes(workerPipeline, token, "worker document pipeline must use @mindory/llm role snapshots.");
}
for (const violation of directProviderImportsOutsideLlm()) {
  throw new Error(`${violation}: provider packages must only be imported by packages/llm.`);
}

for (const [label, content] of [
  ["package/config/runtime/docs", [
    read("package.json"),
    read("tsconfig.json"),
    read("docker-compose.yml"),
    read(".env.example"),
    read("README.md"),
    read("docs/CONFIGURATION.md"),
    read("docs/DOCUMENT_PIPELINE.md"),
    read("docs/LLM.md"),
    read("docs/PRD.md"),
    read("apps/api/package.json"),
    read("apps/worker/package.json"),
    read("apps/api/src/runtime.ts"),
    read("apps/worker/src/document-pipeline.ts"),
    read("scripts/test-integration.js")
  ].join("\n")]
]) {
  assertNotIncludes(content, "@mindory/model-runtime", label);
  assertNotIncludes(content, "packages/model-runtime", label);
  assertNotIncludes(content, "MINDORY_MODEL_RUNTIME", label);
}

console.log("LLM SDK adapter validated.");

function directProviderImportsOutsideLlm() {
  const violations = [];
  for (const filePath of walk(path.join(root, "apps")).concat(walk(path.join(root, "packages")))) {
    const relativePath = path.relative(root, filePath);
    if (relativePath.startsWith("packages/llm/") || relativePath.startsWith("packages/processors/embeddings/")) {
      continue;
    }
    const content = fs.readFileSync(filePath, "utf8");
    if (content.includes("@mindory/embeddings-openai-compatible") || content.includes("@mindory/embeddings-ollama")) {
      violations.push(relativePath);
    }
  }
  return violations;
}

function walk(directory) {
  const files = [];
  if (!fs.existsSync(directory)) {
    return files;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["dist", "lib", "node_modules"].includes(entry.name)) {
        files.push(...walk(absolutePath));
      }
      continue;
    }
    if (entry.isFile() && /\.(ts|js|json)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}
