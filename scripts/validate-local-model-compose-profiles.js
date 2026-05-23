import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await import(pathToFileURL(path.join(root, "packages/config/dist/index.js")).href);
const { LOCAL_MODEL_RUNNER_CATALOG } = config;

const packageJson = readJson("package.json");
const compose = read("docker-compose.yml");
const installer = read("packages/installer/src/index.ts");
const mvpDemo = read("scripts/mvp-demo.js");
const checkRepo = read("scripts/check-repo.js");
const releaseManifest = readJson("deploy/compose/release-manifest.json");
const deployment = read("docs/DEPLOYMENT.md");
const localModels = read("docs/LOCAL_MODELS.md");
const localModelAcceptance = read("scripts/local-model-acceptance.js");

assert(packageJson.scripts?.["local-model-profiles:validate"] === "pnpm --filter @mindory/installer typecheck && node scripts/validate-local-model-compose-profiles.js", "package.json must expose local-model-profiles:validate.");
assert(checkRepo.includes("\"local-model-profiles:validate\""), "pnpm check must include local-model-profiles:validate.");

for (const directory of ["data/models", "data/ollama"]) {
  assert(installer.includes(`"${directory}"`), `MINDORY_HOME_DIRECTORIES must include ${directory}.`);
  assert(releaseManifest.mindory_home_directories.includes(directory), `release manifest must include ${directory}.`);
  assert(deployment.includes(`- \`${directory}\``), `docs/DEPLOYMENT.md must document ${directory}.`);
}

assert(installer.includes("LOCAL_MODEL_RUNNER_CATALOG"), "installer must import LOCAL_MODEL_RUNNER_CATALOG.");
assert(installer.includes("composeProfilesForLlmProvider"), "installer must resolve LLM Compose profiles from catalog metadata.");
assert(installer.includes("entry.status === \"supported\" && entry.provider === provider"), "installer must use supported catalog runners for provider profiles.");
assert(installer.includes("profileServices[entry.composeProfile] = entry.serviceName"), "installer health waits must map model profiles to services through the catalog.");

for (const entry of LOCAL_MODEL_RUNNER_CATALOG.filter((item) => item.status === "supported")) {
  assert(compose.includes(`profiles: ["${entry.composeProfile}"]`), `docker-compose.yml must define profile ${entry.composeProfile}.`);
  assert(compose.includes(`${entry.serviceName}:`), `docker-compose.yml must define service ${entry.serviceName}.`);
  assert(localModels.includes(`\`${entry.id}\``), `docs/LOCAL_MODELS.md must document supported runner ${entry.id}.`);
}

for (const token of [
  "profiles: [\"local-models\"]",
  "scripts/local-model-server.mjs",
  "fetch('http://127.0.0.1:8080/health')",
  "data/models:/data/mindory/models",
  "profiles: [\"local-models-ocr\"]",
  "deploy/local-models/ocr/tesseract/Dockerfile",
  "MINDORY_LLM_OCR_LOCAL_HTTP_BASE_URL",
  "MINDORY_OCR_HEALTH_LOAD_MODEL",
  "profiles: [\"local-models-asr\"]",
  "deploy/local-models/asr/faster-whisper/Dockerfile",
  "MINDORY_LLM_ASR_LOCAL_HTTP_BASE_URL",
  "MINDORY_ASR_HEALTH_LOAD_MODEL",
  "profiles: [\"local-models-vision\"]",
  "deploy/local-models/vision/image-semantics/Dockerfile",
  "MINDORY_LLM_IMAGE_EMBEDDING_LOCAL_HTTP_BASE_URL",
  "MINDORY_LLM_VISION_CAPTIONING_LOCAL_HTTP_BASE_URL",
  "MINDORY_IMAGE_SEMANTICS_HEALTH_LOAD_MODEL",
  "profiles: [\"local-models-face\"]",
  "deploy/local-models/face/local-face/Dockerfile",
  "MINDORY_LLM_FACE_DETECTION_LOCAL_HTTP_BASE_URL",
  "MINDORY_LLM_FACE_RECOGNITION_LOCAL_HTTP_BASE_URL",
  "MINDORY_FACE_HEALTH_LOAD_MODEL",
  "profiles: [\"ollama\"]",
  "ollama/ollama:latest",
  "test: [\"CMD\", \"ollama\", \"list\"]",
  "data/ollama:/root/.ollama"
]) {
  assert(compose.includes(token), `docker-compose.yml must include ${token}.`);
}

for (const token of [
  "applyLocalHttpModelProfile",
  "MINDORY_INSTALL_ALLOW_EXPERIMENTAL",
  "MINDORY_LLM_TEXT_EMBEDDING_PROVIDER",
  "MINDORY_LLM_IMAGE_EMBEDDING_PROVIDER",
  "MINDORY_LLM_OCR_PROVIDER",
  "MINDORY_LLM_ASR_PROVIDER",
  "MINDORY_LLM_VISION_CAPTIONING_PROVIDER",
  "MINDORY_LLM_FACE_DETECTION_PROVIDER",
  "MINDORY_LLM_FACE_RECOGNITION_PROVIDER",
  "MINDORY_LLM_FACE_DETECTION_LOCAL_HTTP_BASE_URL",
  "MINDORY_LLM_FACE_RECOGNITION_LOCAL_HTTP_BASE_URL",
  "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
]) {
  assert(mvpDemo.includes(token), `scripts/mvp-demo.js must include ${token}.`);
}

for (const token of [
  "local-model-profiles:validate",
  "supported catalog runners have matching Compose profiles",
  "text embeddings",
  "image embeddings",
  "OCR",
  "ASR",
  "vision captioning",
  "face roles",
  "`@mindory/llm`"
]) {
  assert(`${localModels}\n${deployment}`.includes(token), `local model profile docs must include ${token}.`);
}

for (const assetPath of [
  "deploy/local-models/ocr/tesseract/Dockerfile",
  "deploy/local-models/ocr/tesseract/server.py",
  "deploy/local-models/asr/faster-whisper/Dockerfile",
  "deploy/local-models/asr/faster-whisper/server.py",
  "deploy/local-models/vision/image-semantics/Dockerfile",
  "deploy/local-models/vision/image-semantics/server.py",
  "deploy/local-models/face/local-face/Dockerfile",
  "deploy/local-models/face/local-face/server.py"
]) {
  assert(releaseManifest.assets?.some((asset) => asset.path === assetPath && asset.required === true), `Release manifest must include local model runner asset ${assetPath}.`);
}

for (const token of ["MINDORY_LOCAL_OCR_ACCEPTANCE_LIVE", "createTextPngWithDocker", "createTextPdfBuffer", "/ocr", "MINDORY_LOCAL_ASR_ACCEPTANCE_LIVE", "createAsrFixtureWithDocker", "/asr", "MINDORY_LOCAL_VISION_ACCEPTANCE_LIVE", "createVisionFixtureWithDocker", "/embeddings/images", "/vision/caption", "/vision/objects", "MINDORY_LOCAL_FACE_ACCEPTANCE_LIVE", "createFaceFixtureWithDocker", "/faces/detect", "/faces/recognize"]) {
  assert(localModelAcceptance.includes(token), `Local model acceptance must include live runner token ${token}.`);
}

console.log("Local model Compose profiles validated.");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
