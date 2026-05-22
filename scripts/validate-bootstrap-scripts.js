import fs from "node:fs";
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
const cli = read("packages/installer/src/cli.ts");
const docs = read("docs/INSTALLER.md");

assert(rootPackage.scripts?.["bootstrap:validate"] === "node scripts/validate-bootstrap-scripts.js", "Root package must expose bootstrap:validate.");
assert(installerPackage.bin?.["mindory-installer"] === "./dist/cli.js", "@mindory/installer must expose the mindory-installer bin.");

for (const token of [
  "#!/usr/bin/env sh",
  "MINDORY_HOME",
  "install/downloads",
  "install/releases",
  "MINDORY_RELEASE_MANIFEST_URL",
  "MINDORY_RELEASE_BUNDLE_SHA256",
  "sha256_file",
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
  "Get-FileHash -Algorithm SHA256",
  "tar -xzf",
  "$Source",
  "packages/installer/dist/cli.js",
  "pnpm --filter"
]) {
  assert(powershell.includes(token), `install.ps1 must include ${token}.`);
}

for (const token of ["createReadlineWizardIo", "runInstallWizard", "render-defaults", "dry-run", "mindory-installer"]) {
  assert(cli.includes(token), `Installer CLI must include ${token}.`);
}

for (const token of ["install.sh", "install.ps1", "checksum", "MINDORY_HOME", "--source"]) {
  assert(docs.includes(token), `Installer docs must mention ${token}.`);
}

const syntax = spawnSync("sh", ["-n", "install.sh"], {
  cwd: root,
  encoding: "utf8"
});
assert((syntax.status ?? 1) === 0, `install.sh must pass sh -n: ${syntax.stderr}`);

console.log("Bootstrap scripts validated.");
