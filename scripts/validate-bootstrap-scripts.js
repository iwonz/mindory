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

function runBootstrap(args, env, label) {
  return spawnSync("sh", ["install.sh", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

function assertBootstrapFailure(result, label, expectedDiagnostic) {
  assert((result.status ?? 0) !== 0, `${label} must fail.`);
  const output = `${result.stderr}\n${result.stdout}`;
  assert(output.includes(expectedDiagnostic), `${label} must report ${expectedDiagnostic}. Output: ${output}`);
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
  "MINDORY_RELEASE_MANIFEST_SIGNATURE",
  "MINDORY_RELEASE_PUBLIC_KEY_SHA256",
  "verify_manifest_signature",
  "openssl dgst -sha256 -verify",
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
  "MINDORY_RELEASE_MANIFEST_SIGNATURE",
  "MINDORY_RELEASE_PUBLIC_KEY_SHA256",
  "Test-MindoryReleaseManifestSignature",
  "VerifyData",
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
  "MINDORY_RELEASE_MANIFEST_SIGNATURE",
  "MINDORY_RELEASE_PUBLIC_KEY_SHA256",
  "crypto.sign",
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

for (const token of ["install.sh", "install.ps1", "checksum", "signature", "public key", "MINDORY_HOME", "--source", "release:bundle", "file://", "staging"]) {
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
  const publicKeyPath = `${manifestPath}.public.pem`;
  assert(fs.existsSync(bundlePath), "release bundle builder must write the tar.gz bundle.");
  assert(fs.existsSync(manifestPath), "release bundle builder must write the env manifest.");
  assert(fs.existsSync(publicKeyPath), "release bundle builder must write the manifest public key.");

  const manifest = fs.readFileSync(manifestPath, "utf8");
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex");
  assert(manifest.includes(`MINDORY_RELEASE_BUNDLE_SHA256=${checksum}`), "release manifest checksum must match the bundle.");
  assert(manifest.includes("MINDORY_RELEASE_BUNDLE_URL=file://"), "release manifest must default to a local file URL.");
  assert(manifest.includes("MINDORY_RELEASE_MANIFEST_SIGNATURE= " ) === false, "release manifest signature must not be blank.");
  assert(manifest.includes("MINDORY_RELEASE_MANIFEST_SIGNATURE="), "release manifest must contain a signature.");
  assert(manifest.includes("MINDORY_RELEASE_PUBLIC_KEY_SHA256="), "release manifest must contain a public key fingerprint.");

  const verifyHome = path.join(bundleOut, "verify-home");
  const verifyResult = runBootstrap(["--manifest-path", manifestPath, "--public-key-path", publicKeyPath, "--verify-only"], {
    MINDORY_HOME: verifyHome
  }, "bootstrap verify-only");
  assert((verifyResult.status ?? 1) === 0, `bootstrap verify-only must pass: ${verifyResult.stderr || verifyResult.stdout}`);

  const tamperedManifestPath = path.join(bundleOut, "mindory-0.0.0-bootstrap-validate.tampered.manifest.env");
  fs.writeFileSync(tamperedManifestPath, manifest.replace("MINDORY_RELEASE_VERSION=0.0.0-bootstrap-validate", "MINDORY_RELEASE_VERSION=0.0.0-bootstrap-tampered"), "utf8");
  assertBootstrapFailure(runBootstrap(["--manifest-path", tamperedManifestPath, "--public-key-path", publicKeyPath, "--verify-only"], {
    MINDORY_HOME: path.join(bundleOut, "tampered-manifest-home")
  }, "tampered manifest bootstrap"), "tampered manifest bootstrap", "Manifest signature verification failed");

  fs.appendFileSync(bundlePath, "tampered artifact bytes");
  assertBootstrapFailure(runBootstrap(["--manifest-path", manifestPath, "--public-key-path", publicKeyPath, "--verify-only"], {
    MINDORY_HOME: path.join(bundleOut, "tampered-artifact-home")
  }, "tampered artifact bootstrap"), "tampered artifact bootstrap", "Checksum mismatch");
} finally {
  fs.rmSync(bundleOut, { recursive: true, force: true });
}

console.log("Bootstrap scripts validated.");
