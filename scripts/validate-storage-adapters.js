import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "packages/core/src/storage.ts",
  "packages/storage/local-fs/src/index.ts",
  "packages/storage/s3/src/index.ts"
];

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

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `${file} is required.`);
}

const rootPackage = readJson("package.json");
const corePackage = readJson("packages/core/package.json");
const localFsPackage = readJson("packages/storage/local-fs/package.json");
const s3Package = readJson("packages/storage/s3/package.json");
const localFsTsconfig = readJson("packages/storage/local-fs/tsconfig.json");
const s3Tsconfig = readJson("packages/storage/s3/tsconfig.json");
const core = read("packages/core/src/storage.ts");
const localFs = read("packages/storage/local-fs/src/index.ts");
const s3 = read("packages/storage/s3/src/index.ts");

assert(rootPackage.scripts?.["storage:validate"]?.includes("scripts/validate-storage-adapters.js"), "Root package must expose storage:validate.");

assert(corePackage.exports?.["./storage"], "@mindory/core must export ./storage.");
for (const symbol of ["ObjectStorage", "PutObjectInput", "StoredObject", "StoredObjectBody", "StorageError"]) {
  assert(core.includes(symbol), `@mindory/core storage contract must define ${symbol}.`);
}
for (const method of ["putObject", "getObject", "statObject", "objectExists", "deleteObject"]) {
  assert(core.includes(`${method}(`), `ObjectStorage must include ${method}.`);
}

assert(localFsPackage.dependencies?.["@mindory/core"] === "workspace:*", "local-fs adapter must depend on @mindory/core.");
assert(s3Package.dependencies?.["@mindory/core"] === "workspace:*", "S3 adapter must depend on @mindory/core.");
assert(localFsPackage.exports?.["."], "local-fs adapter must export its root module.");
assert(s3Package.exports?.["."], "S3 adapter must export its root module.");
assert(localFsTsconfig.references?.some((reference) => reference.path === "../../../packages/core"), "local-fs tsconfig must reference @mindory/core.");
assert(s3Tsconfig.references?.some((reference) => reference.path === "../../../packages/core"), "S3 tsconfig must reference @mindory/core.");

for (const symbol of ["LocalFsObjectStorage", "resolveLocalStorageKey"]) {
  assert(localFs.includes(symbol), `local-fs adapter must define ${symbol}.`);
}
for (const token of ["path.isAbsolute(key)", "segment === \"..\"", "path.relative", "createReadStream", "createWriteStream", "metadataPath", "object_not_found"]) {
  assert(localFs.includes(token), `local-fs adapter must include ${token}.`);
}

for (const symbol of ["S3ObjectStorageOptions", "S3ObjectStorage"]) {
  assert(s3.includes(symbol), `S3 adapter must define ${symbol}.`);
}
for (const token of ["authorizationHeader", "AWS4-HMAC-SHA256", "x-amz-content-sha256", "normalizeS3Key", "ensureBucket", "checkBucketAccess", "object_not_found", "Readable.fromWeb"]) {
  assert(s3.includes(token), `S3 adapter must include ${token}.`);
}
assert(!s3.includes("storage_" + "not" + "_implemented"), "S3 adapter must remain fully implemented.");
assert(!s3.includes("@aws-sdk/client-s3"), "S3 adapter should not depend on a cloud SDK for the MVP.");

const smoke = spawnSync(process.execPath, ["scripts/smoke-s3-storage.js"], {
  cwd: root,
  stdio: "inherit"
});
assert((smoke.status ?? 1) === 0, "S3-compatible storage smoke scenario must pass.");

console.log("Object storage adapters validated.");
