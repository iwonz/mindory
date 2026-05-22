import fs from "node:fs";
import path from "node:path";
import { generateEnvExample, loadConfigCatalog, root } from "./config-catalog-utils.js";

const { CONFIG_CATALOG_SECTIONS, FLAT_CONFIG_CATALOG } = await loadConfigCatalog();
const errors = [];
const names = new Set();
const sectionIds = new Set(CONFIG_CATALOG_SECTIONS.map((section) => section.id));

for (const entry of FLAT_CONFIG_CATALOG) {
  if (names.has(entry.name)) {
    errors.push(`${entry.name}: duplicate config catalog entry.`);
  }
  names.add(entry.name);
  if (!entry.name.startsWith("MINDORY_")) {
    errors.push(`${entry.name}: config env names must use MINDORY_ prefix.`);
  }
  if (!sectionIds.has(entry.section)) {
    errors.push(`${entry.name}: unknown config section ${entry.section}.`);
  }
  if (entry.type === "boolean" && !["true", "false"].includes(entry.defaultValue)) {
    errors.push(`${entry.name}: boolean defaults must be true or false.`);
  }
  if (entry.type === "number" && Number.isNaN(Number.parseInt(entry.defaultValue, 10))) {
    errors.push(`${entry.name}: number defaults must parse as integers.`);
  }
  if (entry.type === "enum") {
    if (!Array.isArray(entry.allowedValues) || entry.allowedValues.length === 0) {
      errors.push(`${entry.name}: enum entries must define allowedValues.`);
    } else if (!entry.allowedValues.includes(entry.defaultValue)) {
      errors.push(`${entry.name}: enum default must be listed in allowedValues.`);
    }
  }
  if (entry.secret && entry.visibility === "installer" && entry.defaultValue !== "") {
    errors.push(`${entry.name}: installer-only secret defaults must be empty.`);
  }
}

const generatedEnv = generateEnvExample(CONFIG_CATALOG_SECTIONS, FLAT_CONFIG_CATALOG);
const currentEnv = fs.readFileSync(path.join(root, ".env.example"), "utf8");
if (currentEnv !== generatedEnv) {
  errors.push(".env.example is out of sync with packages/config/src/catalog.ts. Run `pnpm config:generate`.");
}

for (const envName of findUsedMindoryEnvNames()) {
  if (!names.has(envName)) {
    errors.push(`${envName}: used in runtime/Compose/scripts but missing from config catalog.`);
  }
}

const configSource = fs.readFileSync(path.join(root, "packages/config/src/index.ts"), "utf8");
for (const match of configSource.matchAll(/read(?:String|Number|NullableNumber|Boolean|Enum)\(\s*env,\s*"(?<name>MINDORY_[^"]+)"\s*,\s*(?<defaultArg>[^,\n)]+)/g)) {
  const defaultArg = match.groups?.defaultArg ?? "";
  if (!defaultArg.includes("catalog")) {
    errors.push(`${match.groups?.name}: config loader default must come from catalog.`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log("Config catalog validated.");

function findUsedMindoryEnvNames() {
  const scannedFiles = [];
  for (const relativePath of [
    "docker-compose.yml",
    "docker-compose.override.yml",
    "apps",
    "packages",
    "scripts/mvp-demo.js",
    "scripts/mvp-acceptance.js",
    "scripts/seed-demo.js",
    "scripts/test-integration.js"
  ]) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      scannedFiles.push(...walk(absolutePath));
    } else {
      scannedFiles.push(absolutePath);
    }
  }

  const used = new Set();
  for (const filePath of scannedFiles) {
    const relativePath = path.relative(root, filePath);
    if (relativePath.includes(`${path.sep}dist${path.sep}`) || relativePath.includes(`${path.sep}lib${path.sep}`)) {
      continue;
    }
    const content = fs.readFileSync(filePath, "utf8");
    collectMatches(content, /process\.env(?:\.|\[["'])(?<name>MINDORY_[A-Z0-9]+(?:_[A-Z0-9]+)*)(?:"|'|\])?/g, used);
    collectMatches(content, /\$\{(?<name>MINDORY_[A-Z0-9]+(?:_[A-Z0-9]+)*)(?::|})/g, used);
    collectMatches(content, /\b(?<name>MINDORY_[A-Z0-9]+(?:_[A-Z0-9]+)*)\s*:/g, used);
    collectMatches(content, /read(?:String|Number|Boolean|Enum)\(\s*env,\s*"(?<name>MINDORY_[A-Z0-9]+(?:_[A-Z0-9]+)*)"/g, used);
  }
  return [...used].sort();
}

function collectMatches(content, pattern, used) {
  for (const match of content.matchAll(pattern)) {
    const name = match.groups?.name;
    if (name !== undefined) {
      used.add(name);
    }
  }
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["dist", "lib", "node_modules"].includes(entry.name)) {
        files.push(...walk(absolutePath));
      }
      continue;
    }
    if (entry.isFile() && /\.(js|mjs|ts|yml|yaml)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}
