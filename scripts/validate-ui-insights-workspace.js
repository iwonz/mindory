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
const memoryRoutes = read("apps/api/src/routes/memories.ts");
const uiDocs = read("docs/UI.md");
const readme = read("README.md");
const statusDocs = read("docs/REPOSITORY_STATUS.md");
const supportMatrix = read("docs/SUPPORT_MATRIX.md");
const checkRepo = read("scripts/check-repo.js");

assert(rootPackage.scripts?.["ui:insights:validate"] === "node scripts/validate-ui-insights-workspace.js", "Root package must expose ui:insights:validate.");
assertIncludes(checkRepo, "ui:insights:validate", "Repository check list");

for (const token of [
  "unifiedSearch",
  "buildContext",
  "rememberMemory",
  "searchMemories",
  "listFaceIdentities",
  "listFaceObservations",
  "renameFaceIdentity",
  "mergeFaceIdentity",
  "/v1/search",
  "/v1/context/build",
  "/v1/memories",
  "/v1/faces/identities"
]) {
  assertIncludes(api, token, "UI API client");
}

for (const token of [
  "UnifiedSearchHit",
  "ContextBuildResult",
  "MemoryClaim",
  "MemorySearchHit",
  "FaceIdentity",
  "FaceObservation",
  "SourceRef"
]) {
  assertIncludes(types, token, "UI insights types");
}

for (const token of [
  "renderSearchWorkspace",
  "renderUnifiedSearchPanel",
  "renderContextMemoryPanel",
  "renderFacesPanel",
  "runUnifiedSearch",
  "buildContextPreview",
  "rememberManualMemory",
  "refreshFaces",
  "renameFace",
  "mergeFace",
  "Unified search",
  "Context preview",
  "Source-backed memories",
  "Faces"
]) {
  assertIncludes(app, token, "UI insights workspace");
}

for (const token of [
  ".insights-grid",
  ".control-form",
  ".toggle-field",
  ".result-card",
  ".face-card"
]) {
  assertIncludes(styles, token, "UI insights styles");
}

for (const token of [
  "artifact",
  "processing_run",
  "face_identity",
  "face_observation"
]) {
  assertIncludes(memoryRoutes, token, "Memory route source refs");
}

for (const token of [
  "unified search",
  "context preview",
  "manual memory",
  "face identity",
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
  for (const [label, content] of Object.entries({ app, api, types, styles, uiDocs })) {
    assert(!content.includes(marker), `${label} must not include ${marker}.`);
  }
}

console.log("Web UI insights workspace validated.");
