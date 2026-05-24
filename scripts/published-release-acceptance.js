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

function truthy(value) {
  return /^(1|true|yes)$/iu.test(value ?? "");
}

function releaseDefaults() {
  const repo = process.env.MINDORY_PUBLISHED_RELEASE_REPO || "iwonz/mindory";
  const version = process.env.MINDORY_PUBLISHED_RELEASE_VERSION || "0.1.1";
  const tag = process.env.MINDORY_PUBLISHED_RELEASE_TAG || `v${version}`;
  const manifestUrl = process.env.MINDORY_PUBLISHED_RELEASE_MANIFEST_URL
    || `https://github.com/${repo}/releases/download/${tag}/mindory-${version}.manifest.env`;
  const publicKeyUrl = process.env.MINDORY_PUBLISHED_RELEASE_PUBLIC_KEY_URL
    || `${manifestUrl}.public.pem`;
  const bundleUrl = process.env.MINDORY_PUBLISHED_RELEASE_BUNDLE_URL
    || `https://github.com/${repo}/releases/download/${tag}/mindory-${version}.tar.gz`;
  const checksumUrl = process.env.MINDORY_PUBLISHED_RELEASE_CHECKSUM_URL
    || `https://github.com/${repo}/releases/download/${tag}/mindory-${version}.sha256`;
  return { repo, version, tag, manifestUrl, publicKeyUrl, bundleUrl, checksumUrl };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseChecksumFile(content) {
  const entries = new Map();
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/iu.exec(trimmed);
    assert(match, `Malformed checksum line in published release .sha256 asset: ${line}`);
    entries.set(path.basename(match[2]), match[1].toLowerCase());
  }
  return entries;
}

function verifyChecksumEntry(entries, filePath, label) {
  const name = path.basename(filePath);
  const expected = entries.get(name);
  assert(expected, `Published release checksum file is missing ${label} entry: ${name}.`);
  const actual = sha256File(filePath);
  assert(actual === expected, `Published release checksum mismatch for ${label} ${name}. Expected ${expected}, got ${actual}.`);
  return { name, sha256: actual };
}

async function downloadFile(url, outputPath, label) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Failed to download ${label} from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Failed to download ${label} from ${url}: HTTP ${response.status} ${response.statusText}. Confirm the GitHub release is public, marked as a pre-release and not left as a draft.`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
}

function run(command, args, options, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${label} failed.\n${result.stderr || result.stdout || "No output."}`);
  }
  return result.stdout;
}

function dryRun() {
  const rootPackage = readJson("package.json");
  const checkRepo = read("scripts/check-repo.js");
  const smoke = read("scripts/smoke-release-install.js");
  const publishedAcceptance = read("scripts/published-release-acceptance.js");
  const installerDocs = read("docs/INSTALLER.md");
  const deploymentDocs = read("docs/DEPLOYMENT.md");
  const releaseChecklist = read("docs/RELEASE_CHECKLIST.md");

  assert(rootPackage.scripts?.["published-release:acceptance"] === "node scripts/published-release-acceptance.js", "Root package must expose published-release:acceptance.");
  assert(checkRepo.includes("published-release:acceptance"), "pnpm check must include published-release:acceptance.");

  for (const token of ["--manifest-url", "downloadFile", "release is public", "Checksum mismatch", "release_smoke_passed"]) {
    assert(smoke.includes(token), `smoke-release-install.js must include ${token}.`);
  }

  for (const token of ["0.1.1", "checksumUrl", "verifyChecksumEntry", "Published release checksum mismatch"]) {
    assert(publishedAcceptance.includes(token), `published-release-acceptance.js must include ${token}.`);
  }

  for (const token of [
    "MINDORY_PUBLISHED_RELEASE_ACCEPTANCE_LIVE=true pnpm published-release:acceptance",
    "https://github.com/iwonz/mindory/releases/download/v0.1.1/mindory-0.1.1.manifest.env",
    "https://github.com/iwonz/mindory/releases/download/v0.1.0/mindory-0.1.0.manifest.env"
  ]) {
    assert(installerDocs.includes(token), `docs/INSTALLER.md must include ${token}.`);
  }

  assert(deploymentDocs.includes("published-release:acceptance"), "docs/DEPLOYMENT.md must document published-release:acceptance.");
  assert(releaseChecklist.includes("published-release:acceptance"), "docs/RELEASE_CHECKLIST.md must include published-release:acceptance.");

  console.log("Published release bootstrap acceptance dry-run passed. Set MINDORY_PUBLISHED_RELEASE_ACCEPTANCE_LIVE=true to verify the public GitHub pre-release.");
}

async function live() {
  const release = releaseDefaults();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-published-release-"));
  const publicKeyPath = path.join(tempRoot, `mindory-${release.version}.manifest.env.public.pem`);
  const manifestPath = path.join(tempRoot, `mindory-${release.version}.manifest.env`);
  const bundlePath = path.join(tempRoot, `mindory-${release.version}.tar.gz`);
  const checksumPath = path.join(tempRoot, `mindory-${release.version}.sha256`);
  const verifyHome = path.join(tempRoot, "verify-home");
  const smokeHome = path.join(tempRoot, "smoke-home");

  try {
    await downloadFile(release.manifestUrl, manifestPath, "release manifest");
    await downloadFile(release.publicKeyUrl, publicKeyPath, "release manifest public key");
    await downloadFile(release.bundleUrl, bundlePath, "release bundle");
    await downloadFile(release.checksumUrl, checksumPath, "release checksum file");

    const checksumEntries = parseChecksumFile(fs.readFileSync(checksumPath, "utf8"));
    const verifiedChecksumAssets = [
      verifyChecksumEntry(checksumEntries, bundlePath, "release bundle"),
      verifyChecksumEntry(checksumEntries, manifestPath, "release manifest"),
      verifyChecksumEntry(checksumEntries, publicKeyPath, "release manifest public key")
    ];

    run("sh", [
      "install.sh",
      "--manifest-path",
      manifestPath,
      "--public-key-path",
      publicKeyPath,
      "--verify-only"
    ], {
      env: {
        ...process.env,
        MINDORY_HOME: verifyHome
      }
    }, "install.sh verify-only against published release");

    const smokeOutput = run(process.execPath, [
      "scripts/smoke-release-install.js",
      "--manifest",
      manifestPath,
      "--public-key",
      publicKeyPath,
      "--home",
      smokeHome
    ], {}, "published release installer smoke");

    console.log(JSON.stringify({
      status: "published_release_bootstrap_acceptance_passed",
      repo: release.repo,
      tag: release.tag,
      manifestUrl: release.manifestUrl,
      bundleUrl: release.bundleUrl,
      checksumUrl: release.checksumUrl,
      verifiedChecksumAssets,
      smoke: JSON.parse(smokeOutput)
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (truthy(process.env.MINDORY_PUBLISHED_RELEASE_ACCEPTANCE_LIVE)) {
  await live();
} else {
  dryRun();
}
