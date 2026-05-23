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

const packageJson = readJson("package.json");
const checkRepo = read("scripts/check-repo.js");
const compose = read("docker-compose.yml");
const dockerfile = read("Dockerfile");
const installer = read("packages/installer/src/index.ts");
const config = read("packages/config/src/index.ts");
const catalog = read("packages/config/src/catalog.ts");
const demo = read("scripts/mvp-demo.js");
const readme = read("README.md");
const deployment = read("docs/DEPLOYMENT.md");
const installerDocs = read("docs/INSTALLER.md");
const uiDocs = read("docs/UI.md");
const status = read("docs/REPOSITORY_STATUS.md");
const support = read("docs/SUPPORT_MATRIX.md");

assert(packageJson.scripts?.["ui:docker:validate"] === "node scripts/validate-ui-docker-installer-integration.js", "Root package must expose ui:docker:validate.");
assertIncludes(checkRepo, "ui:docker:validate", "scripts/check-repo.js");

for (const token of [
  "\n  ui:",
  "command: [\"node\", \"apps/ui/dist/server.js\"]",
  "MINDORY_UI_HOST: ${MINDORY_UI_HOST:-0.0.0.0}",
  "MINDORY_UI_PORT: ${MINDORY_UI_PORT:-3080}",
  "MINDORY_UI_API_URL: ${MINDORY_UI_API_URL:-http://api:3000}",
  "${MINDORY_UI_PORT:-3080}:${MINDORY_UI_PORT:-3080}",
  "'http://127.0.0.1:'+port+'/health'",
  "condition: service_healthy"
]) {
  assertIncludes(compose, token, "docker-compose.yml");
}

assertIncludes(dockerfile, "pnpm --filter @mindory/ui build", "Dockerfile");

for (const token of [
  "uiPort",
  "MINDORY_UI_HOST",
  "MINDORY_UI_PORT",
  "MINDORY_UI_API_URL",
  "interfaces.ui_port",
  "Start API, worker, MCP and Web UI services",
  "[\"up\", \"-d\", \"api\", \"worker\", \"mcp\", \"ui\"]",
  "\"api\", \"worker\", \"mcp\", \"ui\"",
  "uiUrl"
]) {
  assertIncludes(installer, token, "packages/installer/src/index.ts");
}

for (const token of ["ui:", "host:", "port:", "apiUrl:"]) {
  assertIncludes(config, token, "packages/config/src/index.ts");
}

for (const token of [
  "MINDORY_UI_HOST",
  "0.0.0.0",
  "MINDORY_UI_PORT",
  "Web UI port",
  "MINDORY_UI_API_URL",
  "http://api:3000"
]) {
  assertIncludes(catalog, token, "packages/config/src/catalog.ts");
}

for (const token of ["Web UI:", "MINDORY_UI_HOST", "MINDORY_UI_API_URL", "\"api\", \"worker\", \"mcp\", \"ui\""]) {
  assertIncludes(demo, token, "scripts/mvp-demo.js");
}

for (const token of ["TASK-130", "Docker Compose", "installer", "Web UI", "http://localhost:3080", "MINDORY_UI_API_URL"]) {
  assertIncludes(`${readme}\n${deployment}\n${installerDocs}\n${uiDocs}\n${status}\n${support}`, token, "public UI Docker/installer docs");
}

console.log("Web UI Docker and installer integration validated.");
