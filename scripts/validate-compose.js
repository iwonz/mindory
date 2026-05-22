import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composePath = path.join(root, "docker-compose.yml");
const overridePath = path.join(root, "docker-compose.override.yml");
const testComposePath = path.join(root, "docker-compose.test.yml");
const dockerfilePath = path.join(root, "Dockerfile");
const dockerignorePath = path.join(root, ".dockerignore");
const releaseManifestPath = path.join(root, "deploy/compose/release-manifest.json");

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
const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, "utf8"));
const legacyServiceScript = "scripts/docker-" + "place" + "holder-service.mjs";

for (const service of ["postgres", "redis", "migrate", "api", "mcp", "worker", "librefs", "librefs-bucket", "minio", "minio-bucket", "docling"]) {
  assert(compose.includes(`\n  ${service}:`), `docker-compose.yml must define ${service}.`);
}

for (const profile of ["librefs", "minio", "clamav", "qdrant", "docling", "ollama", "local-models"]) {
  assert(compose.includes(`profiles: [\"${profile}\"]`), `docker-compose.yml must define the ${profile} profile.`);
}

assert(compose.includes("pgvector/pgvector"), "postgres service must use a pgvector-capable image.");
assert(compose.includes("redis:7-alpine"), "redis service must use the Redis image.");
assert(compose.includes("x-mindory-app"), "compose must define a shared built app image.");
assert(compose.includes("dockerfile: Dockerfile"), "app services must build from the root Dockerfile.");
assert(dockerfile.includes("pnpm install --frozen-lockfile"), "Dockerfile must install from the locked pnpm dependency graph.");
assert(dockerfile.includes("apk add --no-cache ffmpeg"), "Dockerfile must install ffmpeg for bundled video keyframe extraction.");
assert(dockerfile.includes("pnpm typecheck"), "Dockerfile must build TypeScript workspace outputs.");
assert(dockerignore.includes("node_modules"), ".dockerignore must exclude node_modules.");
assert(compose.includes("command: [\"pnpm\", \"db:migrate\"]"), "compose must run migrations before app services.");
assert(compose.includes("condition: service_completed_successfully"), "app services must wait for migration completion.");
assert(compose.includes("command: [\"node\", \"apps/api/dist/server.js\"]"), "API service must run the real API server.");
assert(compose.includes("command: [\"node\", \"apps/worker/dist/server.js\"]"), "Worker service must run the real worker server.");
assert(compose.includes("command: [\"node\", \"apps/mcp/dist/stdio.js\"]"), "MCP service must run the real stdio server.");
assert(compose.includes("stdin_open: true"), "MCP stdio service must keep stdin open.");
assert(!compose.includes(`command: ["node", "${legacyServiceScript}", "api"]`), "API legacy service command must be removed.");
assert(!compose.includes(`command: ["node", "${legacyServiceScript}", "mcp"]`), "MCP legacy service command must be removed.");
assert(!compose.includes(`command: ["node", "${legacyServiceScript}", "worker"]`), "Worker legacy service command must be removed.");
assert(!compose.includes(legacyServiceScript), "Compose must not use the legacy service script.");
assert(compose.includes("command: [\"node\", \"scripts/docling-service.mjs\"]"), "Docling profile must run the real Docling-compatible service.");
assert(compose.includes("MINDORY_DOCLING_URL"), "Compose environment must include Docling service URL configuration.");
assert(compose.includes("MINDORY_DOCLING_TIMEOUT_MS"), "Compose environment must include Docling service timeout configuration.");
assert(compose.includes("MINDORY_DOCLING_PORT"), "Compose environment must include Docling service port configuration.");
assert(compose.includes("'http://127.0.0.1:'+port+'/health'"), "Docling profile healthcheck must call /health.");
assert(compose.includes("MINDORY_DATABASE_URL"), "compose environment must include database configuration.");
assert(compose.includes("MINDORY_REDIS_URL"), "compose environment must include Redis configuration.");
assert(compose.includes("condition: service_healthy"), "app services must wait for healthy dependencies.");
assert(compose.includes("/ready"), "API healthcheck must call /ready.");
assert(compose.includes("'http://127.0.0.1:'+port+'/ready'"), "API healthcheck must avoid Compose interpolation inside JavaScript.");
assert(compose.includes("${MINDORY_HOME:-${HOME}/.mindory}/data/postgres:/var/lib/postgresql/data"), "Postgres data must be bind-mounted under MINDORY_HOME.");
assert(compose.includes("${MINDORY_HOME:-${HOME}/.mindory}/data/redis:/data"), "Redis data must be bind-mounted under MINDORY_HOME.");
assert(compose.includes("${MINDORY_HOME:-${HOME}/.mindory}/data/objects:/data/mindory/objects"), "API/worker services must mount local object storage under MINDORY_HOME.");
assert(compose.includes("${MINDORY_HOME:-${HOME}/.mindory}/config:/data/mindory/config:ro"), "Runtime services must mount config from MINDORY_HOME.");
assert(compose.includes("${MINDORY_HOME:-${HOME}/.mindory}/logs:/data/mindory/logs"), "Runtime services must mount logs under MINDORY_HOME.");
assert(compose.includes("ghcr.io/librefs/librefs:latest"), "Compose must define the LibreFS local S3-compatible image.");
assert(compose.includes("${MINDORY_HOME:-${HOME}/.mindory}/data/librefs:/data"), "LibreFS data must be bind-mounted under MINDORY_HOME.");
assert(compose.includes("librefs-bucket"), "Compose must define a LibreFS bucket bootstrap service.");
assert(compose.includes("minio-bucket"), "Compose must define a MinIO bucket bootstrap service.");
assert(compose.includes("mc mb --ignore-existing"), "S3-compatible profiles must bootstrap the configured bucket.");
assert(compose.includes("condition: service_healthy"), "S3-compatible bucket bootstrap must wait for a healthy storage service.");
for (const namedVolume of ["postgres-data:", "redis-data:", "objects-data:", "minio-data:", "clamav-data:", "qdrant-data:", "ollama-data:"]) {
  assert(!compose.includes(namedVolume), `Compose must not use named runtime volume ${namedVolume}.`);
}
assert(compose.includes("MINDORY_CLAMAV_PLATFORM"), "Compose must allow ClamAV platform override for local Docker Desktop compatibility.");
for (const envName of ["MINDORY_METRICS_ENABLED", "MINDORY_METRICS_PATH", "MINDORY_METRICS_BEARER_TOKEN", "MINDORY_METRICS_WORKER_PORT"]) {
  assert(compose.includes(envName), `Compose must include metrics env ${envName}.`);
}
assert(compose.includes("${MINDORY_METRICS_WORKER_PORT:-3001}:${MINDORY_METRICS_WORKER_PORT:-3001}"), "Worker service must publish the configured metrics port.");
assert(compose.includes("clamdscan --no-summary /tmp/mindory-clamav-health.txt"), "Compose must health-check the ClamAV daemon with a real scan.");
assert(compose.includes("\n  llm:"), "Compose must define an optional local LLM SDK service.");
assert(compose.includes("scripts/local-model-server.mjs"), "Local LLM SDK profile must run the local model HTTP service.");
assert(compose.includes("/health"), "Local LLM SDK profile must expose a healthcheck.");
for (const envName of [
  "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED: ${MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED:-true}",
  "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED: ${MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED:-true}",
  "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED: ${MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED:-true}",
  "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED: ${MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED:-true}"
]) {
  assert(compose.includes(envName), `Compose demo defaults must enable multimodal routing: ${envName}.`);
}
for (const envName of [
  "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER",
  "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND",
  "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND"
]) {
  assert(compose.includes(envName), `Compose must include video ffmpeg provider env ${envName}.`);
}
assert(override.includes("NODE_ENV: development"), "docker-compose.override.yml must set development mode.");
assert(testCompose.includes("name: mindory-test"), "docker-compose.test.yml must isolate the integration test project.");
assert(testCompose.includes("MINDORY_TEST_POSTGRES_PORT"), "docker-compose.test.yml must expose configurable PostgreSQL test port.");
assert(testCompose.includes("MINDORY_TEST_REDIS_PORT"), "docker-compose.test.yml must expose configurable Redis test port.");
for (const assetPath of ["docker-compose.yml", "Dockerfile", ".env.example"]) {
  assert(releaseManifest.assets?.some((asset) => asset.path === assetPath && asset.required === true), `Release Compose manifest must include ${assetPath}.`);
}
for (const homeDirectory of ["config", "data/postgres", "data/redis", "data/objects", "data/librefs", "logs", "backups", "install"]) {
  assert(releaseManifest.mindory_home_directories?.includes(homeDirectory), `Release Compose manifest must include MINDORY_HOME directory ${homeDirectory}.`);
}

console.log("Docker Compose runnable deployment validated.");
