import fs from "node:fs";
import os from "node:os";
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

const rootPackage = readJson("package.json");
const rootTsconfig = readJson("tsconfig.json");
const installerPackage = readJson("packages/installer/package.json");
const installerSource = read("packages/installer/src/index.ts");

assert(rootPackage.scripts?.["installer:validate"]?.includes("scripts/validate-installer-core.js"), "Root package must expose installer:validate.");
assert(rootTsconfig.references?.some((reference) => reference.path === "packages/installer"), "Root tsconfig must reference @mindory/installer.");
assert(installerPackage.name === "@mindory/installer", "Installer package must be named @mindory/installer.");
assert(installerPackage.dependencies?.["@mindory/config"] === "workspace:*", "Installer core must depend on @mindory/config.");

for (const symbol of [
  "MindoryInstallAnswers",
  "createInstallPlan",
  "InstallTransactionJournal",
  "rollbackCompletedActions",
  "detectHostDependencies",
  "renderEnvFile",
  "renderMindoryConfigJson",
  "buildRedactedInstallSummary",
  "buildWizardPromptPlan",
  "runInstallWizard",
  "createReadlineWizardIo",
  "acquireInstallLock",
  "writeInstallJournal",
  "readInstallJournal",
  "formatInstallerDiagnostic"
]) {
  assert(installerSource.includes(symbol), `Installer core must expose ${symbol}.`);
}
for (const token of ["CONFIG_CATALOG", "MINDORY_HOME_DIRECTORIES", "composeProfilesForAnswers", "redactEnvMap"]) {
  assert(installerSource.includes(token), `Installer core must include ${token}.`);
}

const installer = await import("../packages/installer/dist/index.js");

const wizardPromptIds = installer.buildWizardPromptPlan().map((prompt) => prompt.id);
for (const promptId of [
  "install.profile",
  "install.home",
  "install.public_url",
  "av.mode",
  "storage.choice",
  "modalities.video_max_keyframes",
  "interfaces.api_port",
  "tokens.cli_api_token",
  "llm.TEXT_EMBEDDING.enabled",
  "llm.TEXT_EMBEDDING.provider",
  "llm.OCR.enabled"
]) {
  assert(wizardPromptIds.includes(promptId), `Wizard prompt plan must include ${promptId}.`);
}

const answers = installer.createDefaultInstallAnswers({
  mindoryHome: "/tmp/mindory-installer-test",
  storage: {
    provider: "s3",
    localPath: "/data/mindory/objects",
    s3: {
      endpoint: "http://librefs:9000",
      region: "us-east-1",
      bucket: "mindory",
      accessKeyId: "installer-access",
      secretAccessKey: "installer-secret",
      forcePathStyle: true
    }
  },
  llmRoles: {
    TEXT_EMBEDDING: {
      enabled: true,
      provider: "ollama",
      model: "mindory-test-embedding",
      required: false,
      timeoutMs: 1000,
      concurrency: 1,
      dimensions: 1536
    }
  },
  tokens: {
    mcpApiToken: "mcp-secret",
    cliApiToken: "cli-secret",
    hermesApiToken: "hermes-secret"
  }
});

assert(installer.validateInstallAnswers(answers).length === 0, "Default install answers with overrides must validate.");

const env = installer.answersToEnvMap(answers);
assert(env.MINDORY_HOME === "/tmp/mindory-installer-test", "Rendered env must include MINDORY_HOME.");
assert(env.MINDORY_STORAGE_PROVIDER === "s3", "Rendered env must include selected storage provider.");
assert(env.MINDORY_S3_SECRET_ACCESS_KEY === "installer-secret", "Rendered env must include raw secrets for generated .env.");
assert(env.MINDORY_LLM_TEXT_EMBEDDING_PROVIDER === "ollama", "Rendered env must include LLM role provider.");

const envFile = installer.renderEnvFile(answers);
assert(envFile.includes("MINDORY_S3_ENDPOINT=http://librefs:9000"), "Env file must render S3-compatible endpoint.");
assert(envFile.includes("MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=1536"), "Env file must render embedding dimensions.");

const configJson = JSON.parse(installer.renderMindoryConfigJson(answers));
assert(configJson.mindory_home === "/tmp/mindory-installer-test", "Config JSON must include mindory_home.");
assert(configJson.storage.provider === "s3", "Config JSON must include storage provider.");

const plan = installer.createInstallPlan(answers);
assert(plan.composeProfiles.includes("librefs"), "S3 LibreFS answers must add the librefs profile.");
assert(plan.composeProfiles.includes("clamav"), "Default antivirus answers must add the clamav profile.");
assert(plan.composeProfiles.includes("ollama"), "Ollama LLM answers must add the ollama profile.");
for (const directory of ["config", "data/postgres", "data/redis", "data/objects", "data/librefs", "logs", "backups", "install"]) {
  assert(plan.homeDirectories.includes(directory), `Install plan must include ${directory}.`);
}
for (const stepId of ["ensure-home", "write-config", "write-env", "write-compose-assets", "health-check"]) {
  assert(plan.steps.some((step) => step.id === stepId), `Install plan must include ${stepId}.`);
}

const summary = installer.buildRedactedInstallSummary(answers);
assert(summary.environment.MINDORY_S3_SECRET_ACCESS_KEY === "<redacted>", "Summary must redact S3 secret.");
assert(summary.environment.MINDORY_CLI_API_TOKEN === "<redacted>", "Summary must redact CLI token.");
assert(!JSON.stringify(summary).includes("installer-secret"), "Summary must not contain raw S3 secret.");
assert(!JSON.stringify(summary).includes("cli-secret"), "Summary must not contain raw CLI token.");

const journal = new installer.InstallTransactionJournal();
const completedSteps = plan.steps.slice(0, 3);
for (const step of completedSteps) {
  journal.recordPlanned(step);
  journal.markCompleted(step);
}
const rollbackOrder = [];
const rollbackReport = await installer.rollbackCompletedActions(plan, journal, (rollback, step) => {
  rollbackOrder.push(`${step.id}:${rollback.kind}`);
});
assert(rollbackOrder.join(",") === "write-env:restore_file,write-config:restore_file,ensure-home:delete_path", "Rollback must run completed steps in reverse order.");
assert(rollbackReport.executions.every((execution) => execution.status === "completed"), "Rollback report must mark successful executions.");
assert(journal.toJSON().some((entry) => entry.event === "rollback_completed"), "Journal must record rollback completion.");

const failingJournal = new installer.InstallTransactionJournal();
for (const step of completedSteps.slice(0, 1)) {
  failingJournal.recordPlanned(step);
  failingJournal.markCompleted(step);
}
const failingRollback = await installer.rollbackCompletedActions(plan, failingJournal, () => {
  throw new Error("rollback failed");
});
assert(failingRollback.executions[0].status === "failed", "Rollback report must capture failed rollback outcomes.");
assert(failingJournal.toJSON().some((entry) => entry.event === "rollback_failed"), "Journal must record rollback failure.");

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-"));
const lock = installer.acquireInstallLock(tempHome, "validator");
assert(fs.existsSync(installer.installLockPath(tempHome)), "Install lock must be created under MINDORY_HOME/install.");
assert(installer.readInstallLock(tempHome).owner === "validator", "Install lock must be readable.");
let lockRejected = false;
try {
  installer.acquireInstallLock(tempHome, "validator-2");
} catch (error) {
  lockRejected = String(error).includes("Another Mindory installer run");
}
assert(lockRejected, "Concurrent installer lock acquisition must be rejected.");
lock.release();
assert(!fs.existsSync(installer.installLockPath(tempHome)), "Install lock release must remove the lock file.");
const journalPath = installer.writeInstallJournal(tempHome, journal);
assert(journalPath === installer.installJournalPath(tempHome), "Journal must be written to the canonical path.");
assert(installer.readInstallJournal(tempHome).length === journal.toJSON().length, "Persisted journal must be readable.");

const failedAnswers = installer.createDefaultInstallAnswers({
  mindoryHome: "",
  interfaces: { apiPort: 70000, mcpEnabled: true, hermesEnabled: false }
});
assert(installer.validateInstallAnswers(failedAnswers).length >= 2, "Invalid answers must report validation errors.");

const dependencyChecks = installer.detectHostDependencies(installer.createDefaultInstallAnswers({ devMode: true }), {
  run(command) {
    if (command === "docker") {
      return { status: 0, stdout: "ok", stderr: "" };
    }
    if (command === "node") {
      return { status: 0, stdout: "v24.0.0", stderr: "" };
    }
    return { status: null, stdout: "", stderr: "missing" };
  },
  isWritable() {
    return true;
  },
  isPortAvailable() {
    return false;
  },
  diskSpaceBytes() {
    return 1_000_000;
  }
});
assert(dependencyChecks.some((check) => check.id === "pnpm" && check.status === "missing"), "Dependency detector must report missing pnpm.");
assert(dependencyChecks.some((check) => check.id === "api-port" && check.status === "failed"), "Dependency detector must report unavailable API port.");
assert(dependencyChecks.some((check) => check.id === "disk-space" && check.status === "failed"), "Dependency detector must report insufficient disk space.");
const diagnostic = installer.formatInstallerDiagnostic(new Error("install failed"), dependencyChecks);
assert(diagnostic.summary === "install failed", "Installer diagnostic must include the failure summary.");
assert(diagnostic.nextSteps.some((step) => step.includes("pnpm")), "Installer diagnostic must include dependency fixes.");

const scriptedResponses = new Map([
  ["install.profile", "persistent-local"],
  ["install.home", "/tmp/mindory-wizard"],
  ["install.public_url", "http://mindory.localhost:3000"],
  ["install.allow_experimental", "false"],
  ["install.dependency_policy", "manual"],
  ["av.mode", "disabled"],
  ["storage.choice", "librefs-s3"],
  ["storage.s3.endpoint", "http://librefs:9000"],
  ["storage.s3.bucket", "mindory-wizard"],
  ["storage.s3.access_key_id", "wizard-access"],
  ["storage.s3.secret_access_key", "wizard-secret"],
  ["modalities.text", "true"],
  ["modalities.pdf", "true"],
  ["modalities.image", "false"],
  ["modalities.audio", "false"],
  ["modalities.video", "false"],
  ["modalities.video_max_keyframes", "10"],
  ["llm.TEXT_EMBEDDING.enabled", "true"],
  ["llm.TEXT_EMBEDDING.provider", "ollama"],
  ["llm.TEXT_EMBEDDING.model", "wizard-embedding"],
  ["llm.TEXT_EMBEDDING.required", "false"],
  ["llm.TEXT_EMBEDDING.timeout_ms", "60000"],
  ["llm.TEXT_EMBEDDING.concurrency", "1"],
  ["llm.TEXT_EMBEDDING.dimensions", "1536"],
  ["interfaces.api_port", "3001"],
  ["interfaces.mcp_enabled", "true"],
  ["interfaces.hermes_enabled", "true"],
  ["tokens.mcp_api_token", "wizard-mcp-secret"],
  ["tokens.cli_api_token", "wizard-cli-secret"],
  ["tokens.hermes_api_token", "wizard-hermes-secret"]
]);
let capturedSummary = null;
const scriptedAnswers = await installer.runInstallWizard({
  async prompt(prompt) {
    if (prompt.id.startsWith("llm.") && !prompt.id.startsWith("llm.TEXT_EMBEDDING.")) {
      return "false";
    }
    return scriptedResponses.get(prompt.id) ?? "";
  },
  async confirm(summary) {
    capturedSummary = summary;
    return true;
  }
});
assert(scriptedAnswers.profile === "persistent-local", "Wizard must apply scripted profile.");
assert(scriptedAnswers.storage.provider === "s3", "Wizard librefs choice must map to s3 storage.");
assert(scriptedAnswers.storage.s3.bucket === "mindory-wizard", "Wizard must apply S3 bucket.");
assert(scriptedAnswers.antivirus.mode === "disabled", "Wizard must apply AV mode.");
assert(scriptedAnswers.interfaces.apiPort === 3001, "Wizard must apply API port.");
assert(scriptedAnswers.llmRoles.TEXT_EMBEDDING.provider === "ollama", "Wizard must apply text embedding provider.");
assert(capturedSummary !== null, "Wizard must produce a confirmation summary.");
assert(!JSON.stringify(capturedSummary).includes("wizard-secret"), "Wizard confirmation summary must redact secrets.");
assert(!JSON.stringify(capturedSummary).includes("wizard-cli-secret"), "Wizard confirmation summary must redact tokens.");

let experimentalBlocked = false;
try {
  await installer.runInstallWizard({
    async prompt(prompt) {
      if (prompt.id === "llm.OCR.enabled") {
        return "true";
      }
      if (prompt.id.startsWith("llm.")) {
        return "false";
      }
      return scriptedResponses.get(prompt.id) ?? "";
    },
    async confirm() {
      return true;
    }
  });
} catch (error) {
  experimentalBlocked = String(error).includes("requires experimental mode");
}
assert(experimentalBlocked, "Wizard must block future LLM roles unless experimental mode is enabled.");

console.log("Installer core and wizard validated.");
