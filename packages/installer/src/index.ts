import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  cpSync,
  existsSync,
  accessSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { cwd as processCwd, env as processEnv, pid as processPid, stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
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
  backupTarget?: string;
  createdPaths?: string[];
  restoreMode?: "delete" | "restore";
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
export type WizardPromptKind = "text" | "secret" | "boolean" | "number" | "choice";
export type WizardStorageChoice = "local-fs" | "librefs-s3" | "external-s3";

export interface WizardChoice {
  value: string;
  label: string;
  description: string;
  experimental?: boolean;
}

export interface WizardPrompt {
  id: string;
  kind: WizardPromptKind;
  label: string;
  help: string;
  defaultValue: string;
  secret: boolean;
  choices?: WizardChoice[];
  resourceHint?: {
    cpu?: string;
    memory?: string;
    disk?: string;
    gpu?: string;
  };
  supportStatus?: string;
}

export interface WizardIo {
  prompt(prompt: WizardPrompt): Promise<string>;
  confirm(summary: Record<string, unknown>): Promise<boolean>;
}

export interface WizardOptions {
  initialAnswers?: Partial<MindoryInstallAnswers>;
  allowExperimental?: boolean;
}

export interface InstallLockRecord {
  owner: string;
  pid: number;
  createdAt: string;
}

export interface InstallLock {
  path: string;
  record: InstallLockRecord;
  release(): void;
}

export interface InstallerDiagnostic {
  summary: string;
  nextSteps: string[];
  dependencyFailures: DependencyCheck[];
}

export interface InstallExecutionOptions {
  sourceRoot?: string;
  owner?: string;
  stopBeforeStepId?: string | null;
  rollbackOnFailure?: boolean;
  dockerBinary?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  commandRunner?: InstallCommandRunner;
  apiReadyCheck?: (url: string) => Promise<boolean> | boolean;
  firstRunCredentials?: FirstRunCredentials;
  beforeStep?: (step: InstallPlanStep, plan: InstallPlan) => void;
}

export interface FirstRunCredentials {
  projectId: string;
  projectName: string;
  tokenId: string;
  token: string;
  apiUrl: string;
}

export interface InstallCommandOptions {
  cwd: string;
  env: Record<string, string>;
}

export interface InstallCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface InstallCommandRunner {
  run(command: string, args: readonly string[], options: InstallCommandOptions): Promise<InstallCommandResult> | InstallCommandResult;
}

export interface InstallExecutionReport {
  plan: InstallPlan;
  summary: Record<string, unknown>;
  journalPath: string;
  journal: InstallJournalEntry[];
  executedStepIds: string[];
  pendingStepIds: string[];
  rollbackReport?: RollbackReport;
}

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
      step("health-check", "Run install health checks", "healthcheck", "none"),
      step("create-first-token", "Create initial project and API token", "token", "restore_file", path.posix.join(answers.mindoryHome, "config/initial-token.json"))
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

export function installLockPath(mindoryHome: string): string {
  return path.join(mindoryHome, "install", "install.lock");
}

export function installJournalPath(mindoryHome: string): string {
  return path.join(mindoryHome, "install", "install-journal.json");
}

export function acquireInstallLock(mindoryHome: string, owner = "mindory-installer"): InstallLock {
  const lockPath = installLockPath(mindoryHome);
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const record: InstallLockRecord = {
    owner,
    pid: processPid,
    createdAt: new Date().toISOString()
  };
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    const existing = readInstallLock(mindoryHome);
    const detail = existing === null ? "" : ` Existing lock owner=${existing.owner} pid=${existing.pid} createdAt=${existing.createdAt}.`;
    throw new Error(`Another Mindory installer run appears to be active at ${lockPath}.${detail}`);
  }
  return {
    path: lockPath,
    record,
    release() {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    }
  };
}

export function readInstallLock(mindoryHome: string): InstallLockRecord | null {
  const lockPath = installLockPath(mindoryHome);
  if (!existsSync(lockPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(lockPath, "utf8")) as InstallLockRecord;
  } catch {
    return {
      owner: "unknown",
      pid: 0,
      createdAt: "unknown"
    };
  }
}

export function writeInstallJournal(mindoryHome: string, journal: InstallTransactionJournal | readonly InstallJournalEntry[]): string {
  const journalPath = installJournalPath(mindoryHome);
  mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  const entries = journal instanceof InstallTransactionJournal ? journal.toJSON() : journal;
  writeFileSync(journalPath, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  return journalPath;
}

export function readInstallJournal(mindoryHome: string): InstallJournalEntry[] | null {
  const journalPath = installJournalPath(mindoryHome);
  if (!existsSync(journalPath)) {
    return null;
  }
  return JSON.parse(readFileSync(journalPath, "utf8")) as InstallJournalEntry[];
}

export function formatDependencyDiagnostics(checks: readonly DependencyCheck[]): string[] {
  return checks
    .filter((check) => check.required && check.status !== "ok" && check.status !== "skipped")
    .map((check) => {
      const details = check.diagnosis === undefined ? "" : ` ${check.diagnosis}`;
      const fix = check.manualFix === undefined ? "" : ` Fix: ${check.manualFix}`;
      return `${check.label}: ${check.status}.${details}${fix}`;
    });
}

export function formatInstallerDiagnostic(error: unknown, dependencyChecks: readonly DependencyCheck[] = []): InstallerDiagnostic {
  const dependencyFailures = dependencyChecks.filter((check) => check.required && check.status !== "ok" && check.status !== "skipped");
  const nextSteps = formatDependencyDiagnostics(dependencyChecks);
  if (nextSteps.length === 0) {
    nextSteps.push("Review the installer log, fix the reported issue and rerun the installer.");
  }
  nextSteps.push("Run the repair command to inspect lock and journal state before retrying.");
  return {
    summary: errorToString(error),
    nextSteps,
    dependencyFailures
  };
}

export async function executeInstallPlan(
  answers: MindoryInstallAnswers,
  options: InstallExecutionOptions = {}
): Promise<InstallExecutionReport> {
  const plan = createInstallPlan(answers);
  const lock = acquireInstallLock(plan.mindoryHome, options.owner ?? "mindory-installer-executor");
  const journal = new InstallTransactionJournal();
  const executedStepIds: string[] = [];
  const stopBeforeStepId = options.stopBeforeStepId === undefined ? "pull-images" : options.stopBeforeStepId;
  let rollbackReport: RollbackReport | undefined;

  try {
    for (const stepItem of plan.steps) {
      if (stopBeforeStepId !== null && stepItem.id === stopBeforeStepId) {
        break;
      }
      journal.recordPlanned(stepItem);
      writeInstallJournal(plan.mindoryHome, journal);
      try {
        options.beforeStep?.(stepItem, plan);
        await executeSupportedInstallStep(stepItem, answers, plan, options);
        journal.markCompleted(stepItem);
        executedStepIds.push(stepItem.id);
        writeInstallJournal(plan.mindoryHome, journal);
      } catch (error) {
        journal.markFailed(stepItem, error);
        writeInstallJournal(plan.mindoryHome, journal);
        if (options.rollbackOnFailure ?? answers.rollbackOnFailure) {
          rollbackReport = await rollbackCompletedActions(plan, journal, (rollback, completedStep) =>
            defaultRollbackExecutor(rollback, completedStep, plan, options)
          );
          writeInstallJournal(plan.mindoryHome, journal);
        }
        throw error;
      }
    }

    return {
      plan,
      summary: buildRedactedInstallSummary(answers),
      journalPath: installJournalPath(plan.mindoryHome),
      journal: journal.toJSON(),
      executedStepIds,
      pendingStepIds: pendingStepIds(plan, executedStepIds),
      ...(rollbackReport === undefined ? {} : { rollbackReport })
    };
  } finally {
    lock.release();
  }
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

export function buildWizardPromptPlan(options: WizardOptions = {}): WizardPrompt[] {
  const answers = createDefaultInstallAnswers(options.initialAnswers);
  const prompts: WizardPrompt[] = [
    promptFromCatalog("install.profile", "MINDORY_INSTALL_PROFILE", "choice"),
    promptFromCatalog("install.home", "MINDORY_HOME", "text"),
    promptFromCatalog("install.public_url", "MINDORY_PUBLIC_URL", "text"),
    promptFromCatalog("install.allow_experimental", "MINDORY_INSTALL_ALLOW_EXPERIMENTAL", "boolean"),
    promptFromCatalog("install.dependency_policy", "MINDORY_INSTALL_DEPENDENCY_POLICY", "choice"),
    promptFromCatalog("av.mode", "MINDORY_AV_MODE", "choice"),
    promptFromCatalog("storage.choice", "MINDORY_STORAGE_PROVIDER", "choice", {
      defaultValue: storageChoiceFromAnswers(answers),
      choices: [
        { value: "local-fs", label: "Local filesystem", description: "Store RAW originals under MINDORY_HOME/data/objects." },
        { value: "librefs-s3", label: "LibreFS local S3", description: "Run the local LibreFS S3-compatible profile." },
        { value: "external-s3", label: "External S3-compatible", description: "Use an existing S3-compatible endpoint." }
      ]
    }),
    promptFromCatalog("storage.s3.endpoint", "MINDORY_S3_ENDPOINT", "text"),
    promptFromCatalog("storage.s3.bucket", "MINDORY_S3_BUCKET", "text"),
    promptFromCatalog("storage.s3.access_key_id", "MINDORY_S3_ACCESS_KEY_ID", "secret"),
    promptFromCatalog("storage.s3.secret_access_key", "MINDORY_S3_SECRET_ACCESS_KEY", "secret"),
    promptFromCatalog("modalities.text", "MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED", "boolean"),
    promptFromCatalog("modalities.pdf", "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED", "boolean"),
    promptFromCatalog("modalities.image", "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED", "boolean"),
    promptFromCatalog("modalities.audio", "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED", "boolean"),
    promptFromCatalog("modalities.video", "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED", "boolean"),
    promptFromCatalog("modalities.video_max_keyframes", "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", "number"),
    promptFromCatalog("interfaces.api_port", "MINDORY_API_PORT", "number"),
    promptFromCatalog("interfaces.mcp_enabled", "MINDORY_MCP_ENABLED", "boolean"),
    promptFromCatalog("interfaces.hermes_enabled", "MINDORY_HERMES_ADAPTER_ENABLED", "boolean"),
    promptFromCatalog("tokens.mcp_api_token", "MINDORY_MCP_API_TOKEN", "secret"),
    promptFromCatalog("tokens.cli_api_token", "MINDORY_CLI_API_TOKEN", "secret"),
    promptFromCatalog("tokens.hermes_api_token", "MINDORY_HERMES_API_TOKEN", "secret")
  ];

  for (const role of LLM_ROLE_KEYS) {
    const enabledEntry = catalogEntry(`MINDORY_LLM_${role}_ENABLED`);
    prompts.push(promptFromEntry(`llm.${role}.enabled`, enabledEntry, "boolean"));
    prompts.push(promptFromCatalog(`llm.${role}.provider`, `MINDORY_LLM_${role}_PROVIDER`, "choice"));
    prompts.push(promptFromCatalog(`llm.${role}.model`, `MINDORY_LLM_${role}_MODEL`, "text"));
    prompts.push(promptFromCatalog(`llm.${role}.required`, `MINDORY_LLM_${role}_REQUIRED`, "boolean"));
    prompts.push(promptFromCatalog(`llm.${role}.timeout_ms`, `MINDORY_LLM_${role}_TIMEOUT_MS`, "number"));
    prompts.push(promptFromCatalog(`llm.${role}.concurrency`, `MINDORY_LLM_${role}_CONCURRENCY`, "number"));
    const dimensionsEntry = maybeCatalogEntry(`MINDORY_LLM_${role}_DIMENSIONS`);
    if (dimensionsEntry !== undefined) {
      prompts.push(promptFromEntry(`llm.${role}.dimensions`, dimensionsEntry, "number"));
    }
  }

  return prompts.map((promptItem) => {
    if (promptItem.defaultValue !== "") {
      return promptItem;
    }
    const env = answersToEnvMap(answers);
    const catalogName = promptIdToEnvName(promptItem.id);
    const defaultValue = catalogName === undefined ? promptItem.defaultValue : env[catalogName] ?? promptItem.defaultValue;
    return { ...promptItem, defaultValue };
  });
}

export async function runInstallWizard(io: WizardIo, options: WizardOptions = {}): Promise<MindoryInstallAnswers> {
  const answers = createDefaultInstallAnswers(options.initialAnswers);
  answers.profile = await askChoice(io, promptFromCatalog("install.profile", "MINDORY_INSTALL_PROFILE", "choice")) as InstallProfile;
  answers.mindoryHome = await askString(io, promptFromCatalog("install.home", "MINDORY_HOME", "text"));
  answers.publicUrl = await askString(io, promptFromCatalog("install.public_url", "MINDORY_PUBLIC_URL", "text"));
  answers.allowExperimental = await askBoolean(io, promptFromCatalog("install.allow_experimental", "MINDORY_INSTALL_ALLOW_EXPERIMENTAL", "boolean"));
  answers.dependencyPolicy = await askChoice(io, promptFromCatalog("install.dependency_policy", "MINDORY_INSTALL_DEPENDENCY_POLICY", "choice")) as InstallDependencyPolicy;

  answers.antivirus.mode = await askChoice(io, promptFromCatalog("av.mode", "MINDORY_AV_MODE", "choice")) as AntivirusMode;
  const storageChoice = await askChoice(io, promptFromCatalog("storage.choice", "MINDORY_STORAGE_PROVIDER", "choice", {
    defaultValue: storageChoiceFromAnswers(answers),
    choices: [
      { value: "local-fs", label: "Local filesystem", description: "Store RAW originals under MINDORY_HOME/data/objects." },
      { value: "librefs-s3", label: "LibreFS local S3", description: "Run the local LibreFS S3-compatible profile." },
      { value: "external-s3", label: "External S3-compatible", description: "Use an existing S3-compatible endpoint." }
    ]
  })) as WizardStorageChoice;
  applyStorageChoice(answers, storageChoice);
  if (storageChoice !== "local-fs") {
    answers.storage.s3.endpoint = await askString(io, promptFromCatalog("storage.s3.endpoint", "MINDORY_S3_ENDPOINT", "text", { defaultValue: answers.storage.s3.endpoint }));
    answers.storage.s3.bucket = await askString(io, promptFromCatalog("storage.s3.bucket", "MINDORY_S3_BUCKET", "text", { defaultValue: answers.storage.s3.bucket }));
    answers.storage.s3.accessKeyId = await askString(io, promptFromCatalog("storage.s3.access_key_id", "MINDORY_S3_ACCESS_KEY_ID", "secret", { defaultValue: answers.storage.s3.accessKeyId }));
    answers.storage.s3.secretAccessKey = await askString(io, promptFromCatalog("storage.s3.secret_access_key", "MINDORY_S3_SECRET_ACCESS_KEY", "secret", { defaultValue: answers.storage.s3.secretAccessKey }));
  }

  answers.modalities.text = await askBoolean(io, promptFromCatalog("modalities.text", "MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED", "boolean"));
  answers.modalities.pdf = await askBoolean(io, promptFromCatalog("modalities.pdf", "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED", "boolean"));
  answers.modalities.image = await askBoolean(io, promptFromCatalog("modalities.image", "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED", "boolean"));
  answers.modalities.audio = await askBoolean(io, promptFromCatalog("modalities.audio", "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED", "boolean"));
  answers.modalities.video = await askBoolean(io, promptFromCatalog("modalities.video", "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED", "boolean"));
  answers.modalities.videoMaxKeyframes = await askNumber(io, promptFromCatalog("modalities.video_max_keyframes", "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", "number"));

  for (const role of LLM_ROLE_KEYS) {
    const roleAllowed = roleSupportStatus(role) === "supported" || answers.allowExperimental || options.allowExperimental === true;
    const enabled = await askBoolean(io, promptFromCatalog(`llm.${role}.enabled`, `MINDORY_LLM_${role}_ENABLED`, "boolean"));
    if (enabled && !roleAllowed) {
      throw new Error(`MINDORY_LLM_${role} is ${roleSupportStatus(role)} and requires experimental mode.`);
    }
    if (!enabled) {
      answers.llmRoles[role] = {
        enabled: false,
        provider: catalogDefault(`MINDORY_LLM_${role}_PROVIDER`) as LlmProvider,
        model: catalogDefault(`MINDORY_LLM_${role}_MODEL`),
        required: false,
        timeoutMs: Number.parseInt(catalogDefault(`MINDORY_LLM_${role}_TIMEOUT_MS`), 10),
        concurrency: Number.parseInt(catalogDefault(`MINDORY_LLM_${role}_CONCURRENCY`), 10)
      };
      continue;
    }
    const roleAnswers: LlmRoleAnswers = {
      enabled: true,
      provider: await askChoice(io, promptFromCatalog(`llm.${role}.provider`, `MINDORY_LLM_${role}_PROVIDER`, "choice")) as LlmProvider,
      model: await askString(io, promptFromCatalog(`llm.${role}.model`, `MINDORY_LLM_${role}_MODEL`, "text")),
      required: await askBoolean(io, promptFromCatalog(`llm.${role}.required`, `MINDORY_LLM_${role}_REQUIRED`, "boolean")),
      timeoutMs: await askNumber(io, promptFromCatalog(`llm.${role}.timeout_ms`, `MINDORY_LLM_${role}_TIMEOUT_MS`, "number")),
      concurrency: await askNumber(io, promptFromCatalog(`llm.${role}.concurrency`, `MINDORY_LLM_${role}_CONCURRENCY`, "number"))
    };
    const dimensionsEntry = maybeCatalogEntry(`MINDORY_LLM_${role}_DIMENSIONS`);
    if (dimensionsEntry !== undefined) {
      const dimensions = await askString(io, promptFromEntry(`llm.${role}.dimensions`, dimensionsEntry, "number"));
      roleAnswers.dimensions = dimensions.trim() === "" ? null : Number.parseInt(dimensions, 10);
    }
    answers.llmRoles[role] = roleAnswers;
  }

  answers.interfaces.apiPort = await askNumber(io, promptFromCatalog("interfaces.api_port", "MINDORY_API_PORT", "number"));
  answers.interfaces.mcpEnabled = await askBoolean(io, promptFromCatalog("interfaces.mcp_enabled", "MINDORY_MCP_ENABLED", "boolean"));
  answers.interfaces.hermesEnabled = await askBoolean(io, promptFromCatalog("interfaces.hermes_enabled", "MINDORY_HERMES_ADAPTER_ENABLED", "boolean"));
  answers.tokens.mcpApiToken = await askString(io, promptFromCatalog("tokens.mcp_api_token", "MINDORY_MCP_API_TOKEN", "secret"));
  answers.tokens.cliApiToken = await askString(io, promptFromCatalog("tokens.cli_api_token", "MINDORY_CLI_API_TOKEN", "secret"));
  answers.tokens.hermesApiToken = await askString(io, promptFromCatalog("tokens.hermes_api_token", "MINDORY_HERMES_API_TOKEN", "secret"));

  const errors = validateInstallAnswers(answers);
  if (errors.length > 0) {
    throw new Error(`Wizard produced invalid answers: ${errors.join(" ")}`);
  }
  const summary = buildRedactedInstallSummary(answers);
  if (!(await io.confirm(summary))) {
    throw new Error("Install wizard cancelled before execution.");
  }
  return answers;
}

export function createReadlineWizardIo(): WizardIo & { close(): void } {
  const rl: ReadlineInterface = createInterface({ input: defaultInput, output: defaultOutput });
  return {
    async prompt(promptItem) {
      return rl.question(formatWizardQuestion(promptItem));
    },
    async confirm(summary) {
      defaultOutput.write("\nInstall summary:\n");
      defaultOutput.write(`${JSON.stringify(summary, null, 2)}\n`);
      const answer = await rl.question("Continue with this installation? [y/N] ");
      return /^y(?:es)?$/i.test(answer.trim());
    },
    close() {
      rl.close();
    }
  };
}

function promptFromCatalog(id: string, envName: string, kind: WizardPromptKind, overrides: Partial<WizardPrompt> = {}): WizardPrompt {
  return promptFromEntry(id, catalogEntry(envName), kind, overrides);
}

function promptFromEntry(id: string, entry: ConfigCatalogEntry, kind: WizardPromptKind, overrides: Partial<WizardPrompt> = {}): WizardPrompt {
  const promptMetadata = entry.prompt;
  const promptItem: WizardPrompt = {
    id,
    kind,
    label: overrides.label ?? promptMetadata?.label ?? entry.description,
    help: overrides.help ?? promptMetadata?.help ?? entry.description,
    defaultValue: overrides.defaultValue ?? entry.defaultValue,
    secret: overrides.secret ?? entry.secret,
    supportStatus: overrides.supportStatus ?? entry.supportStatus
  };
  const choices = overrides.choices ?? choicesFromEntry(entry);
  if (choices !== undefined) {
    promptItem.choices = choices;
  }
  const resourceHint = overrides.resourceHint ?? entry.resourceHint;
  if (resourceHint !== undefined) {
    promptItem.resourceHint = resourceHint;
  }
  return promptItem;
}

function choicesFromEntry(entry: ConfigCatalogEntry): WizardChoice[] | undefined {
  if (entry.allowedValues === undefined) {
    return undefined;
  }
  return entry.allowedValues.map((value) => ({
    value,
    label: value,
    description: `${entry.description} ${value}.`,
    experimental: entry.supportStatus !== "supported"
  }));
}

async function askString(io: WizardIo, promptItem: WizardPrompt): Promise<string> {
  const answer = await io.prompt(promptItem);
  return answer.trim() === "" ? promptItem.defaultValue : answer.trim();
}

async function askNumber(io: WizardIo, promptItem: WizardPrompt): Promise<number> {
  const value = await askString(io, promptItem);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${promptItem.id} must be a number.`);
  }
  return parsed;
}

async function askBoolean(io: WizardIo, promptItem: WizardPrompt): Promise<boolean> {
  const value = (await askString(io, promptItem)).toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(value)) {
    return true;
  }
  if (["false", "no", "n", "0", "off"].includes(value)) {
    return false;
  }
  throw new Error(`${promptItem.id} must be yes or no.`);
}

async function askChoice(io: WizardIo, promptItem: WizardPrompt): Promise<string> {
  const value = await askString(io, promptItem);
  const choices = promptItem.choices?.map((choice) => choice.value);
  if (choices !== undefined && !choices.includes(value)) {
    throw new Error(`${promptItem.id} must be one of ${choices.join(", ")}.`);
  }
  return value;
}

function applyStorageChoice(answers: MindoryInstallAnswers, choice: WizardStorageChoice): void {
  if (choice === "local-fs") {
    answers.storage.provider = "local-fs";
    return;
  }
  answers.storage.provider = "s3";
  if (choice === "librefs-s3") {
    answers.storage.s3.endpoint = "http://librefs:9000";
  }
}

function storageChoiceFromAnswers(answers: MindoryInstallAnswers): WizardStorageChoice {
  if (answers.storage.provider === "local-fs") {
    return "local-fs";
  }
  return answers.storage.s3.endpoint.includes("librefs") ? "librefs-s3" : "external-s3";
}

function formatWizardQuestion(promptItem: WizardPrompt): string {
  const choices = promptItem.choices === undefined ? "" : ` (${promptItem.choices.map((choice) => choice.value).join("/")})`;
  const resource = promptItem.resourceHint === undefined ? "" : ` [resources: ${Object.entries(promptItem.resourceHint).map(([key, value]) => `${key} ${value}`).join(", ")}]`;
  const secret = promptItem.secret ? " [secret]" : "";
  return `${promptItem.label}${choices}${secret}${resource}\n${promptItem.help}\nDefault: ${promptItem.defaultValue}\n> `;
}

async function executeSupportedInstallStep(
  stepItem: InstallPlanStep,
  answers: MindoryInstallAnswers,
  plan: InstallPlan,
  options: InstallExecutionOptions
): Promise<void> {
  if (stepItem.id === "ensure-home") {
    ensureMindoryHomeTree(plan, stepItem);
    return;
  }
  if (stepItem.id === "write-config") {
    writeGeneratedFile(path.join(plan.mindoryHome, "config", "mindory.config.json"), renderMindoryConfigJson(answers), 0o600, stepItem, plan.mindoryHome);
    return;
  }
  if (stepItem.id === "write-env") {
    writeGeneratedFile(path.join(plan.mindoryHome, "config", ".env"), renderEnvFile(answers), 0o600, stepItem, plan.mindoryHome);
    return;
  }
  if (stepItem.id === "write-compose-assets") {
    writeComposeAssets(options.sourceRoot ?? processCwd(), plan, stepItem);
    return;
  }
  if (stepItem.id === "pull-images") {
    await pullOrBuildImages(plan, options);
    return;
  }
  if (stepItem.id === "start-infra") {
    await startComposeInfrastructure(plan, options);
    return;
  }
  if (stepItem.id === "run-migrations") {
    await runComposeMigrations(plan, options);
    return;
  }
  if (stepItem.id === "start-runtime") {
    await startComposeRuntime(plan, options);
    return;
  }
  if (stepItem.id === "health-check") {
    await runInstallHealthChecks(plan, options);
    return;
  }
  if (stepItem.id === "create-first-token") {
    await provisionFirstRunToken(plan, stepItem, options);
    return;
  }
  throw new Error(`Install step ${stepItem.id} is not implemented by the prepare execution engine.`);
}

function ensureMindoryHomeTree(plan: InstallPlan, stepItem: InstallPlanStep): void {
  const createdPaths: string[] = [];
  ensureDirectory(plan.mindoryHome, createdPaths);
  for (const directory of plan.homeDirectories) {
    ensureDirectory(path.join(plan.mindoryHome, directory), createdPaths);
  }
  stepItem.rollback.createdPaths = createdPaths;
  stepItem.rollback.restoreMode = "delete";
}

function writeGeneratedFile(targetPath: string, contents: string, mode: number, stepItem: InstallPlanStep, mindoryHome: string): void {
  mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  prepareTargetRollback(targetPath, stepItem, mindoryHome);
  writeFileSync(targetPath, contents, { mode });
}

function writeComposeAssets(sourceRoot: string, plan: InstallPlan, stepItem: InstallPlanStep): void {
  const targetDirectory = path.join(plan.mindoryHome, "install", "compose");
  prepareTargetRollback(targetDirectory, stepItem, plan.mindoryHome);
  rmSync(targetDirectory, { recursive: true, force: true });
  mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });

  const manifestPath = path.join(sourceRoot, "deploy", "compose", "release-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Release manifest not found at ${manifestPath}.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    assets?: Array<{ path: string; required?: boolean }>;
  };
  writeFileSync(path.join(targetDirectory, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  for (const asset of manifest.assets ?? []) {
    const sourcePath = path.join(sourceRoot, asset.path);
    if (!existsSync(sourcePath)) {
      if (asset.required === false) {
        continue;
      }
      throw new Error(`Required release asset not found at ${sourcePath}.`);
    }
    const targetPath = path.join(targetDirectory, asset.path);
    mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

async function pullOrBuildImages(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  await runDockerCompose(plan, ["pull", "--ignore-buildable"], options);
  await runDockerCompose(plan, ["build"], options);
}

async function startComposeInfrastructure(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  await runDockerCompose(plan, ["up", "-d", ...infrastructureServices(plan)], options);
}

async function runComposeMigrations(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  await runDockerCompose(plan, ["up", "migrate"], options);
}

async function startComposeRuntime(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  await runDockerCompose(plan, ["up", "-d", "api", "worker", "mcp"], options);
}

async function runInstallHealthChecks(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  await waitForComposeServices(plan, options);
  await waitForApiReady(plan, options);
}

async function provisionFirstRunToken(plan: InstallPlan, stepItem: InstallPlanStep, options: InstallExecutionOptions): Promise<void> {
  const credentials = options.firstRunCredentials ?? generateFirstRunCredentials(plan);
  const targetPath = path.join(plan.mindoryHome, "config", "initial-token.json");
  try {
    writeGeneratedFile(targetPath, renderInitialTokenFile(credentials), 0o600, stepItem, plan.mindoryHome);
    await runDockerCompose(plan, [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      `MINDORY_INITIAL_PROJECT_ID=${credentials.projectId}`,
      "-e",
      `MINDORY_INITIAL_PROJECT_NAME=${credentials.projectName}`,
      "-e",
      `MINDORY_INITIAL_TOKEN_ID=${credentials.tokenId}`,
      "-e",
      `MINDORY_INITIAL_TOKEN=${credentials.token}`,
      "-e",
      `MINDORY_PUBLIC_URL=${credentials.apiUrl}`,
      "api",
      "node",
      "scripts/provision-first-token.js"
    ], options);
  } catch (error) {
    await defaultRollbackExecutor(stepItem.rollback, stepItem, plan, options);
    throw error;
  }
}

async function waitForComposeServices(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 240_000);
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const required = ["postgres", "redis", "api", "worker", "mcp"];
  const completed = ["migrate"];
  let lastStatus = "";

  while (Date.now() < deadline) {
    const records = parseComposeJson((await runDockerCompose(plan, ["ps", "--all", "--format", "json"], options, { captureOutput: true })).stdout);
    const missing = required.filter((service) => findComposeService(records, service) === undefined);
    const notReady = required.filter((service) => {
      const record = findComposeService(records, service);
      return record !== undefined && !isComposeRunningAndHealthy(record);
    });
    const notCompleted = completed.filter((service) => {
      const record = findComposeService(records, service);
      return record === undefined || !isComposeCompletedSuccessfully(record);
    });
    const failed = records.find((record) => isComposeFailed(record));
    if (failed !== undefined) {
      throw new Error(`Docker Compose service ${composeServiceName(failed)} failed during installer healthcheck.`);
    }
    if (missing.length === 0 && notReady.length === 0 && notCompleted.length === 0) {
      return;
    }
    lastStatus = JSON.stringify({ missing, notReady, notCompleted });
    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for Docker Compose services: ${lastStatus}`);
}

async function waitForApiReady(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 240_000);
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const apiUrl = `${plan.environment.MINDORY_PUBLIC_URL ?? "http://localhost:3000"}`.replace(/\/$/, "");
  let lastError = "API did not respond yet.";

  while (Date.now() < deadline) {
    try {
      const ok = options.apiReadyCheck === undefined ? await defaultApiReadyCheck(`${apiUrl}/ready`) : await options.apiReadyCheck(`${apiUrl}/ready`);
      if (ok) {
        return;
      }
      lastError = `GET ${apiUrl}/ready was not ready.`;
    } catch (error) {
      lastError = errorToString(error);
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for API readiness at ${apiUrl}/ready: ${lastError}`);
}

async function runDockerCompose(
  plan: InstallPlan,
  composeArgs: readonly string[],
  options: InstallExecutionOptions,
  runOptions: { captureOutput?: boolean } = {}
): Promise<InstallCommandResult> {
  const runner = options.commandRunner ?? createNodeCommandRunner();
  const result = await runner.run(options.dockerBinary ?? "docker", [...composeBaseArgs(plan, options), ...composeArgs], {
    cwd: composeWorkingDirectory(plan, options),
    env: composeEnvironment(plan)
  });
  if ((result.status ?? 1) !== 0) {
    const details = `${result.stderr || result.stdout}`.trim();
    throw new Error(`docker compose ${composeArgs.join(" ")} failed with exit code ${result.status ?? 1}${details === "" ? "" : `: ${details}`}`);
  }
  if (runOptions.captureOutput === true) {
    return result;
  }
  return result;
}

function createNodeCommandRunner(): InstallCommandRunner {
  return {
    run(command, args, options) {
      const result = spawnSync(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8"
      });
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? ""
      };
    }
  };
}

function composeBaseArgs(plan: InstallPlan, options: InstallExecutionOptions): string[] {
  const composeRoot = composeWorkingDirectory(plan, options);
  const args = [
    "compose",
    "--env-file",
    path.join(plan.mindoryHome, "config", ".env"),
    "-f",
    path.join(composeRoot, "docker-compose.yml")
  ];
  const overridePath = path.join(composeRoot, "docker-compose.override.yml");
  if (existsSync(overridePath)) {
    args.push("-f", overridePath);
  }
  for (const profile of plan.composeProfiles) {
    args.push("--profile", profile);
  }
  return args;
}

function composeWorkingDirectory(plan: InstallPlan, options: InstallExecutionOptions): string {
  return options.sourceRoot ?? path.join(plan.mindoryHome, "install", "compose");
}

function composeEnvironment(plan: InstallPlan): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return {
    ...env,
    ...plan.environment,
    MINDORY_HOME: plan.mindoryHome
  };
}

function infrastructureServices(plan: InstallPlan): string[] {
  const services = ["postgres", "redis"];
  const profileServices: Record<string, string> = {
    clamav: "clamav",
    librefs: "librefs",
    minio: "minio",
    qdrant: "qdrant",
    docling: "docling",
    ollama: "ollama",
    "local-models": "llm"
  };
  for (const profile of plan.composeProfiles) {
    const service = profileServices[profile];
    if (service !== undefined) {
      services.push(service);
    }
  }
  return [...new Set(services)];
}

function generateFirstRunCredentials(plan: InstallPlan): FirstRunCredentials {
  const suffix = randomHex(8);
  return {
    projectId: "default",
    projectName: "Mindory Default",
    tokenId: `tok_install_${suffix}`,
    token: `mindory_${randomHex(32)}`,
    apiUrl: `${plan.environment.MINDORY_PUBLIC_URL ?? "http://localhost:3000"}`.replace(/\/$/, "")
  };
}

function renderInitialTokenFile(credentials: FirstRunCredentials): string {
  return `${JSON.stringify({
    project_id: credentials.projectId,
    project_name: credentials.projectName,
    token_id: credentials.tokenId,
    token: credentials.token,
    api_url: credentials.apiUrl,
    created_at: new Date().toISOString(),
    usage: {
      authorization_header: `Bearer ${credentials.token}`
    }
  }, null, 2)}\n`;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function parseComposeJson(output: string): Array<Record<string, unknown>> {
  const trimmed = output.trim();
  if (trimmed === "") {
    return [];
  }
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as Array<Record<string, unknown>>;
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function findComposeService(records: readonly Record<string, unknown>[], service: string): Record<string, unknown> | undefined {
  return records.find((record) => composeServiceName(record) === service);
}

function composeServiceName(record: Record<string, unknown>): string {
  if (typeof record.Service === "string" && record.Service !== "") {
    return record.Service;
  }
  if (typeof record.Name === "string") {
    const match = record.Name.match(/^mindory-([^-]+)-\d+$/);
    return match?.[1] ?? record.Name;
  }
  return "unknown";
}

function isComposeRunningAndHealthy(record: Record<string, unknown>): boolean {
  const state = composeStatusText(record);
  const health = String(record.Health ?? "").toLowerCase();
  if (!state.includes("running")) {
    return false;
  }
  return health === "" || health === "healthy" || state.includes("healthy");
}

function isComposeCompletedSuccessfully(record: Record<string, unknown>): boolean {
  const state = composeStatusText(record);
  const exitCode = String(record.ExitCode ?? "");
  if (exitCode !== "") {
    return (state.includes("exited") || state.includes("completed")) && exitCode === "0";
  }
  return state.includes("completed") || state.includes("exited (0)") || state.includes("exited(0)");
}

function isComposeFailed(record: Record<string, unknown>): boolean {
  const state = composeStatusText(record);
  const exitCode = String(record.ExitCode ?? "");
  if (state.includes("unhealthy")) {
    return true;
  }
  if ((state.includes("exited") || state.includes("dead")) && exitCode !== "" && exitCode !== "0") {
    return true;
  }
  return /exited\s*\(([1-9]\d*)\)/.test(state);
}

function composeStatusText(record: Record<string, unknown>): string {
  return `${record.State ?? ""} ${record.Status ?? ""} ${record.Health ?? ""}`.toLowerCase();
}

async function defaultApiReadyCheck(url: string): Promise<boolean> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  return response.ok;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prepareTargetRollback(targetPath: string, stepItem: InstallPlanStep, mindoryHome: string): void {
  stepItem.rollback.target = targetPath;
  if (!existsSync(targetPath)) {
    stepItem.rollback.restoreMode = "delete";
    return;
  }
  const backupTarget = rollbackBackupPath(mindoryHome, stepItem.id, path.basename(targetPath));
  mkdirSync(path.dirname(backupTarget), { recursive: true, mode: 0o700 });
  cpSync(targetPath, backupTarget, { recursive: true });
  stepItem.rollback.backupTarget = backupTarget;
  stepItem.rollback.restoreMode = "restore";
}

async function defaultRollbackExecutor(
  rollback: InstallRollbackStep,
  _stepItem: InstallPlanStep,
  plan: InstallPlan,
  options: InstallExecutionOptions
): Promise<void> {
  if (rollback.kind === "delete_path") {
    const createdPaths = rollback.createdPaths ?? (rollback.target === undefined ? [] : [rollback.target]);
    for (const createdPath of [...createdPaths].sort((a, b) => b.length - a.length)) {
      rmSync(createdPath, { recursive: true, force: true });
    }
    return;
  }
  if (rollback.kind === "restore_file") {
    if (rollback.target === undefined) {
      return;
    }
    if (rollback.restoreMode === "restore" && rollback.backupTarget !== undefined && existsSync(rollback.backupTarget)) {
      rmSync(rollback.target, { recursive: true, force: true });
      mkdirSync(path.dirname(rollback.target), { recursive: true, mode: 0o700 });
      cpSync(rollback.backupTarget, rollback.target, { recursive: true });
      return;
    }
    rmSync(rollback.target, { recursive: true, force: true });
    return;
  }
  if (rollback.kind === "compose_down") {
    await runDockerCompose(plan, ["down", "--remove-orphans"], options);
    return;
  }
  throw new Error(`Rollback kind ${rollback.kind} is not implemented by the prepare execution engine.`);
}

function pendingStepIds(plan: InstallPlan, executedStepIds: readonly string[]): string[] {
  const executed = new Set(executedStepIds);
  return plan.steps.filter((stepItem) => !executed.has(stepItem.id)).map((stepItem) => stepItem.id);
}

function ensureDirectory(targetPath: string, createdPaths: string[]): void {
  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true, mode: 0o700 });
    createdPaths.push(targetPath);
  }
}

function rollbackBackupPath(mindoryHome: string, stepId: string, basename: string): string {
  return path.join(mindoryHome, "install", "rollback", stepId, basename);
}

function promptIdToEnvName(promptId: string): string | undefined {
  const direct: Record<string, string> = {
    "install.profile": "MINDORY_INSTALL_PROFILE",
    "install.home": "MINDORY_HOME",
    "install.public_url": "MINDORY_PUBLIC_URL",
    "install.allow_experimental": "MINDORY_INSTALL_ALLOW_EXPERIMENTAL",
    "install.dependency_policy": "MINDORY_INSTALL_DEPENDENCY_POLICY",
    "av.mode": "MINDORY_AV_MODE",
    "storage.s3.endpoint": "MINDORY_S3_ENDPOINT",
    "storage.s3.bucket": "MINDORY_S3_BUCKET",
    "storage.s3.access_key_id": "MINDORY_S3_ACCESS_KEY_ID",
    "storage.s3.secret_access_key": "MINDORY_S3_SECRET_ACCESS_KEY",
    "modalities.text": "MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED",
    "modalities.pdf": "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED",
    "modalities.image": "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED",
    "modalities.audio": "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED",
    "modalities.video": "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED",
    "modalities.video_max_keyframes": "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES",
    "interfaces.api_port": "MINDORY_API_PORT",
    "interfaces.mcp_enabled": "MINDORY_MCP_ENABLED",
    "interfaces.hermes_enabled": "MINDORY_HERMES_ADAPTER_ENABLED",
    "tokens.mcp_api_token": "MINDORY_MCP_API_TOKEN",
    "tokens.cli_api_token": "MINDORY_CLI_API_TOKEN",
    "tokens.hermes_api_token": "MINDORY_HERMES_API_TOKEN"
  };
  if (direct[promptId] !== undefined) {
    return direct[promptId];
  }
  const match = promptId.match(/^llm\.([A-Z_]+)\.(enabled|provider|model|required|timeout_ms|concurrency|dimensions)$/);
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  return `MINDORY_LLM_${match[1]}_${match[2].toUpperCase()}`;
}

function roleSupportStatus(role: InstallerLlmRoleKey): string {
  return catalogEntry(`MINDORY_LLM_${role}_ENABLED`).supportStatus;
}

function catalogEntry(name: string): ConfigCatalogEntry {
  const entry = maybeCatalogEntry(name);
  if (entry === undefined) {
    throw new Error(`Missing config catalog entry ${name}.`);
  }
  return entry;
}

function maybeCatalogEntry(name: string): ConfigCatalogEntry | undefined {
  return FLAT_CONFIG_CATALOG.find((item) => item.name === name);
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
