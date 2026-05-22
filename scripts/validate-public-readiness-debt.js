import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scannedRoots = [
  "apps",
  "packages",
  "scripts",
  "docs",
  "README.md",
  "docker-compose.yml",
  ".env.example"
];

const ignoredPathParts = [
  "/dist/",
  "/node_modules/",
  "/.next/",
  "/coverage/"
];

const ignoredFiles = new Set([
  "scripts/validate-public-readiness-debt.js"
]);

const markerPattern = /\b(?:TODO|FIXME|XXX|HACK)\b|from a later task|not_implemented|notImplemented\(|placeholder|skeleton|future work|smoke-only/i;

const debtOwners = new Map(Object.entries({
  "README.md": { owner: "TASK-113", max: 5 },
  "docker-compose.yml": { owner: "TASK-92", max: 1 },
  "docs/API.md": { owner: "TASK-89", max: 8 },
  "docs/ARCHITECTURE.md": { owner: "TASK-111", max: 10 },
  "docs/CONFIGURATION.md": { owner: "TASK-111", max: 3 },
  "docs/DATABASE.md": { owner: "TASK-89", max: 1 },
  "docs/DEPLOYMENT.md": { owner: "TASK-110", max: 1 },
  "docs/DEVELOPMENT_PROCESS.md": { owner: "TASK-89", max: 1 },
  "docs/DOCUMENT_PIPELINE.md": { owner: "TASK-100", max: 3 },
  "docs/HERMES_ADAPTER.md": { owner: "TASK-111", max: 1 },
  "docs/INSTALLER.md": { owner: "TASK-110", max: 3 },
  "docs/LLM.md": { owner: "TASK-99", max: 1 },
  "docs/OBSERVABILITY.md": { owner: "TASK-102", max: 1 },
  "docs/PRD.md": { owner: "TASK-113", max: 14 },
  "docs/PRODUCTION_HARDENING.md": { owner: "TASK-110", max: 2 },
  "docs/REPOSITORY_STATUS.md": { owner: "TASK-111", max: 5 },
  "docs/SUPPORT_MATRIX.md": { owner: "TASK-111", max: 6 },
  "docs/WORKERS.md": { owner: "TASK-89", max: 1 },
  "apps/api/src/auth.ts": { owner: "TASK-88", max: 6 },
  "apps/api/src/errors.ts": { owner: "TASK-88", max: 2 },
  "apps/api/src/routes/artifacts.ts": { owner: "TASK-88", max: 1 },
  "apps/api/src/routes/context.ts": { owner: "TASK-88", max: 1 },
  "apps/api/src/routes/documents.ts": { owner: "TASK-88", max: 7 },
  "apps/api/src/routes/faces.ts": { owner: "TASK-88", max: 1 },
  "apps/api/src/routes/jobs.ts": { owner: "TASK-88", max: 3 },
  "apps/api/src/routes/memories.ts": { owner: "TASK-88", max: 5 },
  "apps/api/src/routes/peers.ts": { owner: "TASK-88", max: 3 },
  "apps/api/src/routes/projects.ts": { owner: "TASK-88", max: 3 },
  "apps/api/src/routes/search.ts": { owner: "TASK-88", max: 1 },
  "apps/api/src/routes/sessions.ts": { owner: "TASK-88", max: 5 },
  "apps/api/src/routes/tokens.ts": { owner: "TASK-88", max: 1 },
  "packages/auth/src/index.ts": { owner: "TASK-88", max: 7 },
  "packages/core/src/document-routing.ts": { owner: "TASK-98", max: 2 },
  "packages/core/src/documents.ts": { owner: "TASK-94", max: 3 },
  "packages/core/src/processing.ts": { owner: "TASK-90", max: 1 },
  "packages/core/src/queue.ts": { owner: "TASK-88", max: 1 },
  "packages/core/src/storage.ts": { owner: "TASK-88", max: 1 },
  "packages/vector/qdrant/src/index.ts": { owner: "TASK-90", max: 6 },
  "scripts/check-repo.js": { owner: "TASK-88", max: 1 },
  "scripts/docker-placeholder-service.mjs": { owner: "TASK-92", max: 7 },
  "scripts/validate-api-skeleton.js": { owner: "TASK-88", max: 4 },
  "scripts/validate-compose.js": { owner: "TASK-92", max: 3 },
  "scripts/validate-db-repositories.js": { owner: "TASK-88", max: 2 },
  "scripts/validate-document-pipeline.js": { owner: "TASK-98", max: 2 },
  "scripts/validate-mcp-server.js": { owner: "TASK-89", max: 1 },
  "scripts/validate-memory-context.js": { owner: "TASK-88", max: 2 },
  "scripts/validate-processing-pipeline.js": { owner: "TASK-90", max: 3 },
  "scripts/validate-public-github-hygiene.js": { owner: "TASK-89", max: 1 },
  "scripts/validate-storage-adapters.js": { owner: "TASK-89", max: 1 }
}));

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toRelative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function shouldIgnore(relativePath) {
  if (ignoredFiles.has(relativePath)) {
    return true;
  }
  const normalized = `/${relativePath}`;
  return ignoredPathParts.some((part) => normalized.includes(part));
}

function collectFiles(target) {
  const absoluteTarget = path.join(root, target);
  if (!fs.existsSync(absoluteTarget)) {
    return [];
  }
  const stats = fs.statSync(absoluteTarget);
  if (stats.isFile()) {
    return [absoluteTarget];
  }
  const files = [];
  for (const entry of fs.readdirSync(absoluteTarget, { withFileTypes: true })) {
    const entryPath = path.join(absoluteTarget, entry.name);
    const relativePath = toRelative(entryPath);
    if (shouldIgnore(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...collectFiles(relativePath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function countMarkers(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return content.split(/\r?\n/).filter((line) => markerPattern.test(line)).length;
}

const registry = readJson("tasks/tasks.json");
const tasks = new Map(registry.tasks.map((task) => [task.id, task]));
for (const taskId of Array.from({ length: 27 }, (_, index) => `TASK-${87 + index}`)) {
  assert(tasks.has(taskId), `${taskId} must be registered in tasks/tasks.json.`);
  assert(fs.existsSync(path.join(root, `tasks/${taskId}.json`)), `${taskId} must have a dedicated task file.`);
}

const counts = new Map();
for (const target of scannedRoots) {
  for (const filePath of collectFiles(target)) {
    const relativePath = toRelative(filePath);
    if (shouldIgnore(relativePath)) {
      continue;
    }
    const count = countMarkers(filePath);
    if (count > 0) {
      counts.set(relativePath, count);
    }
  }
}

const failures = [];

for (const [relativePath, count] of counts) {
  const debt = debtOwners.get(relativePath);
  if (!debt) {
    failures.push(`${relativePath} contains ${count} untracked temporary marker(s).`);
    continue;
  }
  const ownerTask = tasks.get(debt.owner);
  if (!ownerTask) {
    failures.push(`${relativePath} is assigned to missing ${debt.owner}.`);
    continue;
  }
  if (count > debt.max) {
    failures.push(`${relativePath} contains ${count} marker(s), above tracked maximum ${debt.max} for ${debt.owner}.`);
  }
  if (ownerTask.status === "done") {
    failures.push(`${relativePath} still contains ${count} marker(s), but owner ${debt.owner} is done.`);
  }
}

for (const [relativePath, debt] of debtOwners) {
  assert(tasks.has(debt.owner), `${relativePath} is assigned to missing ${debt.owner}.`);
}

if (failures.length > 0) {
  console.error("Public readiness debt validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated public readiness debt: ${counts.size} tracked file(s), no untracked markers.`);
