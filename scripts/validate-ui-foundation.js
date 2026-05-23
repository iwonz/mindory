import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const build = spawnSync(process.execPath, ["apps/ui/scripts/build.mjs"], {
  cwd: root,
  stdio: "inherit"
});

if ((build.status ?? 1) !== 0) {
  process.exit(build.status ?? 1);
}

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

function assertIncludes(content, token, label) {
  assert(content.includes(token), `${label} must include ${token}.`);
}

const rootPackage = readJson("package.json");
const workspace = read("pnpm-workspace.yaml");
const rootTsconfig = read("tsconfig.json");
const packageJson = readJson("apps/ui/package.json");
const tsconfig = readJson("apps/ui/tsconfig.json");
const app = read("apps/ui/src/app.ts");
const api = read("apps/ui/src/api.ts");
const server = read("apps/ui/src/server.ts");
const state = read("apps/ui/src/state.ts");
const index = read("apps/ui/public/index.html");
const styles = read("apps/ui/public/styles.css");
const configCatalog = read("packages/config/src/catalog.ts");
const envExample = read(".env.example");
const checkRepo = read("scripts/check-repo.js");
const readme = read("README.md");
const uiDocs = read("docs/UI.md");
const repositoryStatus = read("docs/REPOSITORY_STATUS.md");
const supportMatrix = read("docs/SUPPORT_MATRIX.md");

assert(rootPackage.scripts?.["ui:validate"] === "node scripts/validate-ui-foundation.js", "Root package must expose ui:validate.");
assertIncludes(checkRepo, "ui:validate", "Repository check list");
assertIncludes(workspace, "apps/*", "pnpm workspace");
assertIncludes(rootTsconfig, "\"path\": \"apps/ui\"", "root tsconfig references");

assert(packageJson.name === "@mindory/ui", "UI package must be named @mindory/ui.");
assert(packageJson.scripts?.build === "node scripts/build.mjs", "UI package must expose build script.");
assert(packageJson.scripts?.start === "node dist/server.js", "UI package must expose start script.");
assert(tsconfig.compilerOptions?.composite === true, "UI tsconfig must be composite.");

for (const token of [
  "MindoryUiApiClient",
  "health()",
  "listProjects",
  "listPeers",
  "listSessions",
  "listMessages",
  "Bearer",
  "/v1/projects",
  "/v1/sessions"
]) {
  assertIncludes(api, token, "UI API client");
}

for (const token of [
  "Bearer token",
  "API URL",
  "renderHealthBanner",
  "renderProjectsPanel",
  "renderSessionsPanel",
  "renderMessagesPanel",
  "Authentication failed",
  "Access denied",
  "Token required",
  "No readable projects"
]) {
  assertIncludes(app, token, "UI app");
}

for (const token of [
  "mindory.ui.connection.v1",
  "localStorage",
  "maskToken"
]) {
  assertIncludes(state, token, "UI state");
}

for (const token of [
  "MINDORY_UI_HOST",
  "MINDORY_UI_PORT",
  "MINDORY_UI_API_URL"
]) {
  assertIncludes(server, token, "UI server");
  assertIncludes(configCatalog, token, "config catalog");
  assertIncludes(envExample, token, ".env.example");
}

for (const token of ["Proxying /api", "fetch(target"]) {
  assertIncludes(server, token, "UI server");
}

for (const token of ["app.js", "styles.css", "__MINDORY_UI_CONFIG__"]) {
  assertIncludes(index, token, "UI index");
}

for (const token of [".app-shell", ".workspace-grid", ".health-banner", "@media (max-width: 980px)"]) {
  assertIncludes(styles, token, "UI styles");
}

for (const token of ["pnpm --filter @mindory/ui build", "pnpm --filter @mindory/ui start", "MINDORY_UI_API_URL", "token entry", "project/session navigation"]) {
  assertIncludes(uiDocs, token, "UI docs");
}

assertIncludes(readme, "@mindory/ui", "README");
assertIncludes(repositoryStatus, "TASK-129", "repository status");
assertIncludes(supportMatrix, "Web UI", "support matrix");

const blockedMarkers = [
  ["TO", "DO"].join(""),
  ["FIX", "ME"].join(""),
  ["not", "implemented"].join("_"),
  ["place", "holder"].join("")
];

for (const marker of blockedMarkers) {
  for (const [label, content] of Object.entries({ app, api, server, state, uiDocs })) {
    assert(!content.includes(marker), `${label} must not include ${marker}.`);
  }
}

assert(fs.existsSync(path.join(root, "apps/ui/dist/index.html")), "UI build must produce dist/index.html before validation.");
assert(fs.existsSync(path.join(root, "apps/ui/dist/app.js")), "UI build must produce dist/app.js before validation.");
assert(fs.existsSync(path.join(root, "apps/ui/dist/server.js")), "UI build must produce dist/server.js before validation.");

console.log("Web UI foundation validated.");
