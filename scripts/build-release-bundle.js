import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    outDir: path.join(root, "dist", "releases"),
    urlBase: "",
    version: process.env.MINDORY_RELEASE_VERSION ?? ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--out") {
      options.outDir = path.resolve(argv[++index] ?? "");
    } else if (arg === "--url-base") {
      options.urlBase = argv[++index] ?? "";
    } else if (arg === "--version") {
      options.version = argv[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  console.log(`Mindory release bundle builder

Usage:
  node scripts/build-release-bundle.js --version <version> [--out <dir>] [--url-base <url>]

Outputs:
  mindory-<version>.tar.gz
  mindory-<version>.manifest.env

When --url-base is omitted, the manifest points at the local file:// bundle.
`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateVersion(version) {
  assert(version, "Release version is required. Pass --version or set MINDORY_RELEASE_VERSION.");
  assert(/^[0-9A-Za-z._+-]+$/.test(version), `Release version contains unsupported characters: ${version}`);
}

function copyEntry(relativePath, bundleRoot) {
  const source = path.join(root, relativePath);
  const target = path.join(bundleRoot, relativePath);
  assert(fs.existsSync(source), `Release bundle entry does not exist: ${relativePath}`);
  fs.cpSync(source, target, {
    recursive: true,
    dereference: false,
    filter: shouldCopy
  });
}

function shouldCopy(sourcePath) {
  const relative = path.relative(root, sourcePath);
  const parts = relative.split(path.sep);
  if (relative.endsWith(".tsbuildinfo")) {
    return false;
  }
  if (isAllowedBuildOutput(relative)) {
    return true;
  }
  if (parts.some((part) => ignoredPathNames.has(part))) {
    return false;
  }
  return true;
}

function isAllowedBuildOutput(relativePath) {
  return allowedBuildOutputRoots.some((allowedRoot) => {
    return relativePath === allowedRoot || relativePath.startsWith(`${allowedRoot}${path.sep}`);
  });
}

function buildInstallerArtifacts() {
  const result = spawnSync("pnpm", ["--filter", "@mindory/storage-s3", "--filter", "@mindory/installer", "typecheck"], {
    cwd: root,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Failed to build installer artifacts: ${result.stderr || result.stdout}`);
  }
}

function createPackagedEntrypoints(bundleRoot) {
  const installerCli = path.join(bundleRoot, "packages", "installer", "dist", "cli.js");
  assert(fs.existsSync(installerCli), "Release bundle is missing packages/installer/dist/cli.js.");

  const binDir = path.join(bundleRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const launcher = [
    "#!/usr/bin/env sh",
    "set -eu",
    "ROOT_DIR=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")/..\" && pwd)\"",
    "exec node \"$ROOT_DIR/packages/installer/dist/cli.js\" \"$@\"",
    ""
  ].join("\n");
  const launcherPath = path.join(binDir, "mindory-installer");
  fs.writeFileSync(launcherPath, launcher, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(launcherPath, 0o755);

  const scopeDir = path.join(bundleRoot, "node_modules", "@mindory");
  fs.mkdirSync(scopeDir, { recursive: true });
  for (const packagePath of packagedWorkspacePackages) {
    const packageRoot = path.join(bundleRoot, packagePath);
    const packageJson = readJson(path.join(packagePath, "package.json"));
    const packageName = packageJson.name.split("/").at(-1);
    assert(typeof packageName === "string" && packageName.length > 0, `Release bundle package ${packagePath} has an invalid name.`);
    assert(fs.existsSync(path.join(packageRoot, "dist", "index.js")) || fs.existsSync(path.join(packageRoot, "dist", "storage.js")), `Release bundle is missing built dist output for ${packagePath}.`);
    fs.cpSync(packageRoot, path.join(scopeDir, packageName), { recursive: true });
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function tarGzip(stagingParent, bundleName, bundlePath) {
  const result = spawnSync("tar", ["-czf", bundlePath, "-C", stagingParent, bundleName], {
    cwd: root,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`tar failed while creating ${bundlePath}: ${result.stderr || result.stdout}`);
  }
}

function writeManifest({ manifestPath, version, bundleUrl, checksum, bundleName }) {
  const content = [
    "# Mindory release manifest",
    `MINDORY_RELEASE_VERSION=${version}`,
    `MINDORY_RELEASE_BUNDLE_URL=${bundleUrl}`,
    `MINDORY_RELEASE_BUNDLE_SHA256=${checksum}`,
    `MINDORY_RELEASE_BUNDLE_NAME=${bundleName}.tar.gz`,
    `MINDORY_RELEASE_CREATED_AT=${new Date().toISOString()}`,
    ""
  ].join(os.EOL);
  fs.writeFileSync(manifestPath, content, "utf8");
}

function validateReleaseAssets() {
  const manifest = readJson("deploy/compose/release-manifest.json");
  for (const asset of manifest.assets ?? []) {
    if (asset.required) {
      assert(fs.existsSync(path.join(root, asset.path)), `Required release asset is missing: ${asset.path}`);
    }
  }
}

const ignoredPathNames = new Set([
  ".git",
  ".mindory-demo",
  ".turbo",
  "coverage",
  "dist",
  "node_modules"
]);

const allowedBuildOutputRoots = [
  path.join("packages", "core", "dist"),
  path.join("packages", "config", "dist"),
  path.join("packages", "installer", "dist"),
  path.join("packages", "storage", "s3", "dist")
];

const packagedWorkspacePackages = [
  "packages/config",
  "packages/core",
  "packages/storage/s3"
];

const releaseEntries = [
  "AGENTS.md",
  "PRD.md",
  "README.md",
  ".env.example",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.override.yml",
  "docker-compose.test.yml",
  "install.sh",
  "install.ps1",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "apps",
  "deploy",
  "docs",
  "fixtures",
  "packages",
  "scripts",
  "tasks"
];

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}

validateVersion(options.version);
validateReleaseAssets();
buildInstallerArtifacts();

const bundleName = `mindory-${options.version}`;
const stagingParent = fs.mkdtempSync(path.join(os.tmpdir(), `${bundleName}-bundle-`));
const bundleRoot = path.join(stagingParent, bundleName);
const outDir = options.outDir;
const bundlePath = path.join(outDir, `${bundleName}.tar.gz`);
const manifestPath = path.join(outDir, `${bundleName}.manifest.env`);

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(bundleRoot, { recursive: true });

try {
  for (const entry of releaseEntries) {
    copyEntry(entry, bundleRoot);
  }
  createPackagedEntrypoints(bundleRoot);

  tarGzip(stagingParent, bundleName, bundlePath);
  const checksum = sha256File(bundlePath);
  const bundleUrl = options.urlBase
    ? `${options.urlBase.replace(/\/$/, "")}/${path.basename(bundlePath)}`
    : pathToFileURL(bundlePath).href;

  writeManifest({
    manifestPath,
    version: options.version,
    bundleUrl,
    checksum,
    bundleName
  });

  console.log(JSON.stringify({
    bundle: bundlePath,
    manifest: manifestPath,
    sha256: checksum,
    version: options.version
  }, null, 2));
} finally {
  fs.rmSync(stagingParent, { recursive: true, force: true });
}
