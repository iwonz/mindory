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

function assertNotIncludes(content, token, label) {
  assert(!content.includes(token), `${label} must not include ${token}.`);
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8"
  });
  assert((result.status ?? 1) === 0, `${label} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function runNodeExpectFailure(args, label, expectedDiagnostic) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8"
  });
  assert((result.status ?? 0) !== 0, `${label} must fail.`);
  const output = `${result.stderr}\n${result.stdout}`;
  assert(output.includes(expectedDiagnostic), `${label} must report ${expectedDiagnostic}. Output: ${output}`);
}

const rootPackage = readJson("package.json");
const checkRepo = read("scripts/check-repo.js");
const releaseWorkflow = read(".github/workflows/release.yml");
const smokeScript = read("scripts/smoke-release-install.js");
const releaseNotesScript = read("scripts/generate-release-notes.js");
const deployment = read("docs/DEPLOYMENT.md");
const production = read("docs/PRODUCTION_HARDENING.md");
const changelog = read("CHANGELOG.md");

assert(rootPackage.scripts?.["release:validate"] === "node scripts/validate-release-workflow.js", "Root package must expose release:validate.");
assert(rootPackage.scripts?.["release:notes"] === "node scripts/generate-release-notes.js", "Root package must expose release:notes.");
assertIncludes(checkRepo, "release:validate", "scripts/check-repo.js");

for (const token of [
  "workflow_dispatch:",
  "tags:",
  "permissions:",
  "contents: write",
  "packages: write",
  "pnpm check",
  "docker build",
  "docker/login-action@v3",
  "docker push",
  "pnpm release:bundle",
  "sha256sum",
  "MINDORY_RELEASE_SIGNING_PRIVATE_KEY_PEM",
  "generate-release-notes.js",
  "release-notes.md",
  "smoke-release-install.js",
  "actions/upload-artifact@v4",
  "gh release edit",
  "--draft=false",
  "--prerelease",
  "gh release upload"
]) {
  assertIncludes(releaseWorkflow, token, ".github/workflows/release.yml");
}
assertNotIncludes(releaseWorkflow, "gh release create \"$TAG\" --draft", ".github/workflows/release.yml");
assertNotIncludes(releaseWorkflow, "gh release edit \"$TAG\" --draft=true", ".github/workflows/release.yml");

for (const token of [
  "MINDORY_RELEASE_VERSION",
  "MINDORY_RELEASE_BUNDLE_URL",
  "MINDORY_RELEASE_BUNDLE_SHA256",
  "MINDORY_RELEASE_MANIFEST_SIGNATURE",
  "MINDORY_RELEASE_PUBLIC_KEY_SHA256",
  "bin/mindory-installer",
  "release_smoke_passed",
  "tar"
]) {
  assertIncludes(smokeScript, token, "scripts/smoke-release-install.js");
}

for (const token of ["Support Matrix", "Upgrade Notes", "Public Release Checklist", "Docker Images", "Release Artifacts", "Changelog Excerpt"]) {
  assertIncludes(releaseNotesScript, token, "scripts/generate-release-notes.js");
}

for (const token of ["Release Workflow", "release:bundle", "release:validate", "smoke-release-install", "pre-release"]) {
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
  const publicKeyPath = `${manifestPath}.public.pem`;
  assert(fs.existsSync(bundlePath), "release validation must generate a bundle.");
  assert(fs.existsSync(manifestPath), "release validation must generate a manifest.");
  assert(fs.existsSync(publicKeyPath), "release validation must generate a manifest public key.");
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex");
  const manifest = fs.readFileSync(manifestPath, "utf8");
  assert(manifest.includes(checksum), "release manifest must include the generated bundle checksum.");
  assert(manifest.includes("MINDORY_RELEASE_MANIFEST_SIGNATURE="), "release manifest must include a signature.");
  assert(manifest.includes("MINDORY_RELEASE_PUBLIC_KEY_SHA256="), "release manifest must include a public key fingerprint.");

  runNode([
    "scripts/smoke-release-install.js",
    "--manifest",
    manifestPath,
    "--public-key",
    publicKeyPath,
    "--home",
    path.join(outDir, "home")
  ], "release install smoke");

  const releaseNotesPath = path.join(outDir, "mindory-0.0.0-release-validate.release-notes.md");
  runNode([
    "scripts/generate-release-notes.js",
    "--version",
    "0.0.0-release-validate",
    "--tag",
    "v0.0.0-release-validate",
    "--image",
    "ghcr.io/example/mindory:0.0.0-release-validate",
    "--sha-image",
    "ghcr.io/example/mindory:abcdef123456",
    "--out",
    releaseNotesPath
  ], "release notes generation");
  const releaseNotes = fs.readFileSync(releaseNotesPath, "utf8");
  for (const token of ["Support Matrix", "Upgrade Notes", "Public Release Checklist", "GitHub Pre-release", "ghcr.io/example/mindory:0.0.0-release-validate", "mindory-0.0.0-release-validate.manifest.env.public.pem"]) {
    assertIncludes(releaseNotes, token, "generated release notes");
  }

  const tamperedManifestPath = path.join(outDir, "mindory-0.0.0-release-validate.tampered.manifest.env");
  fs.writeFileSync(tamperedManifestPath, manifest.replace("MINDORY_RELEASE_VERSION=0.0.0-release-validate", "MINDORY_RELEASE_VERSION=0.0.0-release-tampered"), "utf8");
  runNodeExpectFailure([
    "scripts/smoke-release-install.js",
    "--manifest",
    tamperedManifestPath,
    "--public-key",
    publicKeyPath,
    "--home",
    path.join(outDir, "tampered-manifest-home")
  ], "tampered manifest smoke", "Manifest signature verification failed");

  fs.appendFileSync(bundlePath, "tampered artifact bytes");
  runNodeExpectFailure([
    "scripts/smoke-release-install.js",
    "--manifest",
    manifestPath,
    "--public-key",
    publicKeyPath,
    "--home",
    path.join(outDir, "tampered-artifact-home")
  ], "tampered artifact smoke", "Checksum mismatch");
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}

console.log("Release workflow validated.");
