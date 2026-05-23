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

assert(rootPackage.scripts?.["llm:validate"] === "pnpm --filter @mindory/llm typecheck && node scripts/validate-llm.js", "Root package must expose llm:validate.");
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
  "LlmRoleSupportDescriptor",
  "LLM_ROLE_PROVIDER_SUPPORT_MATRIX",
  "llmRoleSupportStatus",
  "llmRoleProviderSupportStatus",
  "LlmOperationResult",
  "LlmOperationAudit",
  "LlmAuditSink",
  "LlmLocalCommandRunner",
  "localCommandProviderHealth",
  "LocalCommandTextEmbeddingsProvider",
  "LocalCommandImageEmbeddingsProvider",
  "LocalCommandGenerationProvider",
  "LocalHttpImageEmbeddingsProvider",
  "MindoryGenerationProvider",
  "OpenAICompatibleGenerationProvider",
  "LocalHttpGenerationProvider",
  "local_command_input_limit_exceeded",
  "local_command_output_limit_exceeded",
  "local_command_healthcheck_malformed_json",
  "local_command_healthcheck_timeout",
  "local_command_healthcheck_unsupported_role",
  "disabledLlmOperationResult",
  "AuditedTextEmbeddingsProvider",
  "auditSink?.(audit)",
  "status: \"success\"",
  "status: \"failed\"",
  "status: \"disabled\"",
  "LlmChatProvider",
  "OpenAICompatibleChatProvider",
  "LocalHttpChatProvider",
  "LocalHttpTextEmbeddingsProvider",
  "LocalHttpOcrProvider",
  "LocalHttpVisionProvider",
  "LocalHttpAsrProvider",
  "LocalHttpFaceProvider",
  "buildMindoryChatProvider",
  "buildMindoryOcrProvider",
  "buildMindoryVisionProvider",
  "buildMindoryAsrProvider",
  "buildMindoryFaceProvider",
  "checkMindoryLlmProviderHealth",
  "healthCheck",
  "/chat/completions",
  "/health",
  "/ocr",
  "/vision/caption",
  "/vision/objects",
  "/embeddings/images",
  "/asr",
  "/faces/detect",
  "/faces/recognize",
  "/images/generations",
  "/audio/speech",
  "/generation/image",
  "/generation/audio",
  "inputTokens",
  "outputTokens",
  "LlmTextEmbeddingProvider",
  "LlmImageEmbeddingProvider",
  "LlmOcrProvider",
  "LlmAsrProvider",
  "LlmAsrOutput",
  "LlmVisionProvider",
  "LlmObjectDetectionOutput",
  "LlmFaceProvider",
  "LlmFaceDetectionOutput",
  "LlmFaceRecognitionOutput",
  "LlmGenerationProvider",
  "LlmGeneratedMediaOutput",
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
  "OllamaEmbeddingsProvider",
  "Local HTTP embedding request failed"
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
  "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS",
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND",
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS",
  "MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND",
  "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS",
  "MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES",
  "MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES"
]) {
  assertIncludes(config, token, "packages/config/src/index.ts");
}

for (const token of [
  "LLM_ROLE_SUPPORT_CATALOG",
  "LLM_PROVIDER_VALUES",
  "llmRoleSupportStatus",
  "llmRoleProviderSupportStatus",
  "llmRoleEntries(\"CHAT\"",
  "llmRoleEntries(\"TEXT_EMBEDDING\"",
  "llmRoleEntries(\"IMAGE_EMBEDDING\"",
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
  "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS",
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND",
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS",
  "MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND",
  "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS",
  "MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES",
  "MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES"
]) {
  assertIncludes(configCatalog, token, "packages/config/src/catalog.ts");
}
assertIncludes(configCatalog, "llmRoleSupport(\"IMAGE_EMBEDDING\", \"supported\", \"local-http\"", "packages/config/src/catalog.ts");
assertIncludes(configCatalog, "llmRoleSupport(\"OCR\", \"supported\", \"local-http\"", "packages/config/src/catalog.ts");
assertIncludes(configCatalog, "llmRoleSupport(\"IMAGE_GENERATION\", \"supported\", \"disabled\", \"\", {\n    \"openai-compatible\": \"supported\"", "packages/config/src/catalog.ts");
assertIncludes(configCatalog, "llmRoleSupport(\"AUDIO_GENERATION\", \"supported\", \"disabled\", \"\", {\n    \"openai-compatible\": \"supported\"", "packages/config/src/catalog.ts");
assertIncludes(configCatalog, "\"local-http\": \"supported\",\n    \"local-command\": \"supported\"", "packages/config/src/catalog.ts");

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
  "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS",
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND",
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS",
  "MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND",
  "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS",
  "MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES",
  "MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES"
]) {
  assertIncludes(envExample, token, ".env.example");
  assertIncludes(compose, token, "docker-compose.yml");
}

assertIncludes(compose, "profiles: [\"local-models\"]", "docker-compose.yml");
assertIncludes(compose, "scripts/local-model-server.mjs", "docker-compose.yml");
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
assertIncludes(integration, "MINDORY_INSTALL_ALLOW_EXPERIMENTAL", "scripts/test-integration.js");
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

for (const token of [
  "Support Matrix",
  "`text-embedding` | supported",
  "`chat` | supported",
  "`image-generation` | supported",
  "`ocr` | supported",
  "/chat/completions",
  "`/embeddings`",
  "`/health`",
  "healthCheck"
]) {
  assertIncludes(docs, token, "LLM SDK docs");
}

const { buildMindoryLlm, checkMindoryLlmProviderHealth } = await import("../packages/llm/dist/index.js");
const { loadMindoryConfig } = await import("../packages/config/dist/index.js");
let futureProviderBlocked = false;
try {
  loadMindoryConfig({
    MINDORY_INSTALL_ALLOW_EXPERIMENTAL: "true",
    MINDORY_LLM_IMAGE_EMBEDDING_ENABLED: "true",
    MINDORY_LLM_IMAGE_EMBEDDING_PROVIDER: "openai-compatible",
    MINDORY_LLM_IMAGE_EMBEDDING_MODEL: "unsupported-image-embedding",
    MINDORY_LLM_IMAGE_EMBEDDING_DIMENSIONS: "1536"
  });
} catch (error) {
  futureProviderBlocked = String(error).includes("future for this role");
}
assert(futureProviderBlocked, "Config validation must block future LLM provider choices even when experimental mode is enabled.");
const chatAudits = [];
const chatRequests = [];
const chatConfig = loadMindoryConfig({
  MINDORY_LLM_CHAT_ENABLED: "true",
  MINDORY_LLM_CHAT_PROVIDER: "openai-compatible",
  MINDORY_LLM_CHAT_MODEL: "gpt-test",
  MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL: "https://llm.example/v1",
  MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE: "oauth-bearer",
  MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN: "oauth-test-token"
});
const chatRuntime = buildMindoryLlm(chatConfig, {
  auditSink: (audit) => chatAudits.push(audit),
  fetchImpl: async (url, init) => {
    chatRequests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      choices: [{ message: { content: "hello from chat" } }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7
      }
    }), { status: 200 });
  }
});
assert(chatRuntime.chat !== undefined, "OpenAI-compatible chat provider must be built when chat is enabled.");
const chatResult = await chatRuntime.chat.generateChat({
  messages: [{ role: "user", content: "hello" }]
}, {
  role: chatRuntime.registry.require("chat"),
  refs: { projectId: "project-test" }
});
assert(chatResult.status === "success", "OpenAI-compatible chat provider must return success.");
assert(chatResult.value?.text === "hello from chat", "OpenAI-compatible chat provider must return the first message content.");
assert(chatResult.audit.usage.inputTokens === 3, "OpenAI-compatible chat audit must include prompt token usage.");
assert(chatResult.audit.usage.outputTokens === 4, "OpenAI-compatible chat audit must include completion token usage.");
assert(chatRequests[0]?.url === "https://llm.example/v1/chat/completions", "OpenAI-compatible chat provider must call /chat/completions.");
assert(chatRequests[0]?.init?.headers?.authorization === "Bearer oauth-test-token", "OpenAI-compatible chat provider must use OAuth bearer auth.");
assert(chatAudits[0]?.status === "success", "OpenAI-compatible chat provider must emit success audit.");

const openAiGenerationAudits = [];
const openAiGenerationRequests = [];
const openAiGenerationConfig = loadMindoryConfig({
  MINDORY_LLM_IMAGE_GENERATION_ENABLED: "true",
  MINDORY_LLM_IMAGE_GENERATION_PROVIDER: "openai-compatible",
  MINDORY_LLM_IMAGE_GENERATION_MODEL: "gpt-image-test",
  MINDORY_LLM_AUDIO_GENERATION_ENABLED: "true",
  MINDORY_LLM_AUDIO_GENERATION_PROVIDER: "openai-compatible",
  MINDORY_LLM_AUDIO_GENERATION_MODEL: "gpt-audio-test",
  MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL: "https://llm.example/v1",
  MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE: "api-key",
  MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY: "api-key-test"
});
const openAiGenerationRuntime = buildMindoryLlm(openAiGenerationConfig, {
  auditSink: (audit) => openAiGenerationAudits.push(audit),
  fetchImpl: async (url, init) => {
    openAiGenerationRequests.push({ url: String(url), init });
    const href = String(url);
    if (href.endsWith("/images/generations")) {
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from("openai image").toString("base64"), revised_prompt: "revised image prompt" }],
        usage: { prompt_tokens: 3, total_tokens: 3 }
      }), { status: 200 });
    }
    if (href.endsWith("/audio/speech")) {
      return new Response(Buffer.from("openai audio"), {
        status: 200,
        headers: { "content-type": "audio/wav" }
      });
    }
    return new Response("not found", { status: 404 });
  }
});
assert(openAiGenerationRuntime.generation !== undefined, "OpenAI-compatible generation provider must be built.");
const openAiImageGeneration = await openAiGenerationRuntime.generation.generateImage({
  prompt: "draw"
}, {
  role: openAiGenerationRuntime.registry.require("image-generation")
});
assert(openAiImageGeneration.status === "success", "OpenAI-compatible image generation must return success.");
assert(openAiImageGeneration.value?.mimeType === "image/png", "OpenAI-compatible image generation must return image/png.");
assert(openAiImageGeneration.value?.metadata?.revisedPrompt === "revised image prompt", "OpenAI-compatible image generation must preserve response metadata.");
const openAiAudioGeneration = await openAiGenerationRuntime.generation.generateAudio({
  prompt: "speak"
}, {
  role: openAiGenerationRuntime.registry.require("audio-generation")
});
assert(openAiAudioGeneration.status === "success", "OpenAI-compatible audio generation must return success.");
assert(openAiAudioGeneration.value?.mimeType === "audio/wav", "OpenAI-compatible audio generation must parse binary audio response.");
assert(openAiGenerationRequests.some((request) => request.url === "https://llm.example/v1/images/generations"), "OpenAI-compatible image generation must call /images/generations.");
assert(openAiGenerationRequests.some((request) => request.url === "https://llm.example/v1/audio/speech"), "OpenAI-compatible audio generation must call /audio/speech.");
assert(openAiGenerationRequests.every((request) => request.init?.headers?.authorization === "Bearer api-key-test"), "OpenAI-compatible generation must use configured bearer auth.");
assert(openAiGenerationAudits.some((audit) => audit.role === "image-generation" && audit.provider === "openai-compatible" && audit.status === "success" && audit.usage.imageCount === 1), "OpenAI-compatible image generation must emit image audit.");
assert(openAiGenerationAudits.some((audit) => audit.role === "audio-generation" && audit.provider === "openai-compatible" && audit.status === "success"), "OpenAI-compatible audio generation must emit audio audit.");

const disabledGenerationAudits = [];
const disabledGenerationRuntime = buildMindoryLlm(loadMindoryConfig({}), {
  auditSink: (audit) => disabledGenerationAudits.push(audit)
});
const disabledImageGeneration = disabledGenerationRuntime.disabledResult("image-generation");
assert(disabledImageGeneration.status === "disabled", "Disabled image generation role must return standard disabled result.");
assert(disabledGenerationAudits.some((audit) => audit.role === "image-generation" && audit.status === "disabled"), "Disabled image generation role must emit disabled audit.");

const localAudits = [];
const localRequests = [];
const localEmbedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
const localConfig = loadMindoryConfig({
  MINDORY_LLM_CHAT_ENABLED: "true",
  MINDORY_LLM_CHAT_PROVIDER: "local-http",
  MINDORY_LLM_CHAT_MODEL: "local-chat",
  MINDORY_LLM_TEXT_EMBEDDING_ENABLED: "true",
  MINDORY_LLM_TEXT_EMBEDDING_PROVIDER: "local-http",
  MINDORY_LLM_TEXT_EMBEDDING_MODEL: "local-embedding",
  MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS: "1536",
  MINDORY_LLM_IMAGE_EMBEDDING_ENABLED: "true",
  MINDORY_LLM_IMAGE_EMBEDDING_PROVIDER: "local-http",
  MINDORY_LLM_IMAGE_EMBEDDING_MODEL: "local-image-embedding",
  MINDORY_LLM_IMAGE_EMBEDDING_DIMENSIONS: "1536",
  MINDORY_LLM_OCR_ENABLED: "true",
  MINDORY_LLM_OCR_PROVIDER: "local-http",
  MINDORY_LLM_OCR_MODEL: "local-ocr",
  MINDORY_LLM_ASR_ENABLED: "true",
  MINDORY_LLM_ASR_PROVIDER: "local-http",
  MINDORY_LLM_ASR_MODEL: "local-asr",
  MINDORY_LLM_FACE_DETECTION_ENABLED: "true",
  MINDORY_LLM_FACE_DETECTION_PROVIDER: "local-http",
  MINDORY_LLM_FACE_DETECTION_MODEL: "local-face-detect",
  MINDORY_LLM_FACE_RECOGNITION_ENABLED: "true",
  MINDORY_LLM_FACE_RECOGNITION_PROVIDER: "local-http",
  MINDORY_LLM_FACE_RECOGNITION_MODEL: "local-face-recognize",
  MINDORY_LLM_VISION_CAPTIONING_ENABLED: "true",
  MINDORY_LLM_VISION_CAPTIONING_PROVIDER: "local-http",
  MINDORY_LLM_VISION_CAPTIONING_MODEL: "local-vision",
  MINDORY_LLM_IMAGE_GENERATION_ENABLED: "true",
  MINDORY_LLM_IMAGE_GENERATION_PROVIDER: "local-http",
  MINDORY_LLM_IMAGE_GENERATION_MODEL: "local-image-generation",
  MINDORY_LLM_AUDIO_GENERATION_ENABLED: "true",
  MINDORY_LLM_AUDIO_GENERATION_PROVIDER: "local-http",
  MINDORY_LLM_AUDIO_GENERATION_MODEL: "local-audio-generation",
  MINDORY_LLM_LOCAL_HTTP_BASE_URL: "http://llm.local:8080",
  MINDORY_LLM_OLLAMA_BASE_URL: "http://ollama.local:11434"
});
const localRuntime = buildMindoryLlm(localConfig, {
  auditSink: (audit) => localAudits.push(audit),
  fetchImpl: async (url, init) => {
    localRequests.push({ url: String(url), init });
    const href = String(url);
    if (href.endsWith("/embeddings")) {
      return new Response(JSON.stringify({
        data: [{ index: 0, embedding: localEmbedding }],
        model: "local-embedding"
      }), { status: 200 });
    }
    if (href.endsWith("/embeddings/images")) {
      return new Response(JSON.stringify({
        data: [{ index: 0, embedding: localEmbedding }],
        model: "local-image-embedding"
      }), { status: 200 });
    }
    if (href.endsWith("/chat/completions")) {
      return new Response(JSON.stringify({
        text: "hello from local http",
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5
        }
      }), { status: 200 });
    }
    if (href.endsWith("/ocr")) {
      return new Response(JSON.stringify({
        text: "local http ocr text",
        pages: [{ page_number: 1, text: "local http ocr text", confidence: 0.99 }]
      }), { status: 200 });
    }
    if (href.endsWith("/vision/caption")) {
      return new Response(JSON.stringify({
        caption: "local http vision caption",
        labels: ["passport", "airport"]
      }), { status: 200 });
    }
    if (href.endsWith("/vision/objects")) {
      return new Response(JSON.stringify({
        labels: ["passport", "airport"],
        objects: [{
          label: "passport",
          confidence: 0.97,
          bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, unit: "ratio" }
        }]
      }), { status: 200 });
    }
    if (href.endsWith("/asr")) {
      return new Response(JSON.stringify({
        text: "local http asr transcript",
        segments: [{ segment_index: 0, text: "local http asr transcript", start_ms: 0, end_ms: 1000, confidence: 0.98 }]
      }), { status: 200 });
    }
    if (href.endsWith("/faces/detect") || href.endsWith("/faces/recognize")) {
      return new Response(JSON.stringify({
        faces: [{
          bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, unit: "ratio" },
          embedding: [0.1, 0.2, 0.3],
          confidence: 0.99,
          label: "test-face"
        }]
      }), { status: 200 });
    }
    if (href.endsWith("/generation/image")) {
      return new Response(JSON.stringify({
        data_base64: Buffer.from("local http image").toString("base64"),
        mime_type: "image/png",
        metadata: { prompt: "local image" },
        usage: { image_count: 1, prompt_tokens: 2, total_tokens: 2 }
      }), { status: 200 });
    }
    if (href.endsWith("/generation/audio")) {
      return new Response(JSON.stringify({
        data_base64: Buffer.from("local http audio").toString("base64"),
        mime_type: "audio/wav",
        duration_seconds: 1.5,
        usage: { audio_seconds: 1.5, prompt_tokens: 2, total_tokens: 2 }
      }), { status: 200 });
    }
    if (href.endsWith("/health") || href.endsWith("/api/tags")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }
});
assert(localRuntime.chat !== undefined, "Local HTTP chat provider must be built when chat is enabled.");
assert(localRuntime.textEmbeddings !== undefined, "Local HTTP text embeddings provider must be built when text embeddings are enabled.");
assert(localRuntime.imageEmbeddings !== undefined, "Local HTTP image embeddings provider must be built when image embeddings are enabled.");
assert(localRuntime.ocr !== undefined, "Local HTTP OCR provider must be built when OCR is enabled.");
assert(localRuntime.asr !== undefined, "Local HTTP ASR provider must be built when ASR is enabled.");
assert(localRuntime.vision !== undefined, "Local HTTP vision provider must be built when vision captioning is enabled.");
assert(localRuntime.faces !== undefined, "Local HTTP face provider must be built when face roles are enabled.");
assert(localRuntime.generation !== undefined, "Local HTTP generation provider must be built when generation roles are enabled.");
const localChatResult = await localRuntime.chat.generateChat({
  messages: [{ role: "user", content: "hello" }]
}, {
  role: localRuntime.registry.require("chat"),
  refs: { projectId: "project-local" }
});
assert(localChatResult.status === "success", "Local HTTP chat provider must return success.");
assert(localChatResult.value?.text === "hello from local http", "Local HTTP chat provider must parse simple text output.");
const localEmbeddingResult = await localRuntime.textEmbeddings.embedTexts({ texts: ["semantic text"] });
assert(localEmbeddingResult[0]?.embedding.length === 1536, "Local HTTP embeddings provider must return 1536-dimensional embeddings.");
const localImageEmbeddingResult = await localRuntime.imageEmbeddings.embedImages({
  images: [{ bytes: new TextEncoder().encode("fake image bytes"), mimeType: "image/png" }]
}, {
  role: localRuntime.registry.require("image-embedding"),
  refs: { documentId: "doc-local" }
});
assert(localImageEmbeddingResult.status === "success", "Local HTTP image embeddings provider must return success.");
assert(localImageEmbeddingResult.value?.[0]?.length === 1536, "Local HTTP image embeddings provider must return 1536-dimensional embeddings.");
const localOcrResult = await localRuntime.ocr.recognizeText({
  bytes: new TextEncoder().encode("fake pdf bytes"),
  mimeType: "application/pdf"
}, {
  role: localRuntime.registry.require("ocr"),
  refs: { documentId: "doc-local" }
});
assert(localOcrResult.status === "success", "Local HTTP OCR provider must return success.");
assert(localOcrResult.value?.pages?.[0]?.text === "local http ocr text", "Local HTTP OCR provider must parse page text.");
const localAsrResult = await localRuntime.asr.transcribe({
  bytes: new TextEncoder().encode("fake audio bytes"),
  mimeType: "audio/wav"
}, {
  role: localRuntime.registry.require("asr"),
  refs: { documentId: "doc-local" }
});
assert(localAsrResult.status === "success", "Local HTTP ASR provider must return success.");
assert(localAsrResult.value?.segments?.[0]?.text === "local http asr transcript", "Local HTTP ASR provider must parse transcript segments.");
const localVisionResult = await localRuntime.vision.captionImage({
  bytes: new TextEncoder().encode("fake image bytes"),
  mimeType: "image/png"
}, {
  role: localRuntime.registry.require("vision-captioning"),
  refs: { documentId: "doc-local" }
});
assert(localVisionResult.status === "success", "Local HTTP vision provider must return success.");
assert(localVisionResult.value?.caption === "local http vision caption", "Local HTTP vision provider must parse caption text.");
const localObjectResult = await localRuntime.vision.detectObjects({
  bytes: new TextEncoder().encode("fake image bytes"),
  mimeType: "image/png"
}, {
  role: localRuntime.registry.require("vision-captioning"),
  refs: { documentId: "doc-local" }
});
assert(localObjectResult.status === "success", "Local HTTP object detection provider must return success.");
assert(localObjectResult.value?.objects?.[0]?.label === "passport", "Local HTTP object detection provider must parse object labels.");
assert(localObjectResult.value?.objects?.[0]?.boundingBox?.unit === "ratio", "Local HTTP object detection provider must parse object bounding boxes.");
const localFaceDetectResult = await localRuntime.faces.detectFaces({
  bytes: new TextEncoder().encode("fake image bytes"),
  mimeType: "image/png"
}, {
  role: localRuntime.registry.require("face-detection"),
  refs: { documentId: "doc-local" }
});
assert(localFaceDetectResult.status === "success", "Local HTTP face detection provider must return success.");
assert(localFaceDetectResult.value?.faces?.[0]?.embedding?.length === 3, "Local HTTP face detection provider must parse face embeddings.");
const localFaceRecognitionResult = await localRuntime.faces.recognizeFaces({
  bytes: new TextEncoder().encode("fake image bytes"),
  mimeType: "image/png"
}, {
  role: localRuntime.registry.require("face-recognition"),
  refs: { documentId: "doc-local" }
});
assert(localFaceRecognitionResult.status === "success", "Local HTTP face recognition provider must return success.");
const localImageGenerationResult = await localRuntime.generation.generateImage({
  prompt: "draw local image"
}, {
  role: localRuntime.registry.require("image-generation"),
  refs: { projectId: "project-local" }
});
assert(localImageGenerationResult.status === "success", "Local HTTP image generation provider must return success.");
assert(localImageGenerationResult.value?.mimeType === "image/png", "Local HTTP image generation provider must parse image MIME type.");
assert(localImageGenerationResult.value?.bytes.length > 0, "Local HTTP image generation provider must parse image bytes.");
const localAudioGenerationResult = await localRuntime.generation.generateAudio({
  prompt: "speak local audio"
}, {
  role: localRuntime.registry.require("audio-generation"),
  refs: { projectId: "project-local" }
});
assert(localAudioGenerationResult.status === "success", "Local HTTP audio generation provider must return success.");
assert(localAudioGenerationResult.value?.mimeType === "audio/wav", "Local HTTP audio generation provider must parse audio MIME type.");
assert(localAudioGenerationResult.audit.usage.audioSeconds === 1.5, "Local HTTP audio generation audit must include audio duration.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/chat/completions"), "Local HTTP chat provider must call /chat/completions.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/embeddings"), "Local HTTP embeddings provider must call /embeddings.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/embeddings/images"), "Local HTTP image embeddings provider must call /embeddings/images.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/ocr"), "Local HTTP OCR provider must call /ocr.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/asr"), "Local HTTP ASR provider must call /asr.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/vision/caption"), "Local HTTP vision provider must call /vision/caption.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/vision/objects"), "Local HTTP object detection provider must call /vision/objects.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/faces/detect"), "Local HTTP face detection provider must call /faces/detect.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/faces/recognize"), "Local HTTP face recognition provider must call /faces/recognize.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/generation/image"), "Local HTTP image generation provider must call /generation/image.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/generation/audio"), "Local HTTP audio generation provider must call /generation/audio.");
const localHealth = await localRuntime.healthCheck("local-http");
assert(localHealth.status === "ok", "Local HTTP health check must succeed against /health.");
const ollamaHealth = await localRuntime.healthCheck("ollama");
assert(ollamaHealth.status === "ok", "Ollama health check must succeed against /api/tags.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/health"), "Local HTTP health check must call /health.");
assert(localRequests.some((request) => request.url === "http://ollama.local:11434/api/tags"), "Ollama health check must call /api/tags.");
assert(localAudits.some((audit) => audit.role === "chat" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP chat must emit success audit.");
assert(localAudits.some((audit) => audit.role === "text-embedding" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP embeddings must emit success audit.");
assert(localAudits.some((audit) => audit.role === "image-embedding" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP image embeddings must emit success audit.");
assert(localAudits.some((audit) => audit.role === "ocr" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP OCR must emit success audit.");
assert(localAudits.some((audit) => audit.role === "asr" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP ASR must emit success audit.");
assert(localAudits.some((audit) => audit.role === "vision-captioning" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP vision must emit success audit.");
assert(localAudits.some((audit) => audit.role === "face-detection" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP face detection must emit success audit.");
assert(localAudits.some((audit) => audit.role === "face-recognition" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP face recognition must emit success audit.");
assert(localAudits.some((audit) => audit.role === "image-generation" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP image generation must emit success audit.");
assert(localAudits.some((audit) => audit.role === "audio-generation" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP audio generation must emit success audit.");

function localCommandConfig(script, extra = {}) {
  return loadMindoryConfig({
    MINDORY_LLM_TEXT_EMBEDDING_ENABLED: "true",
    MINDORY_LLM_TEXT_EMBEDDING_PROVIDER: "local-command",
    MINDORY_LLM_TEXT_EMBEDDING_MODEL: "local-command-embedding",
    MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS: "1536",
    MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS: "1000",
    MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND: process.execPath,
    MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS: JSON.stringify(["-e", script, "{role}", "{model}"]),
    MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND: process.execPath,
    MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS: JSON.stringify(["-e", script, "{role}", "{model}", "{operation}"]),
    MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES: "16777216",
    MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES: "67108864",
    ...extra
  });
}

const localCommandAudits = [];
const localCommandHealth = await checkMindoryLlmProviderHealth(localCommandConfig([
  "const role = process.argv[1];",
  "const model = process.argv[2];",
  "console.log(JSON.stringify({ status: 'ok', provider: 'local-command', role, model, diagnostics: { ready: true } }));"
].join("")), "local-command", {
  auditSink: (audit) => localCommandAudits.push(audit)
});
assert(localCommandHealth.status === "ok", "Local-command healthcheck must execute a real command and return ok.");
assert(localCommandHealth.checks?.[0]?.role === "text-embedding", "Local-command healthcheck must validate the role returned by the command.");
assert(localCommandHealth.checks?.[0]?.model === "local-command-embedding", "Local-command healthcheck must validate the model returned by the command.");
assert(localCommandAudits.some((audit) => audit.role === "text-embedding" && audit.provider === "local-command" && audit.status === "success"), "Local-command healthcheck must emit success audit.");

const malformedLocalCommandHealth = await checkMindoryLlmProviderHealth(localCommandConfig("console.log('not-json');"), "local-command", {
  auditSink: (audit) => localCommandAudits.push(audit)
});
assert(malformedLocalCommandHealth.status === "failed", "Malformed local-command healthcheck stdout must fail.");
assert(malformedLocalCommandHealth.errorCode === "local_command_healthcheck_malformed_json", "Malformed local-command healthcheck must report malformed JSON.");

const unsupportedLocalCommandHealth = await checkMindoryLlmProviderHealth(localCommandConfig([
  "const role = process.argv[1];",
  "const model = process.argv[2];",
  "console.log(JSON.stringify({ status: 'failed', provider: 'local-command', role, model, error_code: 'local_command_healthcheck_unsupported_role', error_message: 'role unsupported' }));"
].join("")), "local-command", {
  auditSink: (audit) => localCommandAudits.push(audit)
});
assert(unsupportedLocalCommandHealth.status === "failed", "Unsupported local-command role response must fail.");
assert(unsupportedLocalCommandHealth.errorCode === "local_command_healthcheck_unsupported_role", "Unsupported local-command role response must preserve structured error code.");

const timeoutLocalCommandHealth = await checkMindoryLlmProviderHealth(localCommandConfig("setTimeout(() => {}, 10000);", {
  MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS: "50"
}), "local-command", {
  auditSink: (audit) => localCommandAudits.push(audit)
});
assert(timeoutLocalCommandHealth.status === "failed", "Timed-out local-command healthcheck must fail.");
assert(timeoutLocalCommandHealth.errorCode === "local_command_healthcheck_timeout", "Timed-out local-command healthcheck must report timeout.");
assert(localCommandAudits.some((audit) => audit.provider === "local-command" && audit.status === "failed" && audit.errorCode === "local_command_healthcheck_malformed_json"), "Local-command malformed healthcheck must emit failed audit.");
assert(localCommandAudits.some((audit) => audit.provider === "local-command" && audit.status === "failed" && audit.errorCode === "local_command_healthcheck_timeout"), "Local-command timeout healthcheck must emit failed audit.");

const localCommandOperationScript = `
const fs = require('node:fs');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const embedding1536 = Array.from({ length: 1536 }, (_, index) => index / 1536);
const media = Buffer.from('mindory generated media').toString('base64');
function send(output, usage = {}) {
  console.log(JSON.stringify({ status: 'ok', role: request.role, model: request.model, output, usage }));
}
switch (request.operation) {
  case 'chat':
    send({ text: 'local command chat', usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
    break;
  case 'text_embeddings':
    send({ embeddings: [embedding1536] }, { embedding_dimensions: 1536 });
    break;
  case 'image_embeddings':
    send({ embeddings: [embedding1536] }, { embedding_dimensions: 1536, image_count: 1 });
    break;
  case 'ocr':
    send({ text: 'local command ocr', pages: [{ page_number: 1, text: 'local command ocr', confidence: 0.99 }] });
    break;
  case 'asr':
    send({ text: 'local command transcript', duration_seconds: 1.25, segments: [{ segment_index: 0, text: 'local command transcript', start_ms: 0, end_ms: 1250, confidence: 0.98 }] }, { audio_seconds: 1.25 });
    break;
  case 'vision_caption':
    send({ caption: 'local command caption', labels: ['passport', 'airport'] }, { image_count: 1 });
    break;
  case 'object_detection':
    send({ objects: [{ label: 'passport', confidence: 0.97, bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, unit: 'ratio' } }], labels: ['passport'] }, { image_count: 1 });
    break;
  case 'face_detection':
    send({ faces: [{ bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, embedding: [0.1, 0.2, 0.3], confidence: 0.99, label: 'face' }] }, { image_count: 1 });
    break;
  case 'face_recognition':
    send({ faces: [{ bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, embedding: [0.1, 0.2, 0.3], confidence: 0.99, label: 'face' }], identity_ids: ['identity-1'] }, { image_count: 1 });
    break;
  case 'image_generation':
    send({ data_base64: media, mime_type: 'image/png' }, { image_count: 1 });
    break;
  case 'audio_generation':
    send({ data_base64: media, mime_type: 'audio/wav' }, { audio_seconds: 1 });
    break;
  default:
    console.log(JSON.stringify({ status: 'failed', role: request.role, model: request.model, error_code: 'unknown_operation', error_message: request.operation }));
}
`;
const localCommandOperationAudits = [];
const localCommandOperationConfig = loadMindoryConfig({
  MINDORY_LLM_CHAT_ENABLED: "true",
  MINDORY_LLM_CHAT_PROVIDER: "local-command",
  MINDORY_LLM_CHAT_MODEL: "local-command-chat",
  MINDORY_LLM_TEXT_EMBEDDING_ENABLED: "true",
  MINDORY_LLM_TEXT_EMBEDDING_PROVIDER: "local-command",
  MINDORY_LLM_TEXT_EMBEDDING_MODEL: "local-command-embedding",
  MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS: "1536",
  MINDORY_LLM_IMAGE_EMBEDDING_ENABLED: "true",
  MINDORY_LLM_IMAGE_EMBEDDING_PROVIDER: "local-command",
  MINDORY_LLM_IMAGE_EMBEDDING_MODEL: "local-command-image-embedding",
  MINDORY_LLM_IMAGE_EMBEDDING_DIMENSIONS: "1536",
  MINDORY_LLM_OCR_ENABLED: "true",
  MINDORY_LLM_OCR_PROVIDER: "local-command",
  MINDORY_LLM_OCR_MODEL: "local-command-ocr",
  MINDORY_LLM_ASR_ENABLED: "true",
  MINDORY_LLM_ASR_PROVIDER: "local-command",
  MINDORY_LLM_ASR_MODEL: "local-command-asr",
  MINDORY_LLM_FACE_DETECTION_ENABLED: "true",
  MINDORY_LLM_FACE_DETECTION_PROVIDER: "local-command",
  MINDORY_LLM_FACE_DETECTION_MODEL: "local-command-face-detect",
  MINDORY_LLM_FACE_RECOGNITION_ENABLED: "true",
  MINDORY_LLM_FACE_RECOGNITION_PROVIDER: "local-command",
  MINDORY_LLM_FACE_RECOGNITION_MODEL: "local-command-face-recognize",
  MINDORY_LLM_VISION_CAPTIONING_ENABLED: "true",
  MINDORY_LLM_VISION_CAPTIONING_PROVIDER: "local-command",
  MINDORY_LLM_VISION_CAPTIONING_MODEL: "local-command-vision",
  MINDORY_LLM_IMAGE_GENERATION_ENABLED: "true",
  MINDORY_LLM_IMAGE_GENERATION_PROVIDER: "local-command",
  MINDORY_LLM_IMAGE_GENERATION_MODEL: "local-command-image-gen",
  MINDORY_LLM_AUDIO_GENERATION_ENABLED: "true",
  MINDORY_LLM_AUDIO_GENERATION_PROVIDER: "local-command",
  MINDORY_LLM_AUDIO_GENERATION_MODEL: "local-command-audio-gen",
  MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS: "1000",
  MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND: process.execPath,
  MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS: JSON.stringify(["-e", "console.log(JSON.stringify({ status: 'ok', role: process.argv[1], model: process.argv[2] }));", "{role}", "{model}"]),
  MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND: process.execPath,
  MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS: JSON.stringify(["-e", localCommandOperationScript, "{role}", "{model}", "{operation}"])
});
const localCommandRuntime = buildMindoryLlm(localCommandOperationConfig, {
  auditSink: (audit) => localCommandOperationAudits.push(audit)
});
assert(localCommandRuntime.chat !== undefined, "Local-command chat provider must be built.");
assert(localCommandRuntime.textEmbeddings !== undefined, "Local-command text embeddings provider must be built.");
assert(localCommandRuntime.imageEmbeddings !== undefined, "Local-command image embeddings provider must be built.");
assert(localCommandRuntime.ocr !== undefined, "Local-command OCR provider must be built.");
assert(localCommandRuntime.asr !== undefined, "Local-command ASR provider must be built.");
assert(localCommandRuntime.vision !== undefined, "Local-command vision provider must be built.");
assert(localCommandRuntime.faces !== undefined, "Local-command face provider must be built.");
assert(localCommandRuntime.generation !== undefined, "Local-command generation provider must be built.");
assert((await localCommandRuntime.chat.generateChat({ messages: [{ role: "user", content: "hello" }] }, { role: localCommandRuntime.registry.require("chat") })).value?.text === "local command chat", "Local-command chat must parse text output.");
assert((await localCommandRuntime.textEmbeddings.embedTexts({ texts: ["semantic"] }))[0]?.embedding.length === 1536, "Local-command text embeddings must parse embeddings.");
assert((await localCommandRuntime.imageEmbeddings.embedImages({ images: [{ bytes: new TextEncoder().encode("image"), mimeType: "image/png" }] }, { role: localCommandRuntime.registry.require("image-embedding") })).value?.[0]?.length === 1536, "Local-command image embeddings must parse image vectors.");
assert((await localCommandRuntime.ocr.recognizeText({ bytes: new TextEncoder().encode("pdf"), mimeType: "application/pdf" }, { role: localCommandRuntime.registry.require("ocr") })).value?.text === "local command ocr", "Local-command OCR must parse text.");
assert((await localCommandRuntime.asr.transcribe({ bytes: new TextEncoder().encode("audio"), mimeType: "audio/wav" }, { role: localCommandRuntime.registry.require("asr") })).value?.segments?.[0]?.text === "local command transcript", "Local-command ASR must parse segments.");
assert((await localCommandRuntime.vision.captionImage({ bytes: new TextEncoder().encode("image"), mimeType: "image/png" }, { role: localCommandRuntime.registry.require("vision-captioning") })).value?.labels?.includes("passport"), "Local-command vision must parse labels.");
assert((await localCommandRuntime.vision.detectObjects({ bytes: new TextEncoder().encode("image"), mimeType: "image/png" }, { role: localCommandRuntime.registry.require("vision-captioning") })).value?.objects?.[0]?.label === "passport", "Local-command object detection must parse object labels.");
assert((await localCommandRuntime.faces.detectFaces({ bytes: new TextEncoder().encode("image"), mimeType: "image/png" }, { role: localCommandRuntime.registry.require("face-detection") })).value?.faces?.[0]?.embedding?.length === 3, "Local-command face detection must parse faces.");
assert((await localCommandRuntime.faces.recognizeFaces({ bytes: new TextEncoder().encode("image"), mimeType: "image/png" }, { role: localCommandRuntime.registry.require("face-recognition") })).value?.identityIds?.[0] === "identity-1", "Local-command face recognition must parse identities.");
assert((await localCommandRuntime.generation.generateImage({ prompt: "draw" }, { role: localCommandRuntime.registry.require("image-generation") })).value?.mimeType === "image/png", "Local-command image generation must parse generated image bytes.");
assert((await localCommandRuntime.generation.generateAudio({ prompt: "speak" }, { role: localCommandRuntime.registry.require("audio-generation") })).value?.mimeType === "audio/wav", "Local-command audio generation must parse generated audio bytes.");
for (const role of ["chat", "text-embedding", "image-embedding", "ocr", "asr", "vision-captioning", "face-detection", "face-recognition", "image-generation", "audio-generation"]) {
  assert(localCommandOperationAudits.some((audit) => audit.role === role && audit.provider === "local-command" && audit.status === "success"), `Local-command ${role} must emit success audit.`);
}

const failingLocalCommandRuntime = buildMindoryLlm(loadMindoryConfig({
  MINDORY_LLM_CHAT_ENABLED: "true",
  MINDORY_LLM_CHAT_PROVIDER: "local-command",
  MINDORY_LLM_CHAT_MODEL: "local-command-chat",
  MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND: process.execPath,
  MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS: JSON.stringify(["-e", "console.log(JSON.stringify({ status: 'ok', role: process.argv[1], model: process.argv[2] }));", "{role}", "{model}"]),
  MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND: process.execPath,
  MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS: JSON.stringify(["-e", "const fs = require('node:fs'); const request = JSON.parse(fs.readFileSync(0, 'utf8')); console.log(JSON.stringify({ status: 'failed', role: request.role, model: request.model, error_code: 'local_command_fixture_failed', error_message: 'fixture failure' }));", "{role}", "{model}", "{operation}"])
}), {
  auditSink: (audit) => localCommandOperationAudits.push(audit)
});
const failedLocalCommandChat = await failingLocalCommandRuntime.chat.generateChat({ messages: [{ role: "user", content: "fail" }] }, { role: failingLocalCommandRuntime.registry.require("chat") });
assert(failedLocalCommandChat.status === "failed", "Local-command role failure must return failed operation result.");
assert(failedLocalCommandChat.audit.errorCode === "local_command_fixture_failed", "Local-command role failure must preserve structured error code.");

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
