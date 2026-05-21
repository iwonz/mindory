import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", ".turbo"]);
const staleTaskPattern = new RegExp("[M]IN-000[0-9]*|[M]INDORY-[0-9]+");
const checkedExtensions = new Set([".js", ".mjs", ".json", ".md", ".sql", ".ts", ".yaml", ".yml", ".example", ".npmrc", ".gitignore"]);

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...walk(path.join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

const errors = [];

for (const filePath of walk(root)) {
  const relativePath = path.relative(root, filePath);
  const extension = path.extname(filePath);
  if (!checkedExtensions.has(extension) && ![".env.example", ".npmrc", ".gitignore"].includes(relativePath)) {
    continue;
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (staleTaskPattern.test(content)) {
    errors.push(`${relativePath}: contains a legacy task identifier.`);
  }

  content.split(/\r?\n/).forEach((line, index) => {
    const trailingWhitespace = line.match(/[ \t]+$/)?.[0] ?? "";
    const markdownLineBreak = extension === ".md" && trailingWhitespace === "  ";
    if (trailingWhitespace.length > 0 && !markdownLineBreak) {
      errors.push(`${relativePath}:${index + 1}: trailing whitespace.`);
    }
  });
}

const rootPrd = fs.readFileSync(path.join(root, "PRD.md"), "utf8");
if (!rootPrd.includes("docs/PRD.md")) {
  errors.push("PRD.md must point readers to docs/PRD.md.");
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log("Repository lint passed.");
