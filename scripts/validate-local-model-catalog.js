import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await import(pathToFileURL(path.join(root, "packages/config/dist/index.js")).href);

const {
  LOCAL_MODEL_RUNNER_CATALOG,
  LLM_ROLE_SUPPORT_CATALOG,
  LLM_PROVIDER_VALUES,
  llmRoleProviderSupportStatus
} = config;

const requiredRoles = [
  "TEXT_EMBEDDING",
  "IMAGE_EMBEDDING",
  "OCR",
  "ASR",
  "VISION_CAPTIONING",
  "FACE_DETECTION",
  "FACE_RECOGNITION"
];

const validRoles = new Set(LLM_ROLE_SUPPORT_CATALOG.map((entry) => entry.key));
const validProviders = new Set(LLM_PROVIDER_VALUES);
const docs = fs.readFileSync(path.join(root, "docs/LOCAL_MODELS.md"), "utf8");
const llmDocs = fs.readFileSync(path.join(root, "docs/LLM.md"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const checkRepo = fs.readFileSync(path.join(root, "scripts/check-repo.js"), "utf8");
const ids = new Set();
const coveredRoles = new Set();

assert(packageJson.scripts?.["local-models:validate"] === "pnpm --filter @mindory/config typecheck && node scripts/validate-local-model-catalog.js", "package.json must expose local-models:validate.");
assert(checkRepo.includes("\"local-models:validate\""), "pnpm check must include local-models:validate.");
assert(llmDocs.includes("docs/LOCAL_MODELS.md"), "docs/LLM.md must link the local model catalog.");
assert(Array.isArray(LOCAL_MODEL_RUNNER_CATALOG), "LOCAL_MODEL_RUNNER_CATALOG must be an array.");
assert(LOCAL_MODEL_RUNNER_CATALOG.length >= 6, "LOCAL_MODEL_RUNNER_CATALOG must include the multimodal local runner set.");

for (const entry of LOCAL_MODEL_RUNNER_CATALOG) {
  assert(typeof entry.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id), `${entry.id}: id must be kebab-case.`);
  assert(!ids.has(entry.id), `${entry.id}: duplicate local model runner id.`);
  ids.add(entry.id);

  assert(["supported", "experimental"].includes(entry.status), `${entry.id}: status must be supported or experimental.`);
  assert(validProviders.has(entry.provider), `${entry.id}: provider is not a known LLM provider.`);
  assert(entry.provider !== "disabled" && entry.provider !== "openai-compatible", `${entry.id}: local catalog providers must be local-http, ollama or local-command.`);
  assert(nonEmpty(entry.title), `${entry.id}: title is required.`);
  assert(nonEmpty(entry.composeProfile), `${entry.id}: composeProfile is required.`);
  assert(nonEmpty(entry.serviceName), `${entry.id}: serviceName is required.`);
  assert(nonEmpty(entry.sourceUrl) || nonEmpty(entry.containerImage), `${entry.id}: sourceUrl or containerImage is required.`);
  assert(nonEmpty(entry.license), `${entry.id}: license is required.`);
  assert(nonEmpty(entry.notes), `${entry.id}: notes are required.`);

  assert(Array.isArray(entry.roles) && entry.roles.length > 0, `${entry.id}: roles are required.`);
  for (const role of entry.roles) {
    assert(validRoles.has(role), `${entry.id}: role ${role} is not in LLM_ROLE_SUPPORT_CATALOG.`);
    assert(llmRoleProviderSupportStatus(role, entry.provider) !== "future", `${entry.id}: provider ${entry.provider} is future for role ${role}.`);
    coveredRoles.add(role);
  }

  assert(Array.isArray(entry.modelNames) && entry.modelNames.every(nonEmpty), `${entry.id}: modelNames must be non-empty strings.`);
  assert(Array.isArray(entry.modelFiles) && entry.modelFiles.length > 0, `${entry.id}: modelFiles are required.`);
  for (const file of entry.modelFiles) {
    assert(nonEmpty(file.name), `${entry.id}: model file name is required.`);
    assert(nonEmpty(file.sourceUrl), `${entry.id}: model file sourceUrl is required.`);
    assert(nonEmpty(file.sizeHint), `${entry.id}: model file sizeHint is required.`);
    assert(nonEmpty(file.targetPath) && file.targetPath.startsWith("$MINDORY_HOME/"), `${entry.id}: model file targetPath must live under MINDORY_HOME.`);
  }

  assert(Array.isArray(entry.ports) && entry.ports.length > 0, `${entry.id}: ports are required.`);
  for (const port of entry.ports) {
    assert(nonEmpty(port.name), `${entry.id}: port name is required.`);
    assert(Number.isInteger(port.containerPort) && port.containerPort > 0, `${entry.id}: containerPort must be positive.`);
    assert(Number.isInteger(port.defaultHostPort) && port.defaultHostPort > 0, `${entry.id}: defaultHostPort must be positive.`);
    if (port.envName !== undefined) {
      assert(port.envName.startsWith("MINDORY_"), `${entry.id}: port envName must be a Mindory env var.`);
    }
  }

  assert(["http", "ollama-tags", "command"].includes(entry.healthcheck.kind), `${entry.id}: invalid healthcheck kind.`);
  assert(Number.isInteger(entry.healthcheck.timeoutMs) && entry.healthcheck.timeoutMs > 0, `${entry.id}: healthcheck timeout must be positive.`);
  if (entry.healthcheck.kind === "command") {
    assert(Array.isArray(entry.healthcheck.command) && entry.healthcheck.command.length > 0, `${entry.id}: command healthcheck requires command args.`);
  } else {
    assert(nonEmpty(entry.healthcheck.endpoint), `${entry.id}: HTTP healthcheck endpoint is required.`);
  }

  for (const key of ["cpu", "memory", "disk", "gpu"]) {
    assert(nonEmpty(entry.resourceHint?.[key]), `${entry.id}: resourceHint.${key} is required.`);
  }

  assert(docs.includes(`\`${entry.id}\``), `docs/LOCAL_MODELS.md must document ${entry.id}.`);
}

for (const role of requiredRoles) {
  assert(coveredRoles.has(role), `LOCAL_MODEL_RUNNER_CATALOG must cover ${role}.`);
  assert(docs.includes(`\`${role}\``), `docs/LOCAL_MODELS.md must document role coverage for ${role}.`);
}

console.log(`Local model catalog validated: ${LOCAL_MODEL_RUNNER_CATALOG.length} runner(s), ${requiredRoles.length} required role(s).`);

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
