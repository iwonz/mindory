import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadConfigCatalog() {
  const catalogPath = path.join(root, "packages/config/dist/catalog.js");
  if (!fs.existsSync(catalogPath)) {
    throw new Error("packages/config/dist/catalog.js is missing. Run `pnpm typecheck` before config catalog validation.");
  }
  return import(pathToFileURL(catalogPath).href);
}

export function generateEnvExample(sections, entries) {
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const entriesBySection = new Map();
  for (const entry of entries) {
    const bucket = entriesBySection.get(entry.section) ?? [];
    bucket.push(entry);
    entriesBySection.set(entry.section, bucket);
  }

  const lines = [
    "# This file is generated from packages/config/src/catalog.ts.",
    "# Run `pnpm config:generate` after changing the config catalog.",
    ""
  ];

  for (const section of sections) {
    const sectionEntries = entriesBySection.get(section.id) ?? [];
    if (sectionEntries.length === 0) {
      continue;
    }
    lines.push("# -----------------------------------------------------------------------------");
    lines.push(`# ${section.title}`);
    lines.push("# -----------------------------------------------------------------------------");
    lines.push(...sectionNotes(section.id));
    if (sectionNotes(section.id).length > 0) {
      lines.push("");
    }
    for (const entry of sectionEntries) {
      if (entry.allowedValues !== undefined) {
        lines.push(`# ${entry.allowedValues.join(" | ")}`);
      }
      if (entry.supportStatus === "experimental") {
        lines.push("# experimental");
      }
      if (entry.supportStatus === "future") {
        lines.push("# future adapter/profile");
      }
      lines.push(`${entry.name}=${entry.defaultValue}`);
    }
    lines.push("");
  }

  lines.push(...llmExamples());
  assertKnownSections(sectionById, entries);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function assertKnownSections(sectionById, entries) {
  for (const entry of entries) {
    if (!sectionById.has(entry.section)) {
      throw new Error(`${entry.name} references missing config section ${entry.section}.`);
    }
  }
}

function sectionNotes(sectionId) {
  if (sectionId === "storage") {
    return [
      "# local-fs is currently implemented. S3-compatible storage is cataloged for",
      "# LibreFS/external S3 installer work and remains adapter-gated until TASK-56."
    ];
  }
  if (sectionId === "llm") {
    return [
      "# Per-role providers: disabled | openai-compatible | ollama | local-http | local-command",
      "# Disabled text embeddings reach chunked status and use text fallback search.",
      "# For strict indexed pgvector acceptance, enable a 1536-dimensional text embedding model."
    ];
  }
  return [];
}

function llmExamples() {
  return [
    "# -----------------------------------------------------------------------------",
    "# LLM SDK Examples",
    "# -----------------------------------------------------------------------------",
    "# OpenAI-compatible example:",
    "# MINDORY_LLM_TEXT_EMBEDDING_ENABLED=true",
    "# MINDORY_LLM_TEXT_EMBEDDING_PROVIDER=openai-compatible",
    "# MINDORY_LLM_TEXT_EMBEDDING_MODEL=text-embedding-3-small",
    "# MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=1536",
    "# MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1",
    "# MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=api-key",
    "# MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY=sk-...",
    "",
    "# OpenAI-compatible OAuth bearer example:",
    "# MINDORY_LLM_TEXT_EMBEDDING_ENABLED=true",
    "# MINDORY_LLM_TEXT_EMBEDDING_PROVIDER=openai-compatible",
    "# MINDORY_LLM_TEXT_EMBEDDING_MODEL=text-embedding-3-small",
    "# MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=1536",
    "# MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1",
    "# MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=oauth-bearer",
    "# MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN=<host-supplied-access-token>",
    "",
    "# Ollama example:",
    "# MINDORY_LLM_TEXT_EMBEDDING_ENABLED=true",
    "# MINDORY_LLM_TEXT_EMBEDDING_PROVIDER=ollama",
    "# MINDORY_LLM_TEXT_EMBEDDING_MODEL=<1536-dimensional-local-embedding-model>",
    "# MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=1536",
    "# MINDORY_LLM_OLLAMA_BASE_URL=http://ollama:11434"
  ];
}
