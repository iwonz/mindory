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
  "buildRedactedInstallSummary"
]) {
  assert(installerSource.includes(symbol), `Installer core must expose ${symbol}.`);
}
for (const token of ["CONFIG_CATALOG", "MINDORY_HOME_DIRECTORIES", "composeProfilesForAnswers", "redactEnvMap"]) {
  assert(installerSource.includes(token), `Installer core must include ${token}.`);
}

const installer = await import("../packages/installer/dist/index.js");

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

console.log("Installer core validated.");
