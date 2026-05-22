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

const rootPackage = readJson("package.json");
const checkRepo = read("scripts/check-repo.js");
const demoScript = read("scripts/mvp-demo.js");
const localModelServer = read("scripts/local-model-server.mjs");
const readme = read("README.md");
const deployment = read("docs/DEPLOYMENT.md");
const acceptance = read("docs/MVP_ACCEPTANCE.md");

for (const [scriptName, expected] of [
  ["mvp:up", "node scripts/mvp-demo.js up"],
  ["mvp:demo", "node scripts/mvp-demo.js up --acceptance"],
  ["mvp:down", "node scripts/mvp-demo.js down"],
  ["mvp:reset", "node scripts/mvp-demo.js reset"],
  ["mvp:demo:validate", "node scripts/validate-mvp-demo.js"]
]) {
  assert(rootPackage.scripts?.[scriptName] === expected, `Root package must expose ${scriptName}.`);
}

assertIncludes(checkRepo, "mvp:demo:validate", "scripts/check-repo.js");

for (const token of [
  "docker",
  "compose",
  "--profile",
  "clamav",
  "scripts/seed-demo.js",
  "MINDORY_E2E_LIVE",
  "scripts/mvp-acceptance.js",
  "--model-profile",
  "local-models",
  "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED",
  "MINDORY_E2E_MODEL_PROFILE",
  "MINDORY_LLM_TEXT_EMBEDDING_PROVIDER",
  "mindory-local-embedding",
  "MINDORY_LLM_LOCAL_HTTP_BASE_URL",
  "/ready",
  "migrate",
  "--volumes",
  "Docker Compose is unavailable"
]) {
  assertIncludes(demoScript, token, "scripts/mvp-demo.js");
}

for (const token of ["/health", "/embeddings", "/chat/completions", "deterministicEmbedding", "1536"]) {
  assertIncludes(localModelServer, token, "scripts/local-model-server.mjs");
}

for (const token of ["pnpm mvp:demo", "pnpm mvp:up", "pnpm mvp:down", "pnpm mvp:reset"]) {
  assertIncludes(readme, token, "README.md");
  assertIncludes(deployment, token, "docs/DEPLOYMENT.md");
  assertIncludes(acceptance, token, "docs/MVP_ACCEPTANCE.md");
}

for (const token of ["PDF", "image", "audio", "video", "artifact search", "metadata filters", "reprocess", "disabled and non-blocking"]) {
  assertIncludes(acceptance, token, "docs/MVP_ACCEPTANCE.md");
}

console.log("MVP demo workflow validated.");
