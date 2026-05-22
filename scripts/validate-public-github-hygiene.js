import fs from "node:fs";
import path from "node:path";
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

function assertExists(relativePath) {
  assert(fs.existsSync(path.join(root, relativePath)), `${relativePath} must exist.`);
}

const rootPackage = readJson("package.json");
assert(rootPackage.scripts?.["public:validate"] === "node scripts/validate-public-github-hygiene.js", "Root package must expose public:validate.");

for (const file of [
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs/SUPPORT_MATRIX.md",
  "docs/REPOSITORY_STATUS.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/pull_request_template.md"
]) {
  assertExists(file);
}

const license = read("LICENSE");
const contributing = read("CONTRIBUTING.md");
const security = read("SECURITY.md");
const changelog = read("CHANGELOG.md");
const readme = read("README.md");
const supportMatrix = read("docs/SUPPORT_MATRIX.md");
const repositoryStatus = read("docs/REPOSITORY_STATUS.md");
const productionHardening = read("docs/PRODUCTION_HARDENING.md");
const bugTemplate = read(".github/ISSUE_TEMPLATE/bug_report.yml");
const featureTemplate = read(".github/ISSUE_TEMPLATE/feature_request.yml");
const prTemplate = read(".github/pull_request_template.md");

for (const token of ["Apache License", "Version 2.0", "Copyright 2026 Mindory contributors"]) {
  assertIncludes(license, token, "LICENSE");
}

for (const token of ["Mindory Ralph-cycle", "TASK-<number>", "pnpm check", "docs/SUPPORT_MATRIX.md", "No task means no code"]) {
  assertIncludes(contributing, token, "CONTRIBUTING.md");
}

for (const token of ["Security Policy", "Supported Versions", "GitHub private vulnerability reporting", "docs/SECURITY.md", "Do not report suspected vulnerabilities through public GitHub issues"]) {
  assertIncludes(security, token, "SECURITY.md");
}

for (const token of ["Release Notes Policy", "Unreleased", "TASK-70", "TASK-69"]) {
  assertIncludes(changelog, token, "CHANGELOG.md");
}

for (const token of ["LICENSE", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "docs/REPOSITORY_STATUS.md", "docs/SUPPORT_MATRIX.md", "TASK-73"]) {
  assertIncludes(readme, token, "README.md");
}

for (const token of ["Supported", "Experimental", "Placeholder", "Future", "HTTP API", "MCP stdio", "@mindory/llm"]) {
  assertIncludes(supportMatrix, token, "docs/SUPPORT_MATRIX.md");
}

for (const token of ["complete through `TASK-73`", "Public GitHub hygiene baseline", "Known Limits", "Public Claims Rule"]) {
  assertIncludes(repositoryStatus, token, "docs/REPOSITORY_STATUS.md");
}

assert(!productionHardening.includes("repo still needs public license"), "Production hardening docs must not claim public GitHub files are missing.");
assertIncludes(productionHardening, "Public GitHub readiness | Supported baseline", "docs/PRODUCTION_HARDENING.md");

for (const token of ["type: textarea", "Support level", "Docker Compose", "docs/SUPPORT_MATRIX.md"]) {
  assertIncludes(bugTemplate, token, ".github/ISSUE_TEMPLATE/bug_report.yml");
}

for (const token of ["Feature request", "Acceptance criteria", "TASK file", "docs/SUPPORT_MATRIX.md"]) {
  assertIncludes(featureTemplate, token, ".github/ISSUE_TEMPLATE/feature_request.yml");
}

for (const token of ["TASK-", "pnpm check", "docs/SUPPORT_MATRIX.md", "No secrets"]) {
  assertIncludes(prTemplate, token, ".github/pull_request_template.md");
}

console.log("Public GitHub hygiene validated.");
