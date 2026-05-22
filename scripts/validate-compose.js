import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composePath = path.join(root, "docker-compose.yml");
const overridePath = path.join(root, "docker-compose.override.yml");
const testComposePath = path.join(root, "docker-compose.test.yml");
const dockerfilePath = path.join(root, "Dockerfile");
const dockerignorePath = path.join(root, ".dockerignore");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const compose = fs.readFileSync(composePath, "utf8");
const override = fs.readFileSync(overridePath, "utf8");
const testCompose = fs.readFileSync(testComposePath, "utf8");
const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
const dockerignore = fs.readFileSync(dockerignorePath, "utf8");

for (const service of ["postgres", "redis", "migrate", "api", "mcp", "worker"]) {
  assert(compose.includes(`\n  ${service}:`), `docker-compose.yml must define ${service}.`);
}

for (const profile of ["minio", "clamav", "qdrant", "docling", "ollama", "local-models"]) {
  assert(compose.includes(`profiles: [\"${profile}\"]`), `docker-compose.yml must define the ${profile} profile.`);
}

assert(compose.includes("pgvector/pgvector"), "postgres service must use a pgvector-capable image.");
assert(compose.includes("redis:7-alpine"), "redis service must use the Redis image.");
assert(compose.includes("x-mindory-app"), "compose must define a shared built app image.");
assert(compose.includes("dockerfile: Dockerfile"), "app services must build from the root Dockerfile.");
assert(dockerfile.includes("pnpm install --frozen-lockfile"), "Dockerfile must install from the locked pnpm dependency graph.");
assert(dockerfile.includes("pnpm typecheck"), "Dockerfile must build TypeScript workspace outputs.");
assert(dockerignore.includes("node_modules"), ".dockerignore must exclude node_modules.");
assert(compose.includes("command: [\"pnpm\", \"db:migrate\"]"), "compose must run migrations before app services.");
assert(compose.includes("condition: service_completed_successfully"), "app services must wait for migration completion.");
assert(compose.includes("command: [\"node\", \"apps/api/dist/server.js\"]"), "API service must run the real API server.");
assert(compose.includes("command: [\"node\", \"apps/worker/dist/server.js\"]"), "Worker service must run the real worker server.");
assert(compose.includes("command: [\"node\", \"apps/mcp/dist/stdio.js\"]"), "MCP service must run the real stdio server.");
assert(compose.includes("stdin_open: true"), "MCP stdio service must keep stdin open.");
assert(!compose.includes("command: [\"node\", \"scripts/docker-placeholder-service.mjs\", \"api\"]"), "API placeholder command must be removed.");
assert(!compose.includes("command: [\"node\", \"scripts/docker-placeholder-service.mjs\", \"mcp\"]"), "MCP placeholder command must be removed.");
assert(!compose.includes("command: [\"node\", \"scripts/docker-placeholder-service.mjs\", \"worker\"]"), "Worker placeholder command must be removed.");
assert(compose.includes("MINDORY_DATABASE_URL"), "compose environment must include database configuration.");
assert(compose.includes("MINDORY_REDIS_URL"), "compose environment must include Redis configuration.");
assert(compose.includes("condition: service_healthy"), "app services must wait for healthy dependencies.");
assert(compose.includes("/ready"), "API healthcheck must call /ready.");
assert(compose.includes("'http://127.0.0.1:'+port+'/ready'"), "API healthcheck must avoid Compose interpolation inside JavaScript.");
assert(compose.includes("objects-data:/data/mindory/objects"), "API/worker services must mount local object storage volume.");
assert(compose.includes("MINDORY_CLAMAV_PLATFORM"), "Compose must allow ClamAV platform override for local Docker Desktop compatibility.");
assert(compose.includes("\n  llm:"), "Compose must define an optional local LLM SDK service.");
assert(compose.includes("service:'llm'"), "Local LLM SDK profile must be a lightweight placeholder by default.");
for (const envName of [
  "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED: ${MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED:-true}",
  "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED: ${MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED:-true}",
  "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED: ${MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED:-true}",
  "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED: ${MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED:-true}"
]) {
  assert(compose.includes(envName), `Compose demo defaults must enable multimodal routing: ${envName}.`);
}
assert(override.includes("NODE_ENV: development"), "docker-compose.override.yml must set development mode.");
assert(testCompose.includes("name: mindory-test"), "docker-compose.test.yml must isolate the integration test project.");
assert(testCompose.includes("MINDORY_TEST_POSTGRES_PORT"), "docker-compose.test.yml must expose configurable PostgreSQL test port.");
assert(testCompose.includes("MINDORY_TEST_REDIS_PORT"), "docker-compose.test.yml must expose configurable Redis test port.");

console.log("Docker Compose runnable deployment validated.");
