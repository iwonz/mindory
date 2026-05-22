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

function clamAvHealthCommandResult(args, options = {}) {
  const command = args.join(" ");
  if (!command.includes("clamdscan")) {
    return null;
  }
  if (command.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    if (options.missEicar) {
      return { status: 0, stdout: "/tmp/mindory-clamav-eicar-health.com: OK\n", stderr: "" };
    }
    return { status: 1, stdout: "/tmp/mindory-clamav-eicar-health.com: Eicar-Test-Signature FOUND\n", stderr: "" };
  }
  if (options.daemonUnavailable) {
    return { status: 2, stdout: "", stderr: "Could not connect to clamd on localhost:3310\n" };
  }
  if (options.protocolFailure) {
    return { status: 2, stdout: "/tmp/mindory-clamav-clean-health.txt: ERROR\n", stderr: "ClamAV protocol parse error\n" };
  }
  if (options.cleanInfected) {
    return { status: 1, stdout: "/tmp/mindory-clamav-clean-health.txt: Unexpected-Test-Signature FOUND\n", stderr: "" };
  }
  return { status: 0, stdout: "/tmp/mindory-clamav-clean-health.txt: OK\n", stderr: "" };
}

const rootPackage = readJson("package.json");
const rootTsconfig = readJson("tsconfig.json");
const installerPackage = readJson("packages/installer/package.json");
const installerSource = read("packages/installer/src/index.ts");
const installerCli = read("packages/installer/src/cli.ts");
const composeFile = read("docker-compose.yml");
const envExample = read(".env.example");

assert(rootPackage.scripts?.["installer:validate"]?.includes("scripts/validate-installer-core.js"), "Root package must expose installer:validate.");
assert(rootTsconfig.references?.some((reference) => reference.path === "packages/installer"), "Root tsconfig must reference @mindory/installer.");
assert(installerPackage.name === "@mindory/installer", "Installer package must be named @mindory/installer.");
assert(installerPackage.dependencies?.["@mindory/config"] === "workspace:*", "Installer core must depend on @mindory/config.");
assert(installerPackage.dependencies?.["@mindory/llm"] === "workspace:*", "Installer core must depend on @mindory/llm for local-command provider healthchecks.");
assert(installerPackage.dependencies?.["@mindory/storage-s3"] === "workspace:*", "Installer core must depend on @mindory/storage-s3 for S3 credential checks.");

for (const symbol of [
  "MindoryInstallAnswers",
  "createInstallPlan",
  "InstallTransactionJournal",
  "rollbackCompletedActions",
  "detectHostDependencies",
  "renderEnvFile",
  "renderMindoryConfigJson",
  "buildRedactedInstallSummary",
  "executeInstallPlan",
  "InstallCommandRunner",
  "updateInstallAssets",
  "uninstallMindoryHome",
  "createMindoryRuntimeBackup",
  "restoreMindoryRuntimeBackup",
  "createMindoryPostgresPitrBaseBackup",
  "restoreMindoryPostgresPitrBackup",
  "inspectInstallState",
  "buildWizardPromptPlan",
  "runInstallWizard",
  "createReadlineWizardIo",
  "acquireInstallLock",
  "writeInstallJournal",
  "readInstallJournal",
  "validateS3StorageAnswers",
  "checkS3StorageAccess",
  "formatInstallerDiagnostic",
  "ClamAvInstallerHealthError",
  "checkClamAvInstallerHealth",
  "checkLocalCommandLlmInstallerHealth",
  "checkFfmpegInstallerHealth"
]) {
  assert(installerSource.includes(symbol), `Installer core must expose ${symbol}.`);
}
for (const token of ["CONFIG_CATALOG", "llmRoleProviderSupportStatus", "llmRoleSupportStatus", "checkMindoryLlmProviderHealth", "MINDORY_HOME_DIRECTORIES", "composeProfilesForAnswers", "redactEnvMap"]) {
  assert(installerSource.includes(token), `Installer core must include ${token}.`);
}
for (const token of ["MINDORY_CLAMAV_HEALTH_RETRIES", "MINDORY_CLAMAV_HEALTH_TIMEOUT_MS"]) {
  assert(installerSource.includes(token), `Installer ClamAV health must include ${token}.`);
  assert(envExample.includes(token), `.env.example must include ${token}.`);
}
for (const token of ["MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND", "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS", "MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND", "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS", "MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES", "MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES"]) {
  assert(installerSource.includes(token), `Installer local-command health must include ${token}.`);
  assert(envExample.includes(token), `.env.example must include ${token}.`);
  assert(composeFile.includes(token), `docker-compose.yml must include ${token}.`);
}
for (const token of ["MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER", "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND", "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND"]) {
  assert(installerSource.includes(token), `Installer ffmpeg video provider support must include ${token}.`);
  assert(envExample.includes(token), `.env.example must include ${token}.`);
  assert(composeFile.includes(token), `docker-compose.yml must include ${token}.`);
}
for (const token of ["createEncryptedMindoryBackupArchive", "restoreEncryptedMindoryBackupArchive", "uploadEncryptedMindoryBackupArchive", "downloadEncryptedMindoryBackupArchive", "aes-256-gcm"]) {
  assert(installerSource.includes(token), `Installer encrypted remote backup support must include ${token}.`);
}
for (const token of ["exportExternalS3ObjectInventory", "createExternalS3StreamingBackupArchive", "restoreExternalS3StreamingBackupArchive", "mindory-external-s3-streaming-backup", "listObjectsPage"]) {
  assert(installerSource.includes(token), `Installer external S3 streaming backup support must include ${token}.`);
}
for (const token of ["MINDORY_BACKUP_ENCRYPTION_KEY", "MINDORY_REMOTE_BACKUP_S3_ENDPOINT"]) {
  assert(installerSource.includes(token), `Installer encrypted remote backup support must include ${token}.`);
  assert(envExample.includes(token), `.env.example must include ${token}.`);
}
for (const token of ["infected_probe_not_detected", "unexpected_infected_result", "daemon_unavailable", "protocol_failure"]) {
  assert(installerSource.includes(token), `Installer ClamAV health must include ${token}.`);
}
assert(composeFile.includes("clamdscan --no-summary"), "ClamAV Compose service must include a real daemon healthcheck.");
for (const token of ["command === \"start\"", "stopBeforeStepId: null", "initialTokenPath", "mindory-installer start", "command === \"update\"", "command === \"backup\"", "command === \"backup-archive\"", "command === \"backup-upload\"", "command === \"backup-download\"", "command === \"backup-restore-archive\"", "command === \"s3-inventory\"", "command === \"s3-backup\"", "command === \"s3-restore\"", "command === \"pitr-backup\"", "command === \"pitr-restore\"", "command === \"restore\"", "command === \"uninstall\""]) {
  assert(installerCli.includes(token), `Installer CLI must expose startup command token ${token}.`);
}

const installer = await import("../packages/installer/dist/index.js");

const wizardPromptIds = installer.buildWizardPromptPlan().map((prompt) => prompt.id);
for (const promptId of [
  "install.profile",
  "install.home",
  "install.public_url",
  "av.mode",
  "storage.choice",
  "backup.remote.enabled",
  "backup.encryption.key_id",
  "backup.encryption.key",
  "backup.remote.s3.endpoint",
  "backup.remote.s3.region",
  "backup.remote.s3.bucket",
  "backup.remote.s3.access_key_id",
  "backup.remote.s3.secret_access_key",
  "backup.remote.s3.prefix",
  "vector.provider",
  "vector.qdrant_url",
  "docling.enabled",
  "docling.url",
  "docling.timeout_ms",
  "docling.port",
  "modalities.video_max_keyframes",
  "modalities.video_keyframe_provider",
  "modalities.video_ffmpeg_command",
  "modalities.video_ffprobe_command",
  "interfaces.api_port",
  "tokens.cli_api_token",
  "llm.TEXT_EMBEDDING.enabled",
  "llm.TEXT_EMBEDDING.provider",
  "llm.OCR.enabled",
  "llm.local_command.healthcheck_command",
  "llm.local_command.healthcheck_args",
  "llm.local_command.operation_command",
  "llm.local_command.operation_args"
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
  remoteBackup: {
    enabled: true,
    encryptionKeyId: "validator-key",
    encryptionKey: "validator-encryption-secret",
    s3: {
      endpoint: "http://librefs:9000",
      region: "us-east-1",
      bucket: "mindory-backups",
      accessKeyId: "backup-access",
      secretAccessKey: "backup-secret",
      forcePathStyle: true
    },
    prefix: "mindory-validator"
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
const qdrantAnswers = installer.createDefaultInstallAnswers({
  vector: {
    provider: "qdrant",
    qdrantUrl: "http://qdrant:6333",
    qdrantCollectionPrefix: "mindory-test"
  }
});
assert(installer.composeProfilesForAnswers(qdrantAnswers).includes("qdrant"), "Qdrant vector provider must enable qdrant Compose profile.");
assert(installer.answersToEnvMap(qdrantAnswers).MINDORY_VECTOR_PROVIDER === "qdrant", "Installer must render selected Qdrant vector provider.");
const doclingAnswers = installer.createDefaultInstallAnswers({
  docling: {
    enabled: true,
    url: "http://docling:8081",
    timeoutMs: 120000,
    port: 8081
  }
});
assert(installer.composeProfilesForAnswers(doclingAnswers).includes("docling"), "Docling answers must enable docling Compose profile.");
assert(installer.answersToEnvMap(doclingAnswers).MINDORY_DOCLING_ENABLED === "true", "Installer must render enabled Docling service configuration.");
assert(installer.answersToEnvMap(doclingAnswers).MINDORY_DOCLING_URL === "http://docling:8081", "Installer must render Docling service URL.");

const env = installer.answersToEnvMap(answers);
assert(env.MINDORY_HOME === "/tmp/mindory-installer-test", "Rendered env must include MINDORY_HOME.");
assert(env.MINDORY_STORAGE_PROVIDER === "s3", "Rendered env must include selected storage provider.");
assert(env.MINDORY_S3_SECRET_ACCESS_KEY === "installer-secret", "Rendered env must include raw secrets for generated .env.");
assert(env.MINDORY_REMOTE_BACKUP_ENABLED === "true", "Rendered env must include encrypted remote backup switch.");
assert(env.MINDORY_REMOTE_BACKUP_S3_SECRET_ACCESS_KEY === "backup-secret", "Rendered env must include remote backup S3 secret for generated .env.");
assert(env.MINDORY_LLM_TEXT_EMBEDDING_PROVIDER === "ollama", "Rendered env must include LLM role provider.");

const envFile = installer.renderEnvFile(answers);
assert(envFile.includes("MINDORY_S3_ENDPOINT=http://librefs:9000"), "Env file must render S3-compatible endpoint.");
assert(envFile.includes("MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS=1536"), "Env file must render embedding dimensions.");

const configJson = JSON.parse(installer.renderMindoryConfigJson(answers));
assert(configJson.mindory_home === "/tmp/mindory-installer-test", "Config JSON must include mindory_home.");
assert(configJson.storage.provider === "s3", "Config JSON must include storage provider.");
assert(configJson.remote_backup.enabled === true, "Config JSON must include remote backup settings.");
assert(configJson.docling.enabled === false, "Config JSON must include Docling service settings.");

const plan = installer.createInstallPlan(answers);
assert(plan.composeProfiles.includes("librefs"), "S3 LibreFS answers must add the librefs profile.");
assert(plan.composeProfiles.includes("clamav"), "Default antivirus answers must add the clamav profile.");
assert(plan.composeProfiles.includes("ollama"), "Ollama LLM answers must add the ollama profile.");
for (const directory of ["config", "data/postgres", "data/redis", "data/objects", "data/librefs", "logs", "backups", "install"]) {
  assert(plan.homeDirectories.includes(directory), `Install plan must include ${directory}.`);
}
for (const stepId of ["ensure-home", "write-config", "write-env", "write-compose-assets", "bootstrap-storage", "health-check"]) {
  assert(plan.steps.some((step) => step.id === stepId), `Install plan must include ${stepId}.`);
}

const summary = installer.buildRedactedInstallSummary(answers);
assert(summary.environment.MINDORY_S3_SECRET_ACCESS_KEY === "<redacted>", "Summary must redact S3 secret.");
assert(summary.environment.MINDORY_BACKUP_ENCRYPTION_KEY === "<redacted>", "Summary must redact backup encryption key.");
assert(summary.environment.MINDORY_REMOTE_BACKUP_S3_SECRET_ACCESS_KEY === "<redacted>", "Summary must redact remote backup S3 secret.");
assert(summary.environment.MINDORY_CLI_API_TOKEN === "<redacted>", "Summary must redact CLI token.");
assert(!JSON.stringify(summary).includes("installer-secret"), "Summary must not contain raw S3 secret.");
assert(!JSON.stringify(summary).includes("validator-encryption-secret"), "Summary must not contain raw backup encryption key.");
assert(!JSON.stringify(summary).includes("backup-secret"), "Summary must not contain raw remote backup S3 secret.");
assert(!JSON.stringify(summary).includes("cli-secret"), "Summary must not contain raw CLI token.");

const executionHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-exec-"));
fs.rmSync(executionHome, { recursive: true, force: true });
const executionAnswers = installer.createDefaultInstallAnswers({ mindoryHome: executionHome });
const executionReport = await installer.executeInstallPlan(executionAnswers, { sourceRoot: root, owner: "validator" });
assert(executionReport.executedStepIds.join(",") === "ensure-home,write-config,write-env,write-compose-assets", "Prepare execution must run only local filesystem/config/compose steps.");
assert(executionReport.pendingStepIds[0] === "pull-images", "Prepare execution must leave Docker startup as pending work.");
assert(fs.existsSync(path.join(executionHome, "config", "mindory.config.json")), "Prepare execution must write mindory.config.json.");
assert(fs.existsSync(path.join(executionHome, "config", ".env")), "Prepare execution must write generated .env.");
assert(fs.existsSync(path.join(executionHome, "install", "compose", "docker-compose.yml")), "Prepare execution must copy docker-compose.yml.");
assert(fs.existsSync(path.join(executionHome, "install", "compose", "release-manifest.json")), "Prepare execution must copy the release manifest.");
assert(fs.existsSync(installer.installJournalPath(executionHome)), "Prepare execution must persist the install journal.");
assert(installer.readInstallJournal(executionHome).some((entry) => entry.event === "completed" && entry.actionId === "write-compose-assets"), "Prepare journal must record completed compose asset writes.");
assert(installer.readInstallLock(executionHome) === null, "Prepare execution must release the install lock.");
fs.rmSync(executionHome, { recursive: true, force: true });

const composeHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-compose-"));
fs.rmSync(composeHome, { recursive: true, force: true });
const composeCommands = [];
const healthyComposePs = JSON.stringify([
  { Service: "postgres", State: "running", Health: "healthy" },
  { Service: "redis", State: "running", Health: "healthy" },
  { Service: "clamav", State: "running" },
  { Service: "api", State: "running", Health: "healthy" },
  { Service: "worker", State: "running", Health: "healthy" },
  { Service: "mcp", State: "running", Health: "healthy" },
  { Service: "migrate", State: "exited", ExitCode: "0" }
]);
const healthyNoClamAvComposePs = JSON.stringify([
  { Service: "postgres", State: "running", Health: "healthy" },
  { Service: "redis", State: "running", Health: "healthy" },
  { Service: "api", State: "running", Health: "healthy" },
  { Service: "worker", State: "running", Health: "healthy" },
  { Service: "mcp", State: "running", Health: "healthy" },
  { Service: "migrate", State: "exited", ExitCode: "0" }
]);
const healthyQdrantComposePs = JSON.stringify([
  { Service: "postgres", State: "running", Health: "healthy" },
  { Service: "redis", State: "running", Health: "healthy" },
  { Service: "clamav", State: "running" },
  { Service: "qdrant", State: "running", Health: "healthy" },
  { Service: "api", State: "running", Health: "healthy" },
  { Service: "worker", State: "running", Health: "healthy" },
  { Service: "mcp", State: "running", Health: "healthy" },
  { Service: "migrate", State: "exited", ExitCode: "0" }
]);
const healthyDoclingComposePs = JSON.stringify([
  { Service: "postgres", State: "running", Health: "healthy" },
  { Service: "redis", State: "running", Health: "healthy" },
  { Service: "clamav", State: "running" },
  { Service: "docling", State: "running", Health: "healthy" },
  { Service: "api", State: "running", Health: "healthy" },
  { Service: "worker", State: "running", Health: "healthy" },
  { Service: "mcp", State: "running", Health: "healthy" },
  { Service: "migrate", State: "exited", ExitCode: "0" }
]);
const composeReport = await installer.executeInstallPlan(installer.createDefaultInstallAnswers({ mindoryHome: composeHome }), {
  sourceRoot: root,
  owner: "validator",
  stopBeforeStepId: "create-first-token",
  timeoutMs: 100,
  pollIntervalMs: 1,
  apiReadyCheck: async () => true,
  commandRunner: {
    async run(command, args) {
      composeCommands.push(`${command} ${args.join(" ")}`);
      const clamAvResult = clamAvHealthCommandResult(args);
      if (clamAvResult !== null) {
        return clamAvResult;
      }
      if (args.includes("ps")) {
        return { status: 0, stdout: healthyComposePs, stderr: "" };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    }
  }
});
assert(composeReport.executedStepIds.includes("health-check"), "Compose execution must run through health-check.");
assert(composeReport.pendingStepIds[0] === "create-first-token", "Compose execution must leave first token provisioning pending.");
for (const token of ["pull --ignore-buildable", "build", "up -d postgres redis clamav", "up migrate", "up -d api worker mcp", "ps --all --format json"]) {
  assert(composeCommands.some((command) => command.includes(token)), `Compose execution must run ${token}.`);
}
assert(composeCommands.some((command) => command.includes("exec -T clamav sh -lc") && command.includes("clamdscan")), "Installer health-check must execute ClamAV scan probes.");
assert(composeCommands.some((command) => command.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")), "Installer health-check must verify an infected EICAR probe.");
fs.rmSync(composeHome, { recursive: true, force: true });

const localCommandHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-local-command-"));
fs.rmSync(localCommandHome, { recursive: true, force: true });
const localCommandCalls = [];
const localCommandAudits = [];
await installer.executeInstallPlan(installer.createDefaultInstallAnswers({
  mindoryHome: localCommandHome,
  allowExperimental: true,
  antivirus: { mode: "disabled", provider: "disabled", clamavPlatform: "linux/amd64" },
  llmProviders: {
    localCommandHealthcheckCommand: "mindory-local-health",
    localCommandHealthcheckArgs: ["healthcheck", "--role", "{role}", "--model", "{model}"],
    localCommandOperationCommand: "mindory-local-operation",
    localCommandOperationArgs: ["operate", "--role", "{role}", "--model", "{model}", "--operation", "{operation}"]
  },
  llmRoles: {
    TEXT_EMBEDDING: {
      enabled: true,
      provider: "local-command",
      model: "local-command-embedding",
      required: false,
      timeoutMs: 1000,
      concurrency: 1,
      dimensions: 1536
    }
  }
}), {
  sourceRoot: root,
  owner: "validator",
  stopBeforeStepId: "create-first-token",
  timeoutMs: 100,
  pollIntervalMs: 1,
  apiReadyCheck: async () => true,
  commandRunner: {
    async run(command, args) {
      if (args.includes("ps")) {
        return { status: 0, stdout: healthyNoClamAvComposePs, stderr: "" };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    }
  },
  llmAuditSink: (audit) => localCommandAudits.push(audit),
  llmCommandRunner: {
    async run(command, args) {
      localCommandCalls.push({ command, args });
      const role = args[args.indexOf("--role") + 1];
      const model = args[args.indexOf("--model") + 1];
      return {
        status: 0,
        stdout: JSON.stringify({ status: "ok", provider: "local-command", role, model }),
        stderr: ""
      };
    }
  }
});
assert(localCommandCalls[0]?.command === "mindory-local-health", "Installer health-check must execute configured local-command healthcheck command.");
assert(localCommandCalls[0]?.args.includes("text-embedding"), "Installer local-command healthcheck must render the configured role argument.");
assert(localCommandCalls[0]?.args.includes("local-command-embedding"), "Installer local-command healthcheck must render the configured model argument.");
assert(localCommandAudits.some((audit) => audit.role === "text-embedding" && audit.provider === "local-command" && audit.status === "success"), "Installer local-command healthcheck must emit audit events.");
fs.rmSync(localCommandHome, { recursive: true, force: true });

const clamAvHealthPlan = installer.createInstallPlan(installer.createDefaultInstallAnswers({
  mindoryHome: "/tmp/mindory-clamav-health-validator"
}));
const clamAvHealthReport = await installer.checkClamAvInstallerHealth(clamAvHealthPlan, {
  pollIntervalMs: 1,
  commandRunner: {
    async run(command, args) {
      return clamAvHealthCommandResult(args) ?? { status: 0, stdout: "ok", stderr: "" };
    }
  }
});
assert(clamAvHealthReport.status === "healthy", "ClamAV health report must succeed after clean and EICAR probes.");
assert(clamAvHealthReport.eicarProbe.output.includes("FOUND"), "ClamAV health report must record the infected probe output.");

for (const failureCase of [
  { options: { daemonUnavailable: true }, kind: "daemon_unavailable", text: "daemon is unavailable" },
  { options: { protocolFailure: true }, kind: "protocol_failure", text: "protocol failure" },
  { options: { cleanInfected: true }, kind: "unexpected_infected_result", text: "clean health probe as infected" },
  { options: { missEicar: true }, kind: "infected_probe_not_detected", text: "did not detect the EICAR" }
]) {
  let caught = null;
  try {
    await installer.checkClamAvInstallerHealth(clamAvHealthPlan, {
      pollIntervalMs: 1,
      commandRunner: {
        async run(command, args) {
          return clamAvHealthCommandResult(args, failureCase.options) ?? { status: 0, stdout: "ok", stderr: "" };
        }
      }
    });
  } catch (error) {
    caught = error;
  }
  assert(caught?.kind === failureCase.kind, `ClamAV health must report ${failureCase.kind}.`);
  assert(String(caught).includes(failureCase.text), `ClamAV ${failureCase.kind} diagnostic must include ${failureCase.text}.`);
  assert(String(caught).includes("MINDORY_CLAMAV_PLATFORM=linux/amd64"), "ClamAV diagnostics must include the platform override.");
}

const qdrantComposeHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-qdrant-compose-"));
fs.rmSync(qdrantComposeHome, { recursive: true, force: true });
const qdrantComposeCommands = [];
await installer.executeInstallPlan(installer.createDefaultInstallAnswers({
  mindoryHome: qdrantComposeHome,
  vector: {
    provider: "qdrant",
    qdrantUrl: "http://qdrant:6333",
    qdrantCollectionPrefix: "mindory-validator"
  }
}), {
  sourceRoot: root,
  owner: "validator",
  stopBeforeStepId: "create-first-token",
  timeoutMs: 100,
  pollIntervalMs: 1,
  apiReadyCheck: async () => true,
  commandRunner: {
    async run(command, args) {
      qdrantComposeCommands.push(`${command} ${args.join(" ")}`);
      const clamAvResult = clamAvHealthCommandResult(args);
      if (clamAvResult !== null) {
        return clamAvResult;
      }
      if (args.includes("ps")) {
        return { status: 0, stdout: healthyQdrantComposePs, stderr: "" };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    }
  }
});
assert(qdrantComposeCommands.some((command) => command.includes("--profile qdrant")), "Qdrant vector provider must enable the qdrant Compose profile.");
assert(qdrantComposeCommands.some((command) => command.includes("up -d postgres redis clamav qdrant")), "Qdrant vector provider must start and health-check the qdrant service.");
fs.rmSync(qdrantComposeHome, { recursive: true, force: true });

const doclingComposeHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-docling-compose-"));
fs.rmSync(doclingComposeHome, { recursive: true, force: true });
const doclingComposeCommands = [];
await installer.executeInstallPlan(installer.createDefaultInstallAnswers({
  mindoryHome: doclingComposeHome,
  docling: {
    enabled: true,
    url: "http://docling:8081",
    timeoutMs: 120000,
    port: 8081
  }
}), {
  sourceRoot: root,
  owner: "validator",
  stopBeforeStepId: "create-first-token",
  timeoutMs: 100,
  pollIntervalMs: 1,
  apiReadyCheck: async () => true,
  commandRunner: {
    async run(command, args) {
      doclingComposeCommands.push(`${command} ${args.join(" ")}`);
      const clamAvResult = clamAvHealthCommandResult(args);
      if (clamAvResult !== null) {
        return clamAvResult;
      }
      if (args.includes("ps")) {
        return { status: 0, stdout: healthyDoclingComposePs, stderr: "" };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    }
  }
});
assert(doclingComposeCommands.some((command) => command.includes("--profile docling")), "Docling service answers must enable the docling Compose profile.");
assert(doclingComposeCommands.some((command) => command.includes("up -d postgres redis clamav docling")), "Docling service answers must start and health-check the docling service.");
fs.rmSync(doclingComposeHome, { recursive: true, force: true });

const librefsHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-librefs-"));
fs.rmSync(librefsHome, { recursive: true, force: true });
const librefsCommands = [];
await installer.executeInstallPlan(installer.createDefaultInstallAnswers({
  mindoryHome: librefsHome,
  antivirus: { mode: "disabled", provider: "disabled", clamavPlatform: "linux/amd64" },
  storage: {
    provider: "s3",
    localPath: "/data/mindory/objects",
    s3: {
      endpoint: "http://librefs:9000",
      region: "us-east-1",
      bucket: "mindory-validator",
      accessKeyId: "validator-access",
      secretAccessKey: "validator-secret",
      forcePathStyle: true
    }
  }
}), {
  sourceRoot: root,
  owner: "validator",
  stopBeforeStepId: "run-migrations",
  commandRunner: {
    async run(command, args) {
      librefsCommands.push(`${command} ${args.join(" ")}`);
      return { status: 0, stdout: "ok", stderr: "" };
    }
  }
});
assert(librefsCommands.some((command) => command.includes("--profile librefs")), "LibreFS install must enable the librefs Compose profile.");
assert(librefsCommands.some((command) => command.includes("up -d postgres redis librefs")), "LibreFS install must start the local S3-compatible service.");
assert(librefsCommands.some((command) => command.includes("up librefs-bucket")), "LibreFS install must run bucket bootstrap.");
fs.rmSync(librefsHome, { recursive: true, force: true });

const externalS3Answers = installer.createDefaultInstallAnswers({
  storage: {
    provider: "s3",
    localPath: "/data/mindory/objects",
    s3: {
      endpoint: "http://s3.example.test",
      region: "us-east-1",
      bucket: "mindory-validator",
      accessKeyId: "validator-access",
      secretAccessKey: "validator-secret",
      forcePathStyle: true
    }
  }
});
const s3Calls = [];
await installer.checkS3StorageAccess(externalS3Answers, async (url, init) => {
  const headers = init.headers;
  s3Calls.push({
    method: init.method,
    url: String(url),
    authorization: headers.get("authorization")
  });
  return new Response("", { status: s3Calls.length === 1 ? 404 : 200 });
});
assert(s3Calls.map((call) => call.method).join(",") === "HEAD,PUT,HEAD", "External S3 credential check must HEAD, create and recheck the bucket.");
assert(s3Calls.every((call) => call.authorization.startsWith("AWS4-HMAC-SHA256")), "External S3 credential check must sign requests.");

const provisionHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-provision-"));
fs.rmSync(provisionHome, { recursive: true, force: true });
const provisionCommands = [];
const provisionCredentials = {
  projectId: "validator-project",
  projectName: "Validator Project",
  tokenId: "tok_validator_install",
  token: "mindory_validator_secret",
  apiUrl: "http://localhost:3000"
};
const provisionReport = await installer.executeInstallPlan(installer.createDefaultInstallAnswers({ mindoryHome: provisionHome }), {
  sourceRoot: root,
  owner: "validator",
  stopBeforeStepId: null,
  timeoutMs: 100,
  pollIntervalMs: 1,
  firstRunCredentials: provisionCredentials,
  apiReadyCheck: async () => true,
  commandRunner: {
    async run(command, args) {
      provisionCommands.push(`${command} ${args.join(" ")}`);
      const clamAvResult = clamAvHealthCommandResult(args);
      if (clamAvResult !== null) {
        return clamAvResult;
      }
      if (args.includes("ps")) {
        return { status: 0, stdout: healthyComposePs, stderr: "" };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    }
  }
});
assert(provisionReport.executedStepIds.at(-1) === "create-first-token", "Full execution must finish with first-token provisioning.");
assert(provisionReport.pendingStepIds.length === 0, "Full execution must leave no pending steps.");
const initialToken = JSON.parse(fs.readFileSync(path.join(provisionHome, "config", "initial-token.json"), "utf8"));
assert(initialToken.project_id === "validator-project", "Initial token file must include project id.");
assert(initialToken.token === "mindory_validator_secret", "Initial token file must include the raw one-time token.");
assert(provisionCommands.some((command) => command.includes("scripts/provision-first-token.js")), "Provisioning must run the first-token script through Compose.");
assert(provisionCommands.some((command) => command.includes("MINDORY_INITIAL_PROJECT_ID=validator-project")), "Provisioning command must pass project id.");
assert(provisionCommands.some((command) => command.includes("MINDORY_INITIAL_TOKEN=mindory_validator_secret")), "Provisioning command must pass raw token.");
fs.rmSync(provisionHome, { recursive: true, force: true });

const provisionRollbackHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-provision-rollback-"));
fs.rmSync(provisionRollbackHome, { recursive: true, force: true });
let provisionRollbackThrown = false;
try {
  await installer.executeInstallPlan(installer.createDefaultInstallAnswers({ mindoryHome: provisionRollbackHome }), {
    sourceRoot: root,
    owner: "validator",
    stopBeforeStepId: null,
    timeoutMs: 100,
    pollIntervalMs: 1,
    firstRunCredentials: provisionCredentials,
    apiReadyCheck: async () => true,
    commandRunner: {
      async run(command, args) {
        const clamAvResult = clamAvHealthCommandResult(args);
        if (clamAvResult !== null) {
          return clamAvResult;
        }
        if (args.includes("ps")) {
          return { status: 0, stdout: healthyComposePs, stderr: "" };
        }
        if (args.includes("scripts/provision-first-token.js")) {
          return { status: 1, stdout: "", stderr: "provision failed" };
        }
        return { status: 0, stdout: "ok", stderr: "" };
      }
    }
  });
} catch (error) {
  provisionRollbackThrown = String(error).includes("provision failed");
}
assert(provisionRollbackThrown, "Provisioning failures must be surfaced.");
assert(!fs.existsSync(path.join(provisionRollbackHome, "config", "initial-token.json")), "Provisioning failure must remove generated initial-token.json.");
fs.rmSync(provisionRollbackHome, { recursive: true, force: true });

const updateHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-update-"));
fs.rmSync(updateHome, { recursive: true, force: true });
const updateAnswers = installer.createDefaultInstallAnswers({ mindoryHome: updateHome });
const dryRunUpdate = await installer.updateInstallAssets(updateAnswers, { dryRun: true, sourceRoot: root });
assert(dryRunUpdate.dryRun === true, "Update dry-run must report dryRun=true.");
assert(!fs.existsSync(updateHome), "Update dry-run must not create MINDORY_HOME.");
await installer.executeInstallPlan(updateAnswers, { sourceRoot: root, owner: "validator" });
const originalEnv = fs.readFileSync(path.join(updateHome, "config", ".env"), "utf8");
const updateReport = await installer.updateInstallAssets(updateAnswers, { sourceRoot: root, owner: "validator" });
assert(updateReport.backup?.copiedPaths.includes("config"), "Update apply must back up config.");
assert(fs.existsSync(updateReport.backup.backupPath), "Update apply must create a backup directory.");
assert(fs.readFileSync(path.join(updateHome, "config", ".env"), "utf8") === originalEnv, "Update apply must leave rendered env in place.");
const inspectedState = installer.inspectInstallState(updateHome);
assert(inspectedState.journalEntries > 0, "Repair inspection must summarize journal entries.");
fs.rmSync(updateHome, { recursive: true, force: true });

const updateRollbackHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-update-rollback-"));
fs.rmSync(updateRollbackHome, { recursive: true, force: true });
const updateRollbackAnswers = installer.createDefaultInstallAnswers({ mindoryHome: updateRollbackHome });
await installer.executeInstallPlan(updateRollbackAnswers, { sourceRoot: root, owner: "validator" });
const existingEnvPath = path.join(updateRollbackHome, "config", ".env");
fs.writeFileSync(existingEnvPath, "MINDORY_HOME=old\n");
let updateRollbackThrown = false;
try {
  await installer.updateInstallAssets(updateRollbackAnswers, {
    sourceRoot: root,
    owner: "validator",
    beforeStep(step) {
      if (step.id === "write-env") {
        throw new Error("forced update failure");
      }
    }
  });
} catch (error) {
  updateRollbackThrown = String(error).includes("forced update failure");
}
assert(updateRollbackThrown, "Update failure must be surfaced.");
assert(fs.readFileSync(existingEnvPath, "utf8") === "MINDORY_HOME=old\n", "Update failure must restore previous config from backup.");
fs.rmSync(updateRollbackHome, { recursive: true, force: true });

const uninstallHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-uninstall-"));
fs.writeFileSync(path.join(uninstallHome, "marker.txt"), "installed");
let uninstallRejected = false;
try {
  installer.uninstallMindoryHome(uninstallHome, { yes: false });
} catch (error) {
  uninstallRejected = String(error).includes("requires explicit confirmation");
}
assert(uninstallRejected, "Uninstall must require explicit confirmation.");
const uninstallReport = installer.uninstallMindoryHome(uninstallHome, { yes: true, backup: true });
assert(uninstallReport.removed === true, "Uninstall must report removal.");
assert(!fs.existsSync(uninstallHome), "Uninstall must remove MINDORY_HOME.");
assert(fs.existsSync(uninstallReport.backupPath), "Uninstall backup must be created when requested.");
fs.rmSync(uninstallReport.backupPath, { recursive: true, force: true });

const composeRollbackHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-compose-rollback-"));
fs.rmSync(composeRollbackHome, { recursive: true, force: true });
const rollbackCommands = [];
let composeRollbackThrown = false;
try {
  await installer.executeInstallPlan(installer.createDefaultInstallAnswers({ mindoryHome: composeRollbackHome }), {
    sourceRoot: root,
    owner: "validator",
    stopBeforeStepId: "create-first-token",
    timeoutMs: 100,
    pollIntervalMs: 1,
    apiReadyCheck: async () => true,
    commandRunner: {
      async run(command, args) {
        rollbackCommands.push(`${command} ${args.join(" ")}`);
        const clamAvResult = clamAvHealthCommandResult(args);
        if (clamAvResult !== null) {
          return clamAvResult;
        }
        if (args.join(" ").includes("up -d api worker mcp")) {
          return { status: 1, stdout: "", stderr: "runtime failed" };
        }
        return { status: 0, stdout: args.includes("ps") ? healthyComposePs : "ok", stderr: "" };
      }
    }
  });
} catch (error) {
  composeRollbackThrown = String(error).includes("runtime failed");
}
assert(composeRollbackThrown, "Compose execution must surface runtime startup failures.");
assert(rollbackCommands.some((command) => command.includes("down --remove-orphans")), "Compose rollback must run compose down.");
const composeRollbackJournal = installer.readInstallJournal(composeRollbackHome);
assert(composeRollbackJournal !== null, "Compose rollback must leave a journal.");
assert(composeRollbackJournal.some((entry) => entry.event === "rollback_completed" && entry.actionId === "start-infra"), "Compose rollback must record compose_down rollback completion.");
fs.rmSync(composeRollbackHome, { recursive: true, force: true });

const rollbackHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-installer-rollback-"));
fs.rmSync(rollbackHome, { recursive: true, force: true });
let rollbackThrown = false;
try {
  await installer.executeInstallPlan(installer.createDefaultInstallAnswers({ mindoryHome: rollbackHome }), {
    sourceRoot: root,
    owner: "validator",
    beforeStep(step) {
      if (step.id === "write-env") {
        throw new Error("forced prepare failure");
      }
    }
  });
} catch (error) {
  rollbackThrown = String(error).includes("forced prepare failure");
}
assert(rollbackThrown, "Prepare execution must surface step failures.");
assert(!fs.existsSync(path.join(rollbackHome, "config", "mindory.config.json")), "Prepare rollback must remove generated config files.");
const rollbackJournal = installer.readInstallJournal(rollbackHome);
assert(rollbackJournal !== null, "Prepare rollback must leave a journal for repair diagnostics.");
assert(rollbackJournal.some((entry) => entry.event === "rollback_completed" && entry.actionId === "write-config"), "Prepare rollback must record completed rollback entries.");
assert(installer.readInstallLock(rollbackHome) === null, "Failed prepare execution must release the install lock.");
fs.rmSync(rollbackHome, { recursive: true, force: true });

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

const futureProviderAnswers = installer.createDefaultInstallAnswers({
  llmRoles: {
    IMAGE_EMBEDDING: {
      enabled: true,
      provider: "local-command",
      model: "local-command-image-embedding",
      required: false,
      timeoutMs: 60000,
      concurrency: 1,
      dimensions: 3
    }
  }
});
const futureProviderErrors = installer.validateInstallAnswers(futureProviderAnswers);
assert(futureProviderErrors.some((error) => error.includes("provider local-command requires experimental mode") || error.includes("llmRoles.IMAGE_EMBEDDING.enabled requires experimental mode")), "Installer validation must block experimental LLM providers unless experimental mode is enabled.");
assert(futureProviderErrors.some((error) => error.includes("localCommandHealthcheckCommand is required")), "Installer validation must require local-command healthcheck command when local-command provider is enabled.");
assert(futureProviderErrors.some((error) => error.includes("localCommandOperationCommand is required")), "Installer validation must require local-command operation command when local-command provider is enabled.");
const allowedFutureProviderErrors = installer.validateInstallAnswers({
  ...futureProviderAnswers,
  allowExperimental: true
});
assert(!allowedFutureProviderErrors.some((error) => error.includes("requires experimental mode")), "Installer validation must allow future LLM providers when experimental mode is enabled.");
const configuredLocalCommandProviderErrors = installer.validateInstallAnswers(installer.createDefaultInstallAnswers({
  ...futureProviderAnswers,
  allowExperimental: true,
  llmProviders: {
    localCommandHealthcheckCommand: "mindory-local-health",
    localCommandHealthcheckArgs: ["healthcheck", "--role", "{role}", "--model", "{model}"],
    localCommandOperationCommand: "mindory-local-operation",
    localCommandOperationArgs: ["operate", "--role", "{role}", "--model", "{model}", "--operation", "{operation}"]
  }
}));
assert(configuredLocalCommandProviderErrors.length === 0, "Installer validation must accept configured local-command healthcheck contract when experimental mode is enabled.");

console.log("Installer core and wizard validated.");
