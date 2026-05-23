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
const app = read("apps/ui/src/app.ts");
const api = read("apps/ui/src/api.ts");
const types = read("apps/ui/src/types.ts");
const styles = read("apps/ui/public/styles.css");
const apiApp = read("apps/api/src/app.ts");
const runtimeRoutes = read("apps/api/src/routes/runtime.ts");
const uiDocs = read("docs/UI.md");
const readme = read("README.md");
const statusDocs = read("docs/REPOSITORY_STATUS.md");
const supportMatrix = read("docs/SUPPORT_MATRIX.md");
const checkRepo = read("scripts/check-repo.js");

assert(rootPackage.scripts?.["ui:diagnostics:validate"] === "node scripts/validate-ui-diagnostics-workspace.js", "Root package must expose ui:diagnostics:validate.");
assertIncludes(checkRepo, "ui:diagnostics:validate", "Repository check list");

for (const token of [
  "registerRuntimeRoutes",
  "/v1/runtime/diagnostics",
  "requireProjectPermission",
  "redactedRuntimeConfig",
  "providerHealth",
  "metricsLinks",
  "secret_key_configured",
  "token_configured"
]) {
  assertIncludes(runtimeRoutes + apiApp, token, "Runtime diagnostics API");
}

for (const token of [
  "runtimeDiagnostics",
  "/v1/runtime/diagnostics",
  "ready()",
  "listJobs"
]) {
  assertIncludes(api, token, "UI API client");
}

assertIncludes(types, "RuntimeDiagnostics", "UI types");

for (const token of [
  "renderDiagnosticsWorkspace",
  "renderRuntimeDiagnosticsPanel",
  "renderProviderDiagnosticsPanel",
  "renderJobDiagnosticsPanel",
  "refreshDiagnostics",
  "Runtime",
  "Providers",
  "Jobs and queues",
  "Provider health",
  "Metrics links"
]) {
  assertIncludes(app, token, "UI diagnostics workspace");
}

for (const token of [
  ".diagnostics-grid",
  ".config-section",
  ".status-grid",
  ".status-metric"
]) {
  assertIncludes(styles, token, "UI diagnostics styles");
}

for (const token of [
  "runtime diagnostics",
  "storage/vector/AV/model",
  "provider health",
  "metrics links",
  "TASK-130"
]) {
  assertIncludes(`${uiDocs}\n${readme}\n${statusDocs}\n${supportMatrix}`, token, "public documentation");
}

const blockedMarkers = [
  ["TO", "DO"].join(""),
  ["FIX", "ME"].join(""),
  ["not", "implemented"].join("_"),
  ["place", "holder"].join("")
];

for (const marker of blockedMarkers) {
  for (const [label, content] of Object.entries({ app, api, types, styles, runtimeRoutes, uiDocs })) {
    assert(!content.includes(marker), `${label} must not include ${marker}.`);
  }
}

console.log("Web UI diagnostics workspace validated.");
