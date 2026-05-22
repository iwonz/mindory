import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const options = {
    manifestPath: "",
    publicKeyPath: "",
    home: "",
    keep: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = path.resolve(argv[++index] ?? "");
    } else if (arg === "--public-key") {
      options.publicKeyPath = path.resolve(argv[++index] ?? "");
    } else if (arg === "--home") {
      options.home = path.resolve(argv[++index] ?? "");
    } else if (arg === "--keep") {
      options.keep = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  console.log(`Mindory release install smoke

Usage:
  node scripts/smoke-release-install.js --manifest <manifest.env> [--public-key <public.pem>] [--home <dir>] [--keep]

The smoke verifies the signed release manifest, checks the bundle checksum,
extracts the release bundle into a temporary MINDORY_HOME-style release
directory and runs the packaged installer plan command. It does not start
Docker or write outside the selected home.
`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function manifestValue(content, key) {
  const line = content.split(/\r?\n/).filter((entry) => entry.startsWith(`${key}=`)).at(-1);
  return line === undefined ? "" : line.slice(key.length + 1);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Text(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function unsignedManifestContent(content) {
  return `${content
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("MINDORY_RELEASE_MANIFEST_SIGNATURE="))
    .join("\n")
    .replace(/\n*$/, "")}\n`;
}

function verifyManifestSignature(manifestPath, manifest, publicKeyPath) {
  const resolvedPublicKeyPath = publicKeyPath || `${manifestPath}.public.pem`;
  assert(fs.existsSync(resolvedPublicKeyPath), `Release manifest public key is missing: ${resolvedPublicKeyPath}.`);
  const algorithm = manifestValue(manifest, "MINDORY_RELEASE_MANIFEST_SIGNATURE_ALGORITHM");
  const signature = manifestValue(manifest, "MINDORY_RELEASE_MANIFEST_SIGNATURE");
  const expectedPublicKeySha256 = manifestValue(manifest, "MINDORY_RELEASE_PUBLIC_KEY_SHA256");
  assert(algorithm === "RSA-SHA256", `Unsupported release manifest signature algorithm: ${algorithm || "<missing>"}.`);
  assert(signature, "Manifest is missing MINDORY_RELEASE_MANIFEST_SIGNATURE.");
  assert(expectedPublicKeySha256, "Manifest is missing MINDORY_RELEASE_PUBLIC_KEY_SHA256.");

  const publicKeyPem = fs.readFileSync(resolvedPublicKeyPath, "utf8");
  const actualPublicKeySha256 = sha256Text(publicKeyPem);
  assert(actualPublicKeySha256 === expectedPublicKeySha256, `Release public key SHA-256 mismatch. Expected ${expectedPublicKeySha256}, got ${actualPublicKeySha256}.`);

  const ok = crypto.verify(
    "sha256",
    Buffer.from(unsignedManifestContent(manifest), "utf8"),
    crypto.createPublicKey(publicKeyPem),
    Buffer.from(signature, "base64")
  );
  assert(ok, "Manifest signature verification failed.");
}

function resolveBundlePath(manifestPath, bundleUrl, bundleName) {
  if (bundleUrl.startsWith("file://")) {
    return fileURLToPath(bundleUrl);
  }
  if (fs.existsSync(bundleUrl)) {
    return path.resolve(bundleUrl);
  }
  const fromName = bundleName ? path.join(path.dirname(manifestPath), bundleName) : "";
  if (fromName && fs.existsSync(fromName)) {
    return fromName;
  }
  try {
    const url = new URL(bundleUrl);
    const fromUrlBasename = path.join(path.dirname(manifestPath), path.basename(url.pathname));
    if (fs.existsSync(fromUrlBasename)) {
      return fromUrlBasename;
    }
  } catch {
    // The bundle URL may be an unsupported remote-like string; report below.
  }
  throw new Error(`Release smoke requires a local bundle next to the manifest. Could not resolve ${bundleUrl}.`);
}

function extractBundle(bundlePath, home, version) {
  const releasesDir = path.join(home, "install", "releases");
  const stagingDir = path.join(releasesDir, `${version}.staging-smoke`);
  const releaseDir = path.join(releasesDir, version);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const result = spawnSync("tar", ["-xzf", bundlePath, "-C", stagingDir], {
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Failed to extract release bundle: ${result.stderr || result.stdout}`);
  }

  const extractedRoot = path.join(stagingDir, `mindory-${version}`);
  assert(fs.existsSync(extractedRoot), `Expected bundle root mindory-${version}.`);
  fs.renameSync(extractedRoot, releaseDir);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  return releaseDir;
}

function runInstallerPlan(releaseDir) {
  const launcher = path.join(releaseDir, "bin", "mindory-installer");
  const cli = path.join(releaseDir, "packages", "installer", "dist", "cli.js");
  assert(fs.existsSync(launcher), "Release bundle is missing bin/mindory-installer.");
  assert(fs.existsSync(cli), "Release bundle is missing packages/installer/dist/cli.js.");

  const result = spawnSync(process.execPath, [cli, "plan"], {
    cwd: releaseDir,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Packaged installer plan failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}

assert(options.manifestPath, "Pass --manifest <manifest.env>.");
const manifestPath = options.manifestPath;
const manifest = fs.readFileSync(manifestPath, "utf8");
verifyManifestSignature(manifestPath, manifest, options.publicKeyPath);
const version = manifestValue(manifest, "MINDORY_RELEASE_VERSION");
const bundleUrl = manifestValue(manifest, "MINDORY_RELEASE_BUNDLE_URL");
const checksum = manifestValue(manifest, "MINDORY_RELEASE_BUNDLE_SHA256");
const bundleName = manifestValue(manifest, "MINDORY_RELEASE_BUNDLE_NAME");
assert(version && bundleUrl && checksum, "Manifest is missing version, bundle URL or SHA-256.");

const bundlePath = resolveBundlePath(manifestPath, bundleUrl, bundleName);
const actualChecksum = sha256File(bundlePath);
assert(actualChecksum === checksum, `Checksum mismatch. Expected ${checksum}, got ${actualChecksum}.`);

const home = options.home || fs.mkdtempSync(path.join(os.tmpdir(), "mindory-release-smoke-"));
fs.mkdirSync(home, { recursive: true });

try {
  const releaseDir = extractBundle(bundlePath, home, version);
  const plan = runInstallerPlan(releaseDir);
  assert(Array.isArray(plan.steps), "Installer plan output must include steps.");
  console.log(JSON.stringify({
    status: "release_smoke_passed",
    version,
    releaseDir,
    stepCount: plan.steps.length
  }, null, 2));
} finally {
  if (!options.keep) {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
