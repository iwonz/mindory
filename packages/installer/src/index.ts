import { spawnSync } from "node:child_process";
import { constants, existsSync, accessSync, statSync } from "node:fs";
import path from "node:path";
import {
  CONFIG_CATALOG,
  type AntivirusMode,
  type ConfigCatalogEntry,
  type InstallDependencyPolicy,
  type InstallProfile,
  type LlmOpenAiAuthMode,
  type LlmProvider,
  type StorageProvider
} from "@mindory/config";

export const INSTALLER_SCHEMA_VERSION = 1;

export const MINDORY_HOME_DIRECTORIES = [
  "config",
  "data/postgres",
  "data/redis",
  "data/objects",
  "data/librefs",
  "logs",
  "backups",
  "install"
] as const;

export const LLM_ROLE_KEYS = [
  "CHAT",
  "TEXT_EMBEDDING",
  "IMAGE_EMBEDDING",
  "VISION_CAPTIONING",
  "OCR",
  "ASR",
  "FACE_DETECTION",
  "FACE_RECOGNITION",
  "IMAGE_GENERATION",
  "AUDIO_GENERATION"
] as const;

const FLAT_CONFIG_CATALOG = CONFIG_CATALOG.flat() as readonly ConfigCatalogEntry[];

export type InstallerSchemaVersion = typeof INSTALLER_SCHEMA_VERSION;
export type InstallerLlmRoleKey = (typeof LLM_ROLE_KEYS)[number];
export type InstallStepKind =
  | "filesystem"
  | "config"
  | "compose"
  | "docker"
  | "migration"
  | "runtime"
  | "token"
  | "healthcheck";
export type RollbackStepKind = "delete_path" | "restore_file" | "compose_down" | "none";
export type DependencyStatus = "ok" | "missing" | "failed" | "skipped";
export type InstallJournalEvent =
  | "planned"
  | "completed"
  | "failed"
  | "rollback_completed"
  | "rollback_failed"
  | "rollback_skipped";

export interface S3StorageAnswers {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface StorageAnswers {
  provider: StorageProvider;
  localPath: string;
  s3: S3StorageAnswers;
}

export interface AntivirusAnswers {
  mode: AntivirusMode;
  provider: string;
  clamavPlatform: string;
}

export interface ModalityAnswers {
  text: boolean;
  pdf: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  videoMaxKeyframes: number;
}

export interface LlmRoleAnswers {
  enabled: boolean;
  provider: LlmProvider;
  model: string;
  required: boolean;
  timeoutMs: number;
  concurrency: number;
  dimensions?: number | null;
}

export interface LlmProviderAnswers {
  openaiCompatibleBaseUrl: string;
  openaiCompatibleAuthMode: LlmOpenAiAuthMode;
  openaiCompatibleApiKey: string;
  openaiOAuthAccessToken: string;
  ollamaBaseUrl: string;
  localHttpBaseUrl: string;
  localCommandTimeoutMs: number;
}

export interface InterfaceAnswers {
  apiPort: number;
  mcpEnabled: boolean;
  hermesEnabled: boolean;
}

export interface TokenAnswers {
  mcpApiToken: string;
  cliApiToken: string;
  hermesApiToken: string;
}

export interface MindoryInstallAnswers {
  schemaVersion: InstallerSchemaVersion;
  mindoryHome: string;
  profile: InstallProfile;
  releaseChannel: string;
  allowExperimental: boolean;
  dependencyPolicy: InstallDependencyPolicy;
  rollbackOnFailure: boolean;
  devMode: boolean;
  publicUrl: string;
  storage: StorageAnswers;
  antivirus: AntivirusAnswers;
  modalities: ModalityAnswers;
  llmRoles: Partial<Record<InstallerLlmRoleKey, LlmRoleAnswers>>;
  llmProviders: LlmProviderAnswers;
  interfaces: InterfaceAnswers;
  tokens: TokenAnswers;
}

export interface InstallRollbackStep {
  kind: RollbackStepKind;
  target?: string;
  description: string;
}

export interface InstallPlanStep {
  id: string;
  title: string;
  kind: InstallStepKind;
  required: boolean;
  rollback: InstallRollbackStep;
}

export interface InstallPlan {
  schemaVersion: InstallerSchemaVersion;
  mindoryHome: string;
  releaseChannel: string;
  profile: InstallProfile;
  composeProfiles: string[];
  homeDirectories: readonly string[];
  environment: Record<string, string>;
  steps: InstallPlanStep[];
}

export interface InstallJournalEntry {
  sequence: number;
  actionId: string;
  event: InstallJournalEvent;
  message: string;
  rollback?: InstallRollbackStep;
  error?: string;
}

export interface RollbackExecution {
  actionId: string;
  status: "completed" | "failed" | "skipped";
  error?: string;
}

export interface RollbackReport {
  executions: RollbackExecution[];
}

export interface DependencyProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface DependencyProbe {
  run(command: string, args: readonly string[]): DependencyProbeResult;
  isWritable(targetPath: string): boolean;
  isPortAvailable(port: number): boolean;
  diskSpaceBytes(targetPath: string): number | null;
}

export interface DependencyCheck {
  id: string;
  label: string;
  status: DependencyStatus;
  required: boolean;
  diagnosis?: string;
  manualFix?: string;
}

export type RollbackExecutor = (rollback: InstallRollbackStep, step: InstallPlanStep) => Promise<void> | void;

export function createDefaultInstallAnswers(overrides: Partial<MindoryInstallAnswers> = {}): MindoryInstallAnswers {
  const defaults: MindoryInstallAnswers = {
    schemaVersion: INSTALLER_SCHEMA_VERSION,
    mindoryHome: catalogDefault("MINDORY_HOME"),
    profile: catalogDefault("MINDORY_INSTALL_PROFILE") as InstallProfile,
    releaseChannel: catalogDefault("MINDORY_INSTALL_RELEASE_CHANNEL"),
    allowExperimental: catalogDefault("MINDORY_INSTALL_ALLOW_EXPERIMENTAL") === "true",
    dependencyPolicy: catalogDefault("MINDORY_INSTALL_DEPENDENCY_POLICY") as InstallDependencyPolicy,
    rollbackOnFailure: catalogDefault("MINDORY_INSTALL_ROLLBACK_ON_FAILURE") === "true",
    devMode: catalogDefault("MINDORY_INSTALL_DEV_MODE") === "true",
    publicUrl: catalogDefault("MINDORY_PUBLIC_URL"),
    storage: {
      provider: catalogDefault("MINDORY_STORAGE_PROVIDER") as StorageProvider,
      localPath: catalogDefault("MINDORY_STORAGE_LOCAL_PATH"),
      s3: {
        endpoint: catalogDefault("MINDORY_S3_ENDPOINT"),
        region: catalogDefault("MINDORY_S3_REGION"),
        bucket: catalogDefault("MINDORY_S3_BUCKET"),
        accessKeyId: catalogDefault("MINDORY_S3_ACCESS_KEY_ID"),
        secretAccessKey: catalogDefault("MINDORY_S3_SECRET_ACCESS_KEY"),
        forcePathStyle: catalogDefault("MINDORY_S3_FORCE_PATH_STYLE") === "true"
      }
    },
    antivirus: {
      mode: catalogDefault("MINDORY_AV_MODE") as AntivirusMode,
      provider: catalogDefault("MINDORY_AV_PROVIDER"),
      clamavPlatform: catalogDefault("MINDORY_CLAMAV_PLATFORM")
    },
    modalities: {
      text: catalogDefault("MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED") === "true",
      pdf: catalogDefault("MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED") === "true",
      image: catalogDefault("MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED") === "true",
      audio: catalogDefault("MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED") === "true",
      video: catalogDefault("MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED") === "true",
      videoMaxKeyframes: Number.parseInt(catalogDefault("MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES"), 10)
    },
    llmRoles: {},
    llmProviders: {
      openaiCompatibleBaseUrl: catalogDefault("MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL"),
      openaiCompatibleAuthMode: catalogDefault("MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE") as LlmOpenAiAuthMode,
      openaiCompatibleApiKey: catalogDefault("MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY"),
      openaiOAuthAccessToken: catalogDefault("MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN"),
      ollamaBaseUrl: catalogDefault("MINDORY_LLM_OLLAMA_BASE_URL"),
      localHttpBaseUrl: catalogDefault("MINDORY_LLM_LOCAL_HTTP_BASE_URL"),
      localCommandTimeoutMs: Number.parseInt(catalogDefault("MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS"), 10)
    },
    interfaces: {
      apiPort: Number.parseInt(catalogDefault("MINDORY_API_PORT"), 10),
      mcpEnabled: catalogDefault("MINDORY_MCP_ENABLED") === "true",
      hermesEnabled: catalogDefault("MINDORY_HERMES_ADAPTER_ENABLED") === "true"
    },
    tokens: {
      mcpApiToken: catalogDefault("MINDORY_MCP_API_TOKEN"),
      cliApiToken: catalogDefault("MINDORY_CLI_API_TOKEN"),
      hermesApiToken: catalogDefault("MINDORY_HERMES_API_TOKEN")
    }
  };

  return mergeAnswers(defaults, overrides);
}

export function validateInstallAnswers(answers: MindoryInstallAnswers): string[] {
  const errors: string[] = [];
  if (answers.schemaVersion !== INSTALLER_SCHEMA_VERSION) {
    errors.push(`Unsupported installer schema version ${answers.schemaVersion}.`);
  }
  if (answers.mindoryHome.trim() === "") {
    errors.push("mindoryHome is required.");
  }
  validateCatalogValue(errors, "MINDORY_INSTALL_PROFILE", answers.profile);
  validateCatalogValue(errors, "MINDORY_INSTALL_DEPENDENCY_POLICY", answers.dependencyPolicy);
  validateCatalogValue(errors, "MINDORY_STORAGE_PROVIDER", answers.storage.provider);
  validateCatalogValue(errors, "MINDORY_AV_MODE", answers.antivirus.mode);
  validateCatalogValue(errors, "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE", answers.llmProviders.openaiCompatibleAuthMode);
  if (answers.interfaces.apiPort <= 0 || answers.interfaces.apiPort > 65535) {
    errors.push("interfaces.apiPort must be a valid TCP port.");
  }
  if (answers.modalities.videoMaxKeyframes <= 0) {
    errors.push("modalities.videoMaxKeyframes must be greater than zero.");
  }
  for (const [role, roleAnswers] of Object.entries(answers.llmRoles)) {
    if (!LLM_ROLE_KEYS.includes(role as InstallerLlmRoleKey)) {
      errors.push(`Unknown LLM role ${role}.`);
      continue;
    }
    validateCatalogValue(errors, `MINDORY_LLM_${role}_PROVIDER`, roleAnswers.provider);
    if (roleAnswers.timeoutMs <= 0) {
      errors.push(`llmRoles.${role}.timeoutMs must be greater than zero.`);
    }
    if (roleAnswers.concurrency <= 0) {
      errors.push(`llmRoles.${role}.concurrency must be greater than zero.`);
    }
    if (roleAnswers.enabled && roleAnswers.provider !== "disabled" && roleAnswers.model.trim() === "") {
      errors.push(`llmRoles.${role}.model is required when the role is enabled.`);
    }
  }
  return errors;
}

export function createInstallPlan(answers: MindoryInstallAnswers): InstallPlan {
  const errors = validateInstallAnswers(answers);
  if (errors.length > 0) {
    throw new Error(`Invalid install answers: ${errors.join(" ")}`);
  }
  const environment = answersToEnvMap(answers);
  return {
    schemaVersion: INSTALLER_SCHEMA_VERSION,
    mindoryHome: answers.mindoryHome,
    releaseChannel: answers.releaseChannel,
    profile: answers.profile,
    composeProfiles: composeProfilesForAnswers(answers),
    homeDirectories: MINDORY_HOME_DIRECTORIES,
    environment,
    steps: [
      step("ensure-home", "Create MINDORY_HOME directory tree", "filesystem", "delete_path", answers.mindoryHome),
      step("write-config", "Write mindory.config.json", "config", "restore_file", path.posix.join(answers.mindoryHome, "config/mindory.config.json")),
      step("write-env", "Write generated .env", "config", "restore_file", path.posix.join(answers.mindoryHome, "config/.env")),
      step("write-compose-assets", "Write release Compose assets", "compose", "restore_file", path.posix.join(answers.mindoryHome, "install/compose")),
      step("pull-images", "Pull or build required container images", "docker", "none"),
      step("start-infra", "Start Postgres, Redis and optional infrastructure", "docker", "compose_down"),
      step("run-migrations", "Run database migrations", "migration", "none"),
      step("start-runtime", "Start API, worker and MCP package smoke services", "runtime", "compose_down"),
      step("create-first-token", "Create initial project and API token", "token", "restore_file", path.posix.join(answers.mindoryHome, "config/initial-token.json")),
      step("health-check", "Run install health checks", "healthcheck", "none")
    ]
  };
}

export class InstallTransactionJournal {
  private sequence = 0;
  private readonly entries: InstallJournalEntry[] = [];
  private readonly completed = new Set<string>();

  recordPlanned(step: InstallPlanStep): void {
    this.push(step.id, "planned", step.title, step.rollback);
  }

  markCompleted(step: InstallPlanStep): void {
    this.completed.add(step.id);
    this.push(step.id, "completed", step.title, step.rollback);
  }

  markFailed(step: InstallPlanStep, error: unknown): void {
    this.push(step.id, "failed", step.title, step.rollback, errorToString(error));
  }

  recordRollback(step: InstallPlanStep, status: RollbackExecution["status"], error?: unknown): void {
    const event = status === "completed" ? "rollback_completed" : status === "skipped" ? "rollback_skipped" : "rollback_failed";
    this.push(step.id, event, step.rollback.description, step.rollback, error === undefined ? undefined : errorToString(error));
  }

  completedActionIds(): string[] {
    return Array.from(this.completed);
  }

  toJSON(): InstallJournalEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  private push(actionId: string, event: InstallJournalEvent, message: string, rollback?: InstallRollbackStep, error?: string): void {
    const entry: InstallJournalEntry = {
      sequence: ++this.sequence,
      actionId,
      event,
      message
    };
    if (rollback !== undefined) {
      entry.rollback = rollback;
    }
    if (error !== undefined) {
      entry.error = error;
    }
    this.entries.push(entry);
  }
}

export async function rollbackCompletedActions(
  plan: InstallPlan,
  journal: InstallTransactionJournal,
  executor: RollbackExecutor
): Promise<RollbackReport> {
  const completed = journal.completedActionIds();
  const steps = completed
    .map((actionId) => plan.steps.find((stepItem) => stepItem.id === actionId))
    .filter((stepItem): stepItem is InstallPlanStep => stepItem !== undefined)
    .reverse();
  const executions: RollbackExecution[] = [];

  for (const stepItem of steps) {
    if (stepItem.rollback.kind === "none") {
      const execution: RollbackExecution = { actionId: stepItem.id, status: "skipped" };
      journal.recordRollback(stepItem, "skipped");
      executions.push(execution);
      continue;
    }
    try {
      await executor(stepItem.rollback, stepItem);
      const execution: RollbackExecution = { actionId: stepItem.id, status: "completed" };
      journal.recordRollback(stepItem, "completed");
      executions.push(execution);
    } catch (error) {
      const execution: RollbackExecution = { actionId: stepItem.id, status: "failed", error: errorToString(error) };
      journal.recordRollback(stepItem, "failed", error);
      executions.push(execution);
    }
  }

  return { executions };
}

export function createNodeDependencyProbe(): DependencyProbe {
  return {
    run(command, args) {
      const result = spawnSync(command, [...args], { encoding: "utf8" });
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? ""
      };
    },
    isWritable(targetPath) {
      const candidate = existsSync(targetPath) ? targetPath : nearestExistingParent(targetPath);
      try {
        accessSync(candidate, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    isPortAvailable() {
      return true;
    },
    diskSpaceBytes() {
      return null;
    }
  };
}

export function detectHostDependencies(answers: MindoryInstallAnswers, probe: DependencyProbe = createNodeDependencyProbe()): DependencyCheck[] {
  const checks: DependencyCheck[] = [];
  const dockerCompose = probe.run("docker", ["compose", "version"]);
  checks.push(commandCheck("docker-compose", "Docker Compose plugin", dockerCompose, true, "Install Docker Desktop or Docker Engine with the Compose plugin."));
  const dockerDaemon = probe.run("docker", ["info"]);
  checks.push(commandCheck("docker-daemon", "Docker daemon", dockerDaemon, true, "Start Docker Desktop or the Docker daemon."));

  if (answers.devMode || answers.profile === "dev-test") {
    checks.push(commandCheck("node", "Node.js", probe.run("node", ["--version"]), true, "Install Node.js 22 or newer."));
    checks.push(commandCheck("pnpm", "pnpm", probe.run("pnpm", ["--version"]), true, "Enable corepack or install pnpm 10 or newer."));
  } else {
    checks.push({ id: "node", label: "Node.js", status: "skipped", required: false });
    checks.push({ id: "pnpm", label: "pnpm", status: "skipped", required: false });
  }

  const homeWritable = probe.isWritable(answers.mindoryHome);
  checks.push({
    id: "mindory-home-writable",
    label: "MINDORY_HOME writable",
    status: homeWritable ? "ok" : "failed",
    required: true,
    ...(homeWritable ? {} : { diagnosis: `${answers.mindoryHome} is not writable.` }),
    manualFix: "Choose a writable MINDORY_HOME or adjust directory permissions."
  });
  const apiPortAvailable = probe.isPortAvailable(answers.interfaces.apiPort);
  checks.push({
    id: "api-port",
    label: `API port ${answers.interfaces.apiPort}`,
    status: apiPortAvailable ? "ok" : "failed",
    required: true,
    ...(apiPortAvailable ? {} : { diagnosis: `Port ${answers.interfaces.apiPort} is already in use.` }),
    manualFix: "Choose another MINDORY_API_PORT or stop the conflicting process."
  });

  const diskSpaceBytes = probe.diskSpaceBytes(answers.mindoryHome);
  checks.push({
    id: "disk-space",
    label: "Available disk space",
    status: diskSpaceBytes === null || diskSpaceBytes >= 5_000_000_000 ? "ok" : "failed",
    required: true,
    diagnosis: diskSpaceBytes === null ? "Disk space could not be measured by this probe." : `${diskSpaceBytes} bytes available.`,
    manualFix: "Free at least 5GB for local runtime state."
  });

  return checks;
}

export function answersToEnvMap(answers: MindoryInstallAnswers): Record<string, string> {
  const env = Object.fromEntries(FLAT_CONFIG_CATALOG.map((entry) => [entry.name, entry.defaultValue]));
  assign(env, "MINDORY_HOME", answers.mindoryHome);
  assign(env, "MINDORY_INSTALL_PROFILE", answers.profile);
  assign(env, "MINDORY_INSTALL_RELEASE_CHANNEL", answers.releaseChannel);
  assign(env, "MINDORY_INSTALL_ALLOW_EXPERIMENTAL", bool(answers.allowExperimental));
  assign(env, "MINDORY_INSTALL_DEPENDENCY_POLICY", answers.dependencyPolicy);
  assign(env, "MINDORY_INSTALL_ROLLBACK_ON_FAILURE", bool(answers.rollbackOnFailure));
  assign(env, "MINDORY_INSTALL_DEV_MODE", bool(answers.devMode));
  assign(env, "MINDORY_PUBLIC_URL", answers.publicUrl);
  assign(env, "MINDORY_API_PORT", String(answers.interfaces.apiPort));
  assign(env, "MINDORY_STORAGE_PROVIDER", answers.storage.provider);
  assign(env, "MINDORY_STORAGE_LOCAL_PATH", answers.storage.localPath);
  assign(env, "MINDORY_S3_ENDPOINT", answers.storage.s3.endpoint);
  assign(env, "MINDORY_S3_REGION", answers.storage.s3.region);
  assign(env, "MINDORY_S3_BUCKET", answers.storage.s3.bucket);
  assign(env, "MINDORY_S3_ACCESS_KEY_ID", answers.storage.s3.accessKeyId);
  assign(env, "MINDORY_S3_SECRET_ACCESS_KEY", answers.storage.s3.secretAccessKey);
  assign(env, "MINDORY_S3_FORCE_PATH_STYLE", bool(answers.storage.s3.forcePathStyle));
  assign(env, "MINDORY_AV_MODE", answers.antivirus.mode);
  assign(env, "MINDORY_AV_PROVIDER", answers.antivirus.provider);
  assign(env, "MINDORY_CLAMAV_PLATFORM", answers.antivirus.clamavPlatform);
  assign(env, "MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED", bool(answers.modalities.text));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED", bool(answers.modalities.pdf));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED", bool(answers.modalities.image));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED", bool(answers.modalities.audio));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED", bool(answers.modalities.video));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", String(answers.modalities.videoMaxKeyframes));
  assign(env, "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL", answers.llmProviders.openaiCompatibleBaseUrl);
  assign(env, "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE", answers.llmProviders.openaiCompatibleAuthMode);
  assign(env, "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY", answers.llmProviders.openaiCompatibleApiKey);
  assign(env, "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN", answers.llmProviders.openaiOAuthAccessToken);
  assign(env, "MINDORY_LLM_OLLAMA_BASE_URL", answers.llmProviders.ollamaBaseUrl);
  assign(env, "MINDORY_LLM_LOCAL_HTTP_BASE_URL", answers.llmProviders.localHttpBaseUrl);
  assign(env, "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS", String(answers.llmProviders.localCommandTimeoutMs));
  assign(env, "MINDORY_MCP_ENABLED", bool(answers.interfaces.mcpEnabled));
  assign(env, "MINDORY_HERMES_ADAPTER_ENABLED", bool(answers.interfaces.hermesEnabled));
  assign(env, "MINDORY_MCP_API_TOKEN", answers.tokens.mcpApiToken);
  assign(env, "MINDORY_CLI_API_TOKEN", answers.tokens.cliApiToken);
  assign(env, "MINDORY_HERMES_API_TOKEN", answers.tokens.hermesApiToken);

  for (const role of LLM_ROLE_KEYS) {
    const roleAnswers = answers.llmRoles[role];
    if (roleAnswers === undefined) {
      continue;
    }
    assign(env, `MINDORY_LLM_${role}_ENABLED`, bool(roleAnswers.enabled));
    assign(env, `MINDORY_LLM_${role}_PROVIDER`, roleAnswers.provider);
    assign(env, `MINDORY_LLM_${role}_MODEL`, roleAnswers.model);
    assign(env, `MINDORY_LLM_${role}_REQUIRED`, bool(roleAnswers.required));
    assign(env, `MINDORY_LLM_${role}_TIMEOUT_MS`, String(roleAnswers.timeoutMs));
    assign(env, `MINDORY_LLM_${role}_CONCURRENCY`, String(roleAnswers.concurrency));
    if (roleAnswers.dimensions !== undefined) {
      assign(env, `MINDORY_LLM_${role}_DIMENSIONS`, roleAnswers.dimensions === null ? "" : String(roleAnswers.dimensions));
    }
  }

  return env;
}

export function renderEnvFile(answers: MindoryInstallAnswers): string {
  const env = answersToEnvMap(answers);
  return `${FLAT_CONFIG_CATALOG.map((entry) => `${entry.name}=${env[entry.name] ?? entry.defaultValue}`).join("\n")}\n`;
}

export function renderMindoryConfigJson(answers: MindoryInstallAnswers): string {
  return `${JSON.stringify({
    schema_version: INSTALLER_SCHEMA_VERSION,
    mindory_home: answers.mindoryHome,
    profile: answers.profile,
    public_url: answers.publicUrl,
    storage: answers.storage,
    antivirus: answers.antivirus,
    modalities: answers.modalities,
    llm_roles: answers.llmRoles,
    interfaces: answers.interfaces
  }, null, 2)}\n`;
}

export function redactEnvMap(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const entry of FLAT_CONFIG_CATALOG) {
    const value = env[entry.name] ?? "";
    redacted[entry.name] = isSecretEntry(entry) && value !== "" ? "<redacted>" : value;
  }
  return redacted;
}

export function buildRedactedInstallSummary(answers: MindoryInstallAnswers): Record<string, unknown> {
  const plan = createInstallPlan(answers);
  return {
    mindoryHome: plan.mindoryHome,
    profile: plan.profile,
    composeProfiles: plan.composeProfiles,
    homeDirectories: plan.homeDirectories,
    environment: redactEnvMap(plan.environment),
    steps: plan.steps.map((stepItem) => ({
      id: stepItem.id,
      title: stepItem.title,
      kind: stepItem.kind,
      rollback: stepItem.rollback.kind
    }))
  };
}

export function composeProfilesForAnswers(answers: MindoryInstallAnswers): string[] {
  const profiles = new Set<string>();
  if (answers.storage.provider === "s3" && answers.storage.s3.endpoint.includes("librefs")) {
    profiles.add("librefs");
  }
  if (answers.antivirus.mode !== "disabled" && answers.antivirus.provider === "clamav") {
    profiles.add("clamav");
  }
  for (const roleAnswers of Object.values(answers.llmRoles)) {
    if (roleAnswers?.enabled && roleAnswers.provider === "ollama") {
      profiles.add("ollama");
    }
    if (roleAnswers?.enabled && roleAnswers.provider === "local-http") {
      profiles.add("local-models");
    }
  }
  return Array.from(profiles).sort();
}

function mergeAnswers(defaults: MindoryInstallAnswers, overrides: Partial<MindoryInstallAnswers>): MindoryInstallAnswers {
  return {
    ...defaults,
    ...overrides,
    storage: { ...defaults.storage, ...overrides.storage, s3: { ...defaults.storage.s3, ...overrides.storage?.s3 } },
    antivirus: { ...defaults.antivirus, ...overrides.antivirus },
    modalities: { ...defaults.modalities, ...overrides.modalities },
    llmRoles: { ...defaults.llmRoles, ...overrides.llmRoles },
    llmProviders: { ...defaults.llmProviders, ...overrides.llmProviders },
    interfaces: { ...defaults.interfaces, ...overrides.interfaces },
    tokens: { ...defaults.tokens, ...overrides.tokens }
  };
}

function step(
  id: string,
  title: string,
  kind: InstallStepKind,
  rollbackKind: RollbackStepKind,
  target?: string
): InstallPlanStep {
  const rollback: InstallRollbackStep = {
    kind: rollbackKind,
    description: rollbackKind === "none" ? `No rollback required for ${id}.` : `Rollback ${id}.`
  };
  if (target !== undefined) {
    rollback.target = target;
  }
  return {
    id,
    title,
    kind,
    required: true,
    rollback
  };
}

function catalogDefault(name: string): string {
  const entry = FLAT_CONFIG_CATALOG.find((item) => item.name === name);
  if (entry === undefined) {
    throw new Error(`Missing config catalog entry ${name}.`);
  }
  return entry.defaultValue;
}

function validateCatalogValue(errors: string[], name: string, value: string): void {
  const entry = FLAT_CONFIG_CATALOG.find((item) => item.name === name);
  if (entry === undefined) {
    errors.push(`${name} is not present in config catalog.`);
    return;
  }
  if (entry.allowedValues !== undefined && !entry.allowedValues.includes(value)) {
    errors.push(`${name} must be one of ${entry.allowedValues.join(", ")}.`);
  }
}

function commandCheck(id: string, label: string, result: DependencyProbeResult, required: boolean, manualFix: string): DependencyCheck {
  if (result.status === 0) {
    return { id, label, status: "ok", required };
  }
  const check: DependencyCheck = {
    id,
    label,
    status: result.status === null ? "missing" : "failed",
    required,
    manualFix
  };
  const diagnosis = (result.stderr || result.stdout).trim();
  if (diagnosis !== "") {
    check.diagnosis = diagnosis;
  }
  return check;
}

function nearestExistingParent(targetPath: string): string {
  let current = path.resolve(targetPath);
  while (!existsSync(current)) {
    const next = path.dirname(current);
    if (next === current) {
      return current;
    }
    current = next;
  }
  const stats = statSync(current);
  return stats.isDirectory() ? current : path.dirname(current);
}

function assign(env: Record<string, string>, name: string, value: string): void {
  env[name] = value;
}

function bool(value: boolean): string {
  return value ? "true" : "false";
}

function isSecretEntry(entry: ConfigCatalogEntry): boolean {
  return entry.secret || entry.name.endsWith("_TOKEN") || entry.name.endsWith("_API_KEY") || entry.name.endsWith("_SECRET_ACCESS_KEY");
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
