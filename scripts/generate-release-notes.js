import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    version: process.env.MINDORY_RELEASE_VERSION ?? "",
    out: "",
    image: "",
    shaImage: "",
    tag: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") {
      options.version = argv[++index] ?? "";
    } else if (arg === "--out") {
      options.out = path.resolve(argv[++index] ?? "");
    } else if (arg === "--image") {
      options.image = argv[++index] ?? "";
    } else if (arg === "--sha-image") {
      options.shaImage = argv[++index] ?? "";
    } else if (arg === "--tag") {
      options.tag = argv[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  console.log(`Mindory release notes generator

Usage:
  node scripts/generate-release-notes.js --version <version> [--tag v<version>] [--image <image:version>] [--sha-image <image:sha>] [--out <file>]
`);
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

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function changelogUnreleased(content) {
  const start = content.indexOf("## Unreleased");
  if (start < 0) {
    return "- No unreleased changelog entries were found.";
  }
  const rest = content.slice(start);
  const next = rest.slice("## Unreleased".length).search(/\n## /);
  const section = next < 0 ? rest : rest.slice(0, "## Unreleased".length + next);
  return section.replace(/^## Unreleased\s*/u, "").trim() || "- No unreleased changelog entries were found.";
}

function supportMatrixSummary(content) {
  const lines = content.split(/\r?\n/);
  const rows = lines.filter((line) => line.startsWith("| ") && !line.includes("---"));
  return rows
    .filter((line) => /(Supported|Experimental|Future)/.test(line))
    .slice(0, 14)
    .join("\n");
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}

validateVersion(options.version);

const tag = options.tag || `v${options.version}`;
const outPath = options.out || path.join(root, "dist", "releases", `mindory-${options.version}.release-notes.md`);
const bundleName = `mindory-${options.version}.tar.gz`;
const manifestName = `mindory-${options.version}.manifest.env`;
const publicKeyName = `${manifestName}.public.pem`;
const checksumName = `mindory-${options.version}.sha256`;
const supportMatrix = supportMatrixSummary(read("docs/SUPPORT_MATRIX.md"));
const changelog = changelogUnreleased(read("CHANGELOG.md"));
const generatedAt = new Date().toISOString();

const notes = `# Mindory ${tag}

Generated at: ${generatedAt}

## Verification

- Repository gate: \`pnpm check\`
- Release gate: \`pnpm release:validate\`
- Bootstrap gate: signed manifest verification and bundle checksum validation
- Self-host gate: \`pnpm selfhost:acceptance\`

## Release Artifacts

- \`${bundleName}\`
- \`${manifestName}\`
- \`${publicKeyName}\`
- \`${checksumName}\`
- \`mindory-${options.version}.release-notes.md\`

## Docker Images

- Version tag: \`${options.image || "ghcr.io/<owner>/mindory:" + options.version}\`
- Commit tag: \`${options.shaImage || "ghcr.io/<owner>/mindory:<git-sha>"}\`

The release workflow publishes Docker images only for trusted tag builds. Pull
request and local validation paths build or validate artifacts without pushing
to a registry.

## Support Matrix

The public support matrix for this release is maintained in
\`docs/SUPPORT_MATRIX.md\`.

${supportMatrix}

## Upgrade Notes

- Back up the existing install with \`mindory-installer backup --home "$MINDORY_HOME"\` before updating.
- Keep the trusted release public key available and verify that the manifest
  \`MINDORY_RELEASE_PUBLIC_KEY_SHA256\` matches the key you intend to trust.
- Run \`mindory-installer update --dry-run\` before a real update when updating
  a persistent install.
- Run \`pnpm selfhost:acceptance\` or the packaged installer smoke path after
  staging the release in a non-production home.

## Public Release Checklist

- [ ] \`pnpm check\` passed on the release commit.
- [ ] \`pnpm release:validate\` passed and tampered manifest/artifact checks failed as expected.
- [ ] Release manifest, public key sidecar and checksum files are attached.
- [ ] Docker version and commit tags are published from a trusted tag build.
- [ ] Release notes mention support level changes and upgrade notes.
- [ ] No secrets or private endpoints are present in artifacts or notes.

## Changelog Excerpt

${changelog}
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, notes, "utf8");
console.log(JSON.stringify({ releaseNotes: outPath, version: options.version, tag }, null, 2));
