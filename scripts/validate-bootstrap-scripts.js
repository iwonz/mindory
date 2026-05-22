import fs from "node:fs";
import crypto from "node:crypto";
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

const rootPackage = readJson("package.json");
const installerPackage = readJson("packages/installer/package.json");
const shell = read("install.sh");
const powershell = read("install.ps1");
const bundleBuilder = read("scripts/build-release-bundle.js");
const cli = read("packages/installer/src/cli.ts");
const docs = read("docs/INSTALLER.md");

assert(rootPackage.scripts?.["bootstrap:validate"] === "node scripts/validate-bootstrap-scripts.js", "Root package must expose bootstrap:validate.");
assert(rootPackage.scripts?.["release:bundle"] === "node scripts/build-release-bundle.js", "Root package must expose release:bundle.");
assert(installerPackage.bin?.["mindory-installer"] === "./dist/cli.js", "@mindory/installer must expose the mindory-installer bin.");

for (const token of [
  "#!/usr/bin/env sh",
  "MINDORY_HOME",
  "install/downloads",
  "install/releases",
  "MINDORY_RELEASE_MANIFEST_URL",
  "MINDORY_RELEASE_BUNDLE_SHA256",
  "copy_or_fetch_file",
  "sha256_file",
  "stage_release",
  ".staging.$$",
  "trap on_interrupt INT TERM",
  "repair command",
  "tar -xzf",
  "--source",
  "packages/installer/dist/cli.js",
  "pnpm --filter @mindory/installer typecheck"
]) {
  assert(shell.includes(token), `install.sh must include ${token}.`);
}

for (const token of [
  "param(",
  "$MindoryHome",
  "install/downloads",
  "install/releases",
  "MINDORY_RELEASE_MANIFEST_URL",
  "MINDORY_RELEASE_BUNDLE_SHA256",
  "Copy-OrDownload",
  "Get-FileHash -Algorithm SHA256",
  "Expand-MindoryRelease",
  ".staging.$PID",
  "trap {",
  "repair command",
  "tar -xzf",
  "$Source",
  "packages/installer/dist/cli.js",
  "pnpm --filter"
]) {
  assert(powershell.includes(token), `install.ps1 must include ${token}.`);
}

for (const token of [
  "Mindory release bundle builder",
  "deploy/compose/release-manifest.json",
  "MINDORY_RELEASE_VERSION",
  "MINDORY_RELEASE_BUNDLE_URL",
  "MINDORY_RELEASE_BUNDLE_SHA256",
  "pathToFileURL",
  "tar",
  "node_modules",
  "dist"
]) {
  assert(bundleBuilder.includes(token), `build-release-bundle.js must include ${token}.`);
}

for (const token of ["createReadlineWizardIo", "runInstallWizard", "render-defaults", "dry-run", "resume", "repair", "acquireInstallLock", "formatInstallerDiagnostic", "SIGINT", "mindory-installer"]) {
  assert(cli.includes(token), `Installer CLI must include ${token}.`);
}

for (const token of ["install.sh", "install.ps1", "checksum", "MINDORY_HOME", "--source", "release:bundle", "file://", "staging"]) {
  assert(docs.includes(token), `Installer docs must mention ${token}.`);
}

const syntax = spawnSync("sh", ["-n", "install.sh"], {
  cwd: root,
  encoding: "utf8"
});
assert((syntax.status ?? 1) === 0, `install.sh must pass sh -n: ${syntax.stderr}`);

const bundleOut = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-release-validate-"));
try {
  const bundle = spawnSync(process.execPath, [
    "scripts/build-release-bundle.js",
    "--version",
    "0.0.0-bootstrap-validate",
    "--out",
    bundleOut
  ], {
    cwd: root,
    encoding: "utf8"
  });
  assert((bundle.status ?? 1) === 0, `release bundle builder must run: ${bundle.stderr || bundle.stdout}`);

  const bundlePath = path.join(bundleOut, "mindory-0.0.0-bootstrap-validate.tar.gz");
  const manifestPath = path.join(bundleOut, "mindory-0.0.0-bootstrap-validate.manifest.env");
  assert(fs.existsSync(bundlePath), "release bundle builder must write the tar.gz bundle.");
  assert(fs.existsSync(manifestPath), "release bundle builder must write the env manifest.");

  const manifest = fs.readFileSync(manifestPath, "utf8");
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex");
  assert(manifest.includes(`MINDORY_RELEASE_BUNDLE_SHA256=${checksum}`), "release manifest checksum must match the bundle.");
  assert(manifest.includes("MINDORY_RELEASE_BUNDLE_URL=file://"), "release manifest must default to a local file URL.");
} finally {
  fs.rmSync(bundleOut, { recursive: true, force: true });
}

console.log("Bootstrap scripts validated.");
