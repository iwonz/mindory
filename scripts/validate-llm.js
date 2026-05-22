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
  "/asr",
  "/faces/detect",
  "/faces/recognize",
  "inputTokens",
  "outputTokens",
  "LlmTextEmbeddingProvider",
  "LlmOcrProvider",
  "LlmAsrProvider",
  "LlmAsrOutput",
  "LlmVisionProvider",
  "LlmFaceProvider",
  "LlmFaceDetectionOutput",
  "LlmFaceRecognitionOutput",
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
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS"
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
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS"
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
  "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS",
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND",
  "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS"
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
  "`image-generation` | future",
  "MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true",
  "/chat/completions",
  "`/embeddings`",
  "`/health`",
  "healthCheck"
]) {
  assertIncludes(docs, token, "LLM SDK docs");
}

const { buildMindoryLlm, checkMindoryLlmProviderHealth } = await import("../packages/llm/dist/index.js");
const { loadMindoryConfig } = await import("../packages/config/dist/index.js");
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
  MINDORY_INSTALL_ALLOW_EXPERIMENTAL: "true",
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
    if (href.endsWith("/health") || href.endsWith("/api/tags")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }
});
assert(localRuntime.chat !== undefined, "Local HTTP chat provider must be built when chat is enabled.");
assert(localRuntime.textEmbeddings !== undefined, "Local HTTP text embeddings provider must be built when text embeddings are enabled.");
assert(localRuntime.ocr !== undefined, "Local HTTP OCR provider must be built when OCR is enabled.");
assert(localRuntime.asr !== undefined, "Local HTTP ASR provider must be built when ASR is enabled.");
assert(localRuntime.vision !== undefined, "Local HTTP vision provider must be built when vision captioning is enabled.");
assert(localRuntime.faces !== undefined, "Local HTTP face provider must be built when face roles are enabled.");
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
assert(localRequests.some((request) => request.url === "http://llm.local:8080/chat/completions"), "Local HTTP chat provider must call /chat/completions.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/embeddings"), "Local HTTP embeddings provider must call /embeddings.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/ocr"), "Local HTTP OCR provider must call /ocr.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/asr"), "Local HTTP ASR provider must call /asr.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/vision/caption"), "Local HTTP vision provider must call /vision/caption.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/faces/detect"), "Local HTTP face detection provider must call /faces/detect.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/faces/recognize"), "Local HTTP face recognition provider must call /faces/recognize.");
const localHealth = await localRuntime.healthCheck("local-http");
assert(localHealth.status === "ok", "Local HTTP health check must succeed against /health.");
const ollamaHealth = await localRuntime.healthCheck("ollama");
assert(ollamaHealth.status === "ok", "Ollama health check must succeed against /api/tags.");
assert(localRequests.some((request) => request.url === "http://llm.local:8080/health"), "Local HTTP health check must call /health.");
assert(localRequests.some((request) => request.url === "http://ollama.local:11434/api/tags"), "Ollama health check must call /api/tags.");
assert(localAudits.some((audit) => audit.role === "chat" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP chat must emit success audit.");
assert(localAudits.some((audit) => audit.role === "text-embedding" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP embeddings must emit success audit.");
assert(localAudits.some((audit) => audit.role === "ocr" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP OCR must emit success audit.");
assert(localAudits.some((audit) => audit.role === "asr" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP ASR must emit success audit.");
assert(localAudits.some((audit) => audit.role === "vision-captioning" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP vision must emit success audit.");
assert(localAudits.some((audit) => audit.role === "face-detection" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP face detection must emit success audit.");
assert(localAudits.some((audit) => audit.role === "face-recognition" && audit.provider === "local-http" && audit.status === "success"), "Local HTTP face recognition must emit success audit.");

function localCommandConfig(script, extra = {}) {
  return loadMindoryConfig({
    MINDORY_INSTALL_ALLOW_EXPERIMENTAL: "true",
    MINDORY_LLM_TEXT_EMBEDDING_ENABLED: "true",
    MINDORY_LLM_TEXT_EMBEDDING_PROVIDER: "local-command",
    MINDORY_LLM_TEXT_EMBEDDING_MODEL: "local-command-embedding",
    MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS: "1536",
    MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS: "1000",
    MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND: process.execPath,
    MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS: JSON.stringify(["-e", script, "{role}", "{model}"]),
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
