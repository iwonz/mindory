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
const documentRoutes = read("apps/api/src/routes/documents.ts");
const apiDocs = read("docs/API.md");
const uiDocs = read("docs/UI.md");
const readme = read("README.md");
const checkRepo = read("scripts/check-repo.js");

assert(rootPackage.scripts?.["ui:documents:validate"] === "node scripts/validate-ui-document-workspace.js", "Root package must expose ui:documents:validate.");
assertIncludes(checkRepo, "ui:documents:validate", "Repository check list");

for (const token of [
  "listDocuments",
  "uploadDocument",
  "getDocument",
  "listProcessingRuns",
  "listDocumentArtifacts",
  "recomputeDocument",
  "listJobs",
  "retryJob",
  "/v1/documents",
  "/v1/jobs"
]) {
  assertIncludes(api, token, "UI API client");
}

for (const token of [
  "DocumentRecord",
  "UploadDocumentResponse",
  "ProcessingRun",
  "DocumentArtifact",
  "ProcessingJob",
  "source_refs"
]) {
  assertIncludes(types, token, "UI types");
}

for (const token of [
  "renderDocumentWorkspace",
  "renderDocumentListPanel",
  "renderDocumentDetailPanel",
  "renderArtifactPanel",
  "uploadSelectedDocument",
  "recomputeSelectedDocument",
  "retryDocumentJob",
  "Document file",
  "Processing runs",
  "Source refs"
]) {
  assertIncludes(app, token, "UI document workspace");
}

for (const token of [
  ".document-grid",
  ".upload-form",
  ".artifact-card",
  ".job-card",
  ".status-pill",
  ".source-refs"
]) {
  assertIncludes(styles, token, "UI document workspace styles");
}

for (const token of [
  '"/v1/documents/:id/artifacts"',
  "listDocumentArtifacts",
  "toDocumentArtifactResponse",
  "artifactRepository.listDocumentArtifacts"
]) {
  assertIncludes(documentRoutes, token, "Document API routes");
}

for (const token of [
  "GET  /v1/documents/:id/artifacts",
  "document pipeline workspace",
  "upload",
  "retry",
  "reprocess"
]) {
  assertIncludes(uiDocs + apiDocs + readme, token, "public documentation");
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

console.log("Web UI document pipeline workspace validated.");
