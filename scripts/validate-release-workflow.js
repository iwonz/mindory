import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8"
  });
  assert((result.status ?? 1) === 0, `${label} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

const rootPackage = readJson("package.json");
const checkRepo = read("scripts/check-repo.js");
const releaseWorkflow = read(".github/workflows/release.yml");
const smokeScript = read("scripts/smoke-release-install.js");
const deployment = read("docs/DEPLOYMENT.md");
const production = read("docs/PRODUCTION_HARDENING.md");
const changelog = read("CHANGELOG.md");

assert(rootPackage.scripts?.["release:validate"] === "node scripts/validate-release-workflow.js", "Root package must expose release:validate.");
assertIncludes(checkRepo, "release:validate", "scripts/check-repo.js");

for (const token of [
  "workflow_dispatch:",
  "tags:",
  "permissions:",
  "contents: write",
  "packages: write",
  "pnpm check",
  "docker build",
  "pnpm release:bundle",
  "sha256sum",
  "smoke-release-install.js",
  "actions/upload-artifact@v4",
  "gh release"
]) {
  assertIncludes(releaseWorkflow, token, ".github/workflows/release.yml");
}

for (const token of [
  "MINDORY_RELEASE_VERSION",
  "MINDORY_RELEASE_BUNDLE_URL",
  "MINDORY_RELEASE_BUNDLE_SHA256",
  "bin/mindory-installer",
  "release_smoke_passed",
  "tar"
]) {
  assertIncludes(smokeScript, token, "scripts/smoke-release-install.js");
}

for (const token of ["Release Workflow", "release:bundle", "release:validate", "smoke-release-install"]) {
  assertIncludes(deployment, token, "docs/DEPLOYMENT.md");
  assertIncludes(production, token, "docs/PRODUCTION_HARDENING.md");
}
assertIncludes(changelog, "TASK-71", "CHANGELOG.md");

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-release-validate-"));
try {
  runNode([
    "scripts/build-release-bundle.js",
    "--version",
    "0.0.0-release-validate",
    "--out",
    outDir
  ], "release bundle generation");

  const bundlePath = path.join(outDir, "mindory-0.0.0-release-validate.tar.gz");
  const manifestPath = path.join(outDir, "mindory-0.0.0-release-validate.manifest.env");
  assert(fs.existsSync(bundlePath), "release validation must generate a bundle.");
  assert(fs.existsSync(manifestPath), "release validation must generate a manifest.");
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex");
  assert(fs.readFileSync(manifestPath, "utf8").includes(checksum), "release manifest must include the generated bundle checksum.");

  runNode([
    "scripts/smoke-release-install.js",
    "--manifest",
    manifestPath,
    "--home",
    path.join(outDir, "home")
  ], "release install smoke");
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}

console.log("Release workflow validated.");
