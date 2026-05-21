import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const workspaces = [
  ["apps/api", "@mindory/api"],
  ["apps/mcp", "@mindory/mcp"],
  ["apps/cli", "@mindory/cli"],
  ["apps/worker", "@mindory/worker"],
  ["apps/adapters/hermes", "@mindory/adapter-hermes"],
  ["packages/core", "@mindory/core"],
  ["packages/db", "@mindory/db"],
  ["packages/sdk", "@mindory/sdk"],
  ["packages/config", "@mindory/config"],
  ["packages/model-runtime", "@mindory/model-runtime"],
  ["packages/auth", "@mindory/auth"],
  ["packages/storage/local-fs", "@mindory/storage-local-fs"],
  ["packages/storage/s3", "@mindory/storage-s3"],
  ["packages/queue/bullmq", "@mindory/queue-bullmq"],
  ["packages/vector/pgvector", "@mindory/vector-pgvector"],
  ["packages/vector/qdrant", "@mindory/vector-qdrant"],
  ["packages/processors/antivirus-clamav", "@mindory/processor-antivirus-clamav"],
  ["packages/processors/extractors/builtin-text", "@mindory/extractor-builtin-text"],
  ["packages/processors/extractors/docling", "@mindory/extractor-docling"],
  ["packages/processors/embeddings/openai-compatible", "@mindory/embeddings-openai-compatible"],
  ["packages/processors/embeddings/ollama", "@mindory/embeddings-ollama"],
  ["packages/observability", "@mindory/observability"]
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read valid JSON from ${relativePath}: ${error.message}`);
  }
}

assert(fs.existsSync(path.join(root, "pnpm-workspace.yaml")), "pnpm-workspace.yaml is required.");
assert(fs.existsSync(path.join(root, "tsconfig.base.json")), "tsconfig.base.json is required.");
assert(fs.existsSync(path.join(root, "tsconfig.json")), "root tsconfig.json is required.");

const rootPackage = readJson("package.json");
assert(rootPackage.private === true, "root package.json must be private.");
assert(rootPackage.packageManager?.startsWith("pnpm@"), "root package.json must declare pnpm as packageManager.");

const rootTsconfig = readJson("tsconfig.json");
const referencePaths = new Set((rootTsconfig.references ?? []).map((reference) => reference.path));

for (const [workspacePath, packageName] of workspaces) {
  const packageJson = readJson(`${workspacePath}/package.json`);
  const tsconfig = readJson(`${workspacePath}/tsconfig.json`);
  assert(packageJson.name === packageName, `${workspacePath}/package.json has wrong package name.`);
  assert(packageJson.private === true, `${workspacePath}/package.json must be private during bootstrap.`);
  assert(packageJson.type === "module", `${workspacePath}/package.json must use ESM.`);
  assert(tsconfig.extends === path.relative(workspacePath, "tsconfig.base.json"), `${workspacePath}/tsconfig.json must extend tsconfig.base.json.`);
  assert(referencePaths.has(workspacePath), `root tsconfig.json must reference ${workspacePath}.`);
  assert(fs.existsSync(path.join(root, workspacePath, "src/index.ts")), `${workspacePath}/src/index.ts is required.`);
}

console.log(`Validated ${workspaces.length} workspace package(s).`);
