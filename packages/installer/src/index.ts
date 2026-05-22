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
  readdirSync,
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
  loadMindoryConfig,
  llmRoleProviderSupportStatus,
  llmRoleSupportStatus,
  type AntivirusMode,
  type ConfigSupportStatus,
  type ConfigCatalogEntry,
  type InstallDependencyPolicy,
  type InstallProfile,
  type LlmOpenAiAuthMode,
  type LlmProvider,
  type StorageProvider,
  type VideoKeyframeProvider,
  type VectorProvider
} from "@mindory/config";
import {
  checkMindoryLlmProviderHealth,
  type LlmAuditSink,
  type LlmLocalCommandRunner,
  type LlmProviderHealth
} from "@mindory/llm";
import { S3ObjectStorage } from "@mindory/storage-s3";

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
  videoKeyframeProvider: VideoKeyframeProvider;
  videoFfmpegCommand: string;
  videoFfprobeCommand: string;
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
  localCommandHealthcheckCommand: string;
  localCommandHealthcheckArgs: string[];
  localCommandOperationCommand: string;
  localCommandOperationArgs: string[];
  localCommandMaxInputBytes: number;
  localCommandMaxOutputBytes: number;
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

export interface VectorAnswers {
  provider: VectorProvider;
  qdrantUrl: string;
  qdrantCollectionPrefix: string;
}

export interface DoclingAnswers {
  enabled: boolean;
  url: string;
  timeoutMs: number;
  port: number;
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
  vector: VectorAnswers;
  docling: DoclingAnswers;
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

export type ClamAvInstallerHealthFailureKind =
  | "daemon_unavailable"
  | "timeout"
  | "protocol_failure"
  | "unexpected_infected_result"
  | "infected_probe_not_detected"
  | "command_failed";

export interface ClamAvInstallerHealthReport {
  status: "skipped" | "healthy" | "failed";
  mode: AntivirusMode;
  provider: string;
  platform: string;
  attempts: number;
  cleanProbe?: {
    status: number | null;
    output: string;
  };
  eicarProbe?: {
    status: number | null;
    output: string;
  };
}

export class ClamAvInstallerHealthError extends Error {
  readonly kind: ClamAvInstallerHealthFailureKind;
  readonly report: ClamAvInstallerHealthReport;

  constructor(kind: ClamAvInstallerHealthFailureKind, message: string, report: ClamAvInstallerHealthReport) {
    super(message);
    this.name = "ClamAvInstallerHealthError";
    this.kind = kind;
    this.report = report;
  }
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
  llmCommandRunner?: LlmLocalCommandRunner;
  llmAuditSink?: LlmAuditSink;
  apiReadyCheck?: (url: string) => Promise<boolean> | boolean;
  firstRunCredentials?: FirstRunCredentials;
  s3FetchImpl?: typeof fetch;
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

export interface InstallBackupReport {
  backupPath: string;
  copiedPaths: string[];
}

export interface InstallUpdateOptions extends InstallExecutionOptions {
  dryRun?: boolean;
  backupLabel?: string;
}

export interface InstallUpdateReport {
  dryRun: boolean;
  backup?: InstallBackupReport;
  executedStepIds: string[];
  pendingStepIds: string[];
}

export interface InstallUninstallOptions {
  yes: boolean;
  backup?: boolean;
}

export interface InstallUninstallReport {
  removed: boolean;
  backupPath?: string;
}

export type RuntimeBackupComponent = "config" | "installer_state" | "postgres" | "objects" | "librefs" | "external_s3";
export type RuntimeBackupComponentStatus = "backed_up" | "restored" | "skipped" | "missing" | "dry_run";

export interface RuntimeBackupComponentReport {
  component: RuntimeBackupComponent;
  status: RuntimeBackupComponentStatus;
  source?: string;
  target?: string;
  backupRelativePath?: string;
  restoreTargetRelativePath?: string;
  reason?: string;
}

export interface RuntimeBackupManifest {
  schema_version: InstallerSchemaVersion;
  kind: "mindory-runtime-backup";
  created_at: string;
  mindory_home: string;
  storage: {
    provider: string;
    s3_endpoint?: string;
  };
  components: RuntimeBackupComponentReport[];
}

export interface RuntimeBackupOptions extends InstallExecutionOptions {
  outputDirectory?: string;
  label?: string;
  dryRun?: boolean;
  includeConfig?: boolean;
  includePostgres?: boolean;
  includeObjects?: boolean;
}

export interface RuntimeBackupReport {
  backupPath: string;
  manifestPath: string;
  dryRun: boolean;
  components: RuntimeBackupComponentReport[];
}

export interface RuntimeRestoreOptions extends InstallExecutionOptions {
  yes: boolean;
  restoreConfig?: boolean;
  restorePostgres?: boolean;
  restoreObjects?: boolean;
}

export interface RuntimeRestoreReport {
  backupPath: string;
  manifestPath: string;
  restored: boolean;
  components: RuntimeBackupComponentReport[];
}

export interface PostgresPitrBackupManifest {
  schema_version: InstallerSchemaVersion;
  kind: "mindory-postgres-pitr-base";
  created_at: string;
  mindory_home: string;
  database: string;
  user: string;
  base_backup_relative_path: string;
  wal_archive_path: string;
  wal_archive_relative_path: string;
}

export interface PostgresPitrBackupOptions extends InstallExecutionOptions {
  outputDirectory?: string;
  label?: string;
  dryRun?: boolean;
}

export interface PostgresPitrBackupReport {
  backupPath: string;
  manifestPath: string;
  baseBackupPath: string;
  walArchivePath: string;
  dryRun: boolean;
}

export interface PostgresPitrRestoreOptions extends InstallExecutionOptions {
  yes: boolean;
  targetTime: string | Date;
  restoreDirectory?: string;
  replaceLiveData?: boolean;
}

export interface PostgresPitrRestoreReport {
  backupPath: string;
  manifestPath: string;
  restorePath: string;
  walArchivePath: string;
  targetTime: string;
  recoveryConfigPath: string;
  recoverySignalPath: string;
  replacedLiveData: boolean;
  liveDataBackupPath?: string;
}

export interface ScheduledBackupConfig {
  enabled: boolean;
  intervalMinutes: number;
  retentionCount: number;
  retentionDays: number;
  includeConfig: boolean;
  includePostgres: boolean;
  includeObjects: boolean;
}

export interface ScheduledBackupHealth {
  schema_version: InstallerSchemaVersion;
  kind: "mindory-scheduled-backup-health";
  enabled: boolean;
  interval_minutes: number;
  retention_count: number;
  retention_days: number;
  last_started_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  last_backup_path: string | null;
  next_run_at: string | null;
}

export interface ScheduledBackupRetentionReport {
  deleted: string[];
  kept: string[];
}

export interface ScheduledBackupOptions extends RuntimeBackupOptions {
  force?: boolean;
  now?: Date;
  config?: Partial<ScheduledBackupConfig>;
}

export interface ScheduledBackupReport {
  status: "disabled" | "skipped_not_due" | "already_running" | "dry_run" | "backed_up" | "backup_failed";
  lockPath: string;
  healthPath: string;
  logPath: string;
  health: ScheduledBackupHealth;
  backup?: RuntimeBackupReport;
  retention: ScheduledBackupRetentionReport;
}

export interface InstallStateInspection {
  lockPath: string;
  lock: InstallLockRecord | null;
  journalPath: string;
  journalEntries: number;
  lastEvent?: InstallJournalEntry;
  recommendedAction: string;
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
    vector: {
      provider: catalogDefault("MINDORY_VECTOR_PROVIDER") as VectorProvider,
      qdrantUrl: catalogDefault("MINDORY_QDRANT_URL"),
      qdrantCollectionPrefix: catalogDefault("MINDORY_QDRANT_COLLECTION_PREFIX")
    },
    docling: {
      enabled: catalogDefault("MINDORY_DOCLING_ENABLED") === "true",
      url: catalogDefault("MINDORY_DOCLING_URL"),
      timeoutMs: Number.parseInt(catalogDefault("MINDORY_DOCLING_TIMEOUT_MS"), 10),
      port: Number.parseInt(catalogDefault("MINDORY_DOCLING_PORT"), 10)
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
      videoMaxKeyframes: Number.parseInt(catalogDefault("MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES"), 10),
      videoKeyframeProvider: catalogDefault("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER") as VideoKeyframeProvider,
      videoFfmpegCommand: catalogDefault("MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND"),
      videoFfprobeCommand: catalogDefault("MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND")
    },
    llmRoles: {},
    llmProviders: {
      openaiCompatibleBaseUrl: catalogDefault("MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL"),
      openaiCompatibleAuthMode: catalogDefault("MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE") as LlmOpenAiAuthMode,
      openaiCompatibleApiKey: catalogDefault("MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY"),
      openaiOAuthAccessToken: catalogDefault("MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN"),
      ollamaBaseUrl: catalogDefault("MINDORY_LLM_OLLAMA_BASE_URL"),
      localHttpBaseUrl: catalogDefault("MINDORY_LLM_LOCAL_HTTP_BASE_URL"),
      localCommandTimeoutMs: Number.parseInt(catalogDefault("MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS"), 10),
      localCommandHealthcheckCommand: catalogDefault("MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND"),
      localCommandHealthcheckArgs: parseJsonStringArray(catalogDefault("MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS"), "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS"),
      localCommandOperationCommand: catalogDefault("MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND"),
      localCommandOperationArgs: parseJsonStringArray(catalogDefault("MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS"), "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS"),
      localCommandMaxInputBytes: Number.parseInt(catalogDefault("MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES"), 10),
      localCommandMaxOutputBytes: Number.parseInt(catalogDefault("MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES"), 10)
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
  validateCatalogValue(errors, "MINDORY_VECTOR_PROVIDER", answers.vector.provider);
  validateDoclingAnswers(errors, answers.docling);
  if (answers.storage.provider === "s3") {
    errors.push(...validateS3StorageAnswers(answers.storage.s3));
  }
  if (answers.vector.provider === "qdrant") {
    try {
      const parsed = new URL(answers.vector.qdrantUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errors.push("vector.qdrantUrl must use http or https.");
      }
    } catch {
      errors.push("vector.qdrantUrl must be a valid URL.");
    }
    if (answers.vector.qdrantCollectionPrefix.trim() === "") {
      errors.push("vector.qdrantCollectionPrefix is required when Qdrant is selected.");
    }
  }
  validateCatalogValue(errors, "MINDORY_AV_MODE", answers.antivirus.mode);
  validateCatalogValue(errors, "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE", answers.llmProviders.openaiCompatibleAuthMode);
  if (answers.interfaces.apiPort <= 0 || answers.interfaces.apiPort > 65535) {
    errors.push("interfaces.apiPort must be a valid TCP port.");
  }
  if (answers.modalities.videoMaxKeyframes <= 0) {
    errors.push("modalities.videoMaxKeyframes must be greater than zero.");
  }
  validateCatalogValue(errors, "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER", answers.modalities.videoKeyframeProvider);
  if (answers.modalities.video && answers.modalities.videoKeyframeProvider === "ffmpeg" && answers.modalities.videoFfmpegCommand.trim() === "") {
    errors.push("modalities.videoFfmpegCommand is required when ffmpeg keyframe extraction is selected.");
  }
  for (const [role, roleAnswers] of Object.entries(answers.llmRoles)) {
    if (!LLM_ROLE_KEYS.includes(role as InstallerLlmRoleKey)) {
      errors.push(`Unknown LLM role ${role}.`);
      continue;
    }
    validateCatalogValue(errors, `MINDORY_LLM_${role}_PROVIDER`, roleAnswers.provider);
    const roleKey = role as InstallerLlmRoleKey;
    if (roleAnswers.enabled && roleSupportRequiresExperimental(llmRoleSupportStatus(roleKey)) && !answers.allowExperimental) {
      errors.push(`llmRoles.${role}.enabled requires experimental mode because the role is ${llmRoleSupportStatus(roleKey)}.`);
    }
    if (roleAnswers.enabled && roleAnswers.provider === "disabled") {
      errors.push(`llmRoles.${role}.provider cannot be disabled when the role is enabled.`);
    }
    if (
      roleAnswers.enabled &&
      roleAnswers.provider !== "disabled" &&
      roleSupportRequiresExperimental(llmRoleProviderSupportStatus(roleKey, roleAnswers.provider)) &&
      !answers.allowExperimental
    ) {
      errors.push(`llmRoles.${role}.provider ${roleAnswers.provider} requires experimental mode because it is ${llmRoleProviderSupportStatus(roleKey, roleAnswers.provider)} for this role.`);
    }
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
  if (answers.llmProviders.localCommandTimeoutMs <= 0) {
    errors.push("llmProviders.localCommandTimeoutMs must be greater than zero.");
  }
  if (answers.llmProviders.localCommandMaxInputBytes <= 0) {
    errors.push("llmProviders.localCommandMaxInputBytes must be greater than zero.");
  }
  if (answers.llmProviders.localCommandMaxOutputBytes <= 0) {
    errors.push("llmProviders.localCommandMaxOutputBytes must be greater than zero.");
  }
  if (answersUsesLocalCommandProvider(answers)) {
    if (answers.llmProviders.localCommandHealthcheckCommand.trim() === "") {
      errors.push("llmProviders.localCommandHealthcheckCommand is required when a local-command LLM role is enabled.");
    }
    if (answers.llmProviders.localCommandOperationCommand.trim() === "") {
      errors.push("llmProviders.localCommandOperationCommand is required when a local-command LLM role is enabled.");
    }
    if (!answers.llmProviders.localCommandHealthcheckArgs.every((entry) => typeof entry === "string")) {
      errors.push("llmProviders.localCommandHealthcheckArgs must be a JSON string array.");
    }
    if (!answers.llmProviders.localCommandOperationArgs.every((entry) => typeof entry === "string")) {
      errors.push("llmProviders.localCommandOperationArgs must be a JSON string array.");
    }
  }
  return errors;
}

function validateDoclingAnswers(errors: string[], answers: DoclingAnswers): void {
  if (answers.timeoutMs <= 0) {
    errors.push("docling.timeoutMs must be greater than zero.");
  }
  if (answers.port <= 0 || answers.port > 65535) {
    errors.push("docling.port must be a valid TCP port.");
  }
  if (!answers.enabled) {
    return;
  }
  try {
    const parsed = new URL(answers.url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      errors.push("docling.url must use http or https.");
    }
  } catch {
    errors.push("docling.url must be a valid URL.");
  }
}

export function validateS3StorageAnswers(answers: S3StorageAnswers): string[] {
  const errors: string[] = [];
  try {
    const parsed = new URL(answers.endpoint);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      errors.push("storage.s3.endpoint must use http or https.");
    }
  } catch {
    errors.push("storage.s3.endpoint must be a valid URL.");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(answers.bucket) || answers.bucket.includes("..")) {
    errors.push("storage.s3.bucket must be a valid S3-compatible bucket name.");
  }
  if (answers.accessKeyId.trim() === "") {
    errors.push("storage.s3.accessKeyId is required.");
  }
  if (answers.secretAccessKey.trim() === "") {
    errors.push("storage.s3.secretAccessKey is required.");
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
      step("bootstrap-storage", "Bootstrap object storage bucket", "docker", "none"),
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
    if (answers.modalities.video && answers.modalities.videoKeyframeProvider === "ffmpeg") {
      checks.push(commandCheck("ffmpeg", "ffmpeg", probe.run(answers.modalities.videoFfmpegCommand, ["-version"]), true, "Install ffmpeg or choose the manifest video keyframe provider."));
    }
  } else {
    checks.push({ id: "node", label: "Node.js", status: "skipped", required: false });
    checks.push({ id: "pnpm", label: "pnpm", status: "skipped", required: false });
    checks.push({ id: "ffmpeg", label: "ffmpeg", status: "skipped", required: false });
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

export async function updateInstallAssets(
  answers: MindoryInstallAnswers,
  options: InstallUpdateOptions = {}
): Promise<InstallUpdateReport> {
  const plan = createInstallPlan(answers);
  if (options.dryRun === true) {
    return {
      dryRun: true,
      executedStepIds: [],
      pendingStepIds: plan.steps.map((stepItem) => stepItem.id)
    };
  }

  const backup = createInstallBackup(plan.mindoryHome, options.backupLabel ?? "pre-update");
  try {
    const report = await executeInstallPlan(answers, {
      ...options,
      stopBeforeStepId: "pull-images",
      owner: options.owner ?? "mindory-installer-update"
    });
    return {
      dryRun: false,
      backup,
      executedStepIds: report.executedStepIds,
      pendingStepIds: report.pendingStepIds
    };
  } catch (error) {
    restoreInstallBackup(plan.mindoryHome, backup.backupPath);
    throw error;
  }
}

export function uninstallMindoryHome(mindoryHome: string, options: InstallUninstallOptions): InstallUninstallReport {
  if (!options.yes) {
    throw new Error("Uninstall requires explicit confirmation through yes=true or --yes.");
  }
  const resolvedHome = assertSafeMindoryHome(mindoryHome);
  let backupPath: string | undefined;
  if (options.backup === true && existsSync(resolvedHome)) {
    backupPath = `${resolvedHome}.backup.${timestampLabel()}`;
    cpSync(resolvedHome, backupPath, { recursive: true });
  }
  rmSync(resolvedHome, { recursive: true, force: true });
  return {
    removed: true,
    ...(backupPath === undefined ? {} : { backupPath })
  };
}

export async function createMindoryRuntimeBackup(
  mindoryHome: string,
  options: RuntimeBackupOptions = {}
): Promise<RuntimeBackupReport> {
  const resolvedHome = assertSafeMindoryHome(mindoryHome);
  const homeEnv = readMindoryHomeEnvironment(resolvedHome);
  const dryRun = options.dryRun === true;
  const backupPath = path.resolve(options.outputDirectory ?? path.join(resolvedHome, "backups", `${timestampLabel()}-${sanitizeBackupLabel(options.label ?? "runtime-backup")}`));
  const manifestPath = path.join(backupPath, "backup-manifest.json");
  const components: RuntimeBackupComponentReport[] = [];
  const plan = createRuntimePlanFromHome(resolvedHome, homeEnv);

  if (!dryRun) {
    mkdirSync(backupPath, { recursive: true, mode: 0o700 });
  }

  if (options.includeConfig !== false) {
    components.push(copyBackupComponent({
      component: "config",
      source: path.join(resolvedHome, "config"),
      target: path.join(backupPath, "config"),
      backupRelativePath: "config",
      restoreTargetRelativePath: "config",
      dryRun
    }));
    components.push(copyBackupComponent({
      component: "installer_state",
      source: path.join(resolvedHome, "install"),
      target: path.join(backupPath, "installer-state"),
      backupRelativePath: "installer-state",
      restoreTargetRelativePath: "install",
      dryRun
    }));
  }

  if (options.includePostgres !== false) {
    components.push(await backupPostgresDatabase(plan, backupPath, dryRun, options));
  }

  if (options.includeObjects !== false) {
    for (const storageSource of objectStorageBackupSources(resolvedHome, homeEnv)) {
      components.push(copyBackupComponent({
        component: storageSource.component,
        source: storageSource.source,
        target: path.join(backupPath, storageSource.backupRelativePath),
        backupRelativePath: storageSource.backupRelativePath,
        restoreTargetRelativePath: storageSource.restoreTargetRelativePath,
        dryRun
      }));
    }
    if (objectStorageBackupSources(resolvedHome, homeEnv).length === 0) {
      components.push({
        component: "external_s3",
        status: "skipped",
        reason: "External S3-compatible buckets are not copied by the MVP local backup command; use provider-native bucket backup tooling."
      });
    }
  }

  if (!dryRun) {
    const manifest = createRuntimeBackupManifest(resolvedHome, homeEnv, components);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }

  return {
    backupPath,
    manifestPath,
    dryRun,
    components
  };
}

export async function restoreMindoryRuntimeBackup(
  mindoryHome: string,
  backupPath: string,
  options: RuntimeRestoreOptions
): Promise<RuntimeRestoreReport> {
  if (!options.yes) {
    throw new Error("Restore requires explicit confirmation through yes=true or --yes.");
  }
  const resolvedHome = assertSafeMindoryHome(mindoryHome);
  const resolvedBackup = path.resolve(backupPath);
  const manifestPath = path.join(resolvedBackup, "backup-manifest.json");
  const manifest = readRuntimeBackupManifest(manifestPath);
  const homeEnv = readMindoryHomeEnvironment(resolvedHome);
  const plan = createRuntimePlanFromHome(resolvedHome, homeEnv);
  const components: RuntimeBackupComponentReport[] = [];

  if (options.restoreConfig !== false) {
    components.push(restoreFilesystemComponent(manifest, resolvedBackup, resolvedHome, "config"));
    components.push(restoreFilesystemComponent(manifest, resolvedBackup, resolvedHome, "installer_state"));
  }

  if (options.restoreObjects !== false) {
    components.push(restoreFilesystemComponent(manifest, resolvedBackup, resolvedHome, "objects"));
    components.push(restoreFilesystemComponent(manifest, resolvedBackup, resolvedHome, "librefs"));
  }

  if (options.restorePostgres !== false) {
    components.push(await restorePostgresDatabase(plan, resolvedBackup, options));
  }

  return {
    backupPath: resolvedBackup,
    manifestPath,
    restored: components.some((component) => component.status === "restored"),
    components
  };
}

export async function createMindoryPostgresPitrBaseBackup(
  mindoryHome: string,
  options: PostgresPitrBackupOptions = {}
): Promise<PostgresPitrBackupReport> {
  const resolvedHome = assertSafeMindoryHome(mindoryHome);
  const homeEnv = readMindoryHomeEnvironment(resolvedHome);
  const dryRun = options.dryRun === true;
  const backupPath = path.resolve(options.outputDirectory ?? path.join(resolvedHome, "backups", `${timestampLabel()}-${sanitizeBackupLabel(options.label ?? "postgres-pitr-base")}`));
  const manifestPath = path.join(backupPath, "pitr-manifest.json");
  const baseBackupPath = path.join(backupPath, "basebackup");
  const walArchivePath = postgresWalArchivePath(resolvedHome);
  const plan = createRuntimePlanFromHome(resolvedHome, homeEnv);
  const { database, user } = postgresConnectionParts(plan.environment.MINDORY_DATABASE_URL);

  if (dryRun) {
    return {
      backupPath,
      manifestPath,
      baseBackupPath,
      walArchivePath,
      dryRun: true
    };
  }

  assertPathInside(backupPath, path.join(resolvedHome, "backups"));
  mkdirSync(baseBackupPath, { recursive: true, mode: 0o700 });
  mkdirSync(walArchivePath, { recursive: true, mode: 0o700 });

  const containerBasePath = `/tmp/mindory-pitr-base-${timestampLabel()}`;
  await runDockerCompose(plan, [
    "exec",
    "-T",
    "postgres",
    "sh",
    "-lc",
    [
      `rm -rf ${shellQuote(containerBasePath)}`,
      `mkdir -p ${shellQuote(containerBasePath)}`,
      `pg_basebackup -U ${shellQuote(user)} -D ${shellQuote(containerBasePath)} -Ft -z -X fetch -P`
    ].join(" && ")
  ], options);
  await runDockerCompose(plan, ["cp", `postgres:${containerBasePath}`, baseBackupPath], options);
  await runDockerCompose(plan, [
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    user,
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CHECKPOINT; SELECT pg_switch_wal();"
  ], options);
  try {
    await runDockerCompose(plan, ["exec", "-T", "postgres", "rm", "-rf", containerBasePath], options);
  } catch {
    // A failed temp-directory cleanup should not invalidate an otherwise complete base backup.
  }

  const manifest: PostgresPitrBackupManifest = {
    schema_version: INSTALLER_SCHEMA_VERSION,
    kind: "mindory-postgres-pitr-base",
    created_at: new Date().toISOString(),
    mindory_home: resolvedHome,
    database,
    user,
    base_backup_relative_path: "basebackup",
    wal_archive_path: walArchivePath,
    wal_archive_relative_path: path.join("backups", "postgres-wal")
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  return {
    backupPath,
    manifestPath,
    baseBackupPath,
    walArchivePath,
    dryRun: false
  };
}

export async function restoreMindoryPostgresPitrBackup(
  mindoryHome: string,
  backupPath: string,
  options: PostgresPitrRestoreOptions
): Promise<PostgresPitrRestoreReport> {
  if (!options.yes) {
    throw new Error("PITR restore requires explicit confirmation through yes=true or --yes.");
  }
  const resolvedHome = assertSafeMindoryHome(mindoryHome);
  const resolvedBackup = path.resolve(backupPath);
  const manifestPath = path.join(resolvedBackup, "pitr-manifest.json");
  const manifest = readPostgresPitrBackupManifest(manifestPath);
  const targetTime = normalizePitrTargetTime(options.targetTime);
  const restorePath = path.resolve(options.restoreDirectory ?? path.join(resolvedHome, "backups", "pitr-restore", `${timestampLabel()}-restore`));
  const backupsRoot = path.join(resolvedHome, "backups");
  assertPathInside(restorePath, backupsRoot);
  const walArchivePath = path.resolve(manifest.wal_archive_path || postgresWalArchivePath(resolvedHome));
  assertPathInside(walArchivePath, backupsRoot);
  const baseBackupPath = path.join(resolvedBackup, manifest.base_backup_relative_path);
  if (!existsSync(baseBackupPath)) {
    throw new Error(`PITR base backup files not found at ${baseBackupPath}.`);
  }
  if (!existsSync(walArchivePath)) {
    throw new Error(`PITR WAL archive not found at ${walArchivePath}.`);
  }

  mkdirSync(restorePath, { recursive: true, mode: 0o700 });
  const homeEnv = readMindoryHomeEnvironment(resolvedHome);
  const plan = createRuntimePlanFromHome(resolvedHome, homeEnv);
  await runDockerCompose(plan, [
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "--entrypoint",
    "sh",
    "-v",
    `${baseBackupPath}:/backup:ro`,
    "-v",
    `${restorePath}:/restore`,
    "-v",
    `${walArchivePath}:/wal-archive:ro`,
    "postgres",
    "-lc",
    renderPostgresPitrRestoreScript(targetTime)
  ], options);

  let liveDataBackupPath: string | undefined;
  if (options.replaceLiveData === true) {
    await runDockerCompose(plan, ["down"], options);
    const liveDataPath = path.join(resolvedHome, "data", "postgres");
    assertPathInside(liveDataPath, resolvedHome);
    liveDataBackupPath = path.join(resolvedHome, "backups", `${timestampLabel()}-postgres-data-before-pitr`);
    if (existsSync(liveDataPath)) {
      cpSync(liveDataPath, liveDataBackupPath, { recursive: true });
    }
    rmSync(liveDataPath, { recursive: true, force: true });
    mkdirSync(path.dirname(liveDataPath), { recursive: true, mode: 0o700 });
    cpSync(restorePath, liveDataPath, { recursive: true });
  }

  return {
    backupPath: resolvedBackup,
    manifestPath,
    restorePath,
    walArchivePath,
    targetTime,
    recoveryConfigPath: path.join(restorePath, "postgresql.auto.conf"),
    recoverySignalPath: path.join(restorePath, "recovery.signal"),
    replacedLiveData: options.replaceLiveData === true,
    ...(liveDataBackupPath === undefined ? {} : { liveDataBackupPath })
  };
}

export async function runScheduledMindoryBackup(
  mindoryHome: string,
  options: ScheduledBackupOptions = {}
): Promise<ScheduledBackupReport> {
  const resolvedHome = assertSafeMindoryHome(mindoryHome);
  const now = options.now ?? new Date();
  const config = readScheduledBackupConfig(resolvedHome, options.config);
  const lockPath = scheduledBackupLockPath(resolvedHome);
  const healthPath = scheduledBackupHealthPath(resolvedHome);
  const logPath = scheduledBackupLogPath(resolvedHome);
  const previousHealth = readScheduledBackupHealth(resolvedHome);

  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });

  if (!config.enabled && options.force !== true) {
    const health = buildScheduledBackupHealth(config, previousHealth, now, {
      nextRunAt: null
    });
    writeScheduledBackupHealth(healthPath, health);
    appendScheduledBackupLog(logPath, "disabled", health);
    return {
      status: "disabled",
      lockPath,
      healthPath,
      logPath,
      health,
      retention: { deleted: [], kept: listRuntimeBackupDirectories(resolvedHome).map((entry) => entry.path) }
    };
  }

  const nextRunAt = computeNextScheduledBackupRun(config, previousHealth, now);
  if (options.force !== true && now.getTime() < nextRunAt.getTime()) {
    const health = buildScheduledBackupHealth(config, previousHealth, now, {
      nextRunAt
    });
    writeScheduledBackupHealth(healthPath, health);
    appendScheduledBackupLog(logPath, "skipped_not_due", health);
    return {
      status: "skipped_not_due",
      lockPath,
      healthPath,
      logPath,
      health,
      retention: { deleted: [], kept: listRuntimeBackupDirectories(resolvedHome).map((entry) => entry.path) }
    };
  }

  if (options.dryRun === true) {
    const backup = await createMindoryRuntimeBackup(resolvedHome, {
      ...options,
      label: options.label ?? "scheduled",
      dryRun: true,
      includeConfig: config.includeConfig,
      includePostgres: config.includePostgres,
      includeObjects: config.includeObjects
    });
    const health = buildScheduledBackupHealth(config, previousHealth, now, {
      lastStartedAt: now,
      nextRunAt: addMinutes(now, config.intervalMinutes)
    });
    return {
      status: "dry_run",
      lockPath,
      healthPath,
      logPath,
      health,
      backup,
      retention: { deleted: [], kept: listRuntimeBackupDirectories(resolvedHome).map((entry) => entry.path) }
    };
  }

  const lock = acquireScheduledBackupLock(lockPath, now);
  if (lock === null) {
    const health = buildScheduledBackupHealth(config, previousHealth, now, {
      nextRunAt
    });
    writeScheduledBackupHealth(healthPath, health);
    appendScheduledBackupLog(logPath, "already_running", health);
    return {
      status: "already_running",
      lockPath,
      healthPath,
      logPath,
      health,
      retention: { deleted: [], kept: listRuntimeBackupDirectories(resolvedHome).map((entry) => entry.path) }
    };
  }

  try {
    const backup = await createMindoryRuntimeBackup(resolvedHome, {
      ...options,
      label: options.label ?? "scheduled",
      includeConfig: config.includeConfig,
      includePostgres: config.includePostgres,
      includeObjects: config.includeObjects
    });
    const retention = applyScheduledBackupRetention(resolvedHome, config, backup.backupPath, now);
    const health = buildScheduledBackupHealth(config, previousHealth, now, {
      lastStartedAt: now,
      lastSuccessAt: now,
      lastError: null,
      lastBackupPath: backup.backupPath,
      nextRunAt: addMinutes(now, config.intervalMinutes)
    });
    writeScheduledBackupHealth(healthPath, health);
    appendScheduledBackupLog(logPath, "backed_up", health, { backupPath: backup.backupPath, deleted: retention.deleted });
    return {
      status: "backed_up",
      lockPath,
      healthPath,
      logPath,
      health,
      backup,
      retention
    };
  } catch (error) {
    const health = buildScheduledBackupHealth(config, previousHealth, now, {
      lastStartedAt: now,
      lastFailureAt: now,
      lastError: error instanceof Error ? error.message : String(error),
      nextRunAt: addMinutes(now, config.intervalMinutes)
    });
    writeScheduledBackupHealth(healthPath, health);
    appendScheduledBackupLog(logPath, "backup_failed", health);
    return {
      status: "backup_failed",
      lockPath,
      healthPath,
      logPath,
      health,
      retention: { deleted: [], kept: listRuntimeBackupDirectories(resolvedHome).map((entry) => entry.path) }
    };
  } finally {
    releaseScheduledBackupLock(lockPath, lock);
  }
}

export function readScheduledBackupHealth(mindoryHome: string): ScheduledBackupHealth | null {
  const healthPath = scheduledBackupHealthPath(assertSafeMindoryHome(mindoryHome));
  if (!existsSync(healthPath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(healthPath, "utf8")) as ScheduledBackupHealth;
  return parsed.kind === "mindory-scheduled-backup-health" ? parsed : null;
}

export function inspectInstallState(mindoryHome: string): InstallStateInspection {
  const lock = readInstallLock(mindoryHome);
  const journal = readInstallJournal(mindoryHome) ?? [];
  const lastEvent = journal.at(-1);
  let recommendedAction = "No install journal was found. Run prepare or start to create an installation.";
  if (lock !== null) {
    recommendedAction = "An install lock exists. Confirm no installer is running, then run repair before retrying.";
  } else if (lastEvent?.event === "failed" || lastEvent?.event === "rollback_failed") {
    recommendedAction = "The last installer run failed. Review the journal, fix the cause and rerun the installer.";
  } else if (journal.length > 0) {
    recommendedAction = "The installer journal is readable. Resume execution is not automated yet; rerun the intended command after reviewing state.";
  }
  return {
    lockPath: installLockPath(mindoryHome),
    lock,
    journalPath: installJournalPath(mindoryHome),
    journalEntries: journal.length,
    ...(lastEvent === undefined ? {} : { lastEvent }),
    recommendedAction
  };
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
  assign(env, "MINDORY_VECTOR_PROVIDER", answers.vector.provider);
  assign(env, "MINDORY_QDRANT_URL", answers.vector.qdrantUrl);
  assign(env, "MINDORY_QDRANT_COLLECTION_PREFIX", answers.vector.qdrantCollectionPrefix);
  assign(env, "MINDORY_DOCLING_ENABLED", bool(answers.docling.enabled));
  assign(env, "MINDORY_DOCLING_URL", answers.docling.url);
  assign(env, "MINDORY_DOCLING_TIMEOUT_MS", String(answers.docling.timeoutMs));
  assign(env, "MINDORY_DOCLING_PORT", String(answers.docling.port));
  assign(env, "MINDORY_AV_MODE", answers.antivirus.mode);
  assign(env, "MINDORY_AV_PROVIDER", answers.antivirus.provider);
  assign(env, "MINDORY_CLAMAV_PLATFORM", answers.antivirus.clamavPlatform);
  assign(env, "MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED", bool(answers.modalities.text));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED", bool(answers.modalities.pdf));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED", bool(answers.modalities.image));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED", bool(answers.modalities.audio));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED", bool(answers.modalities.video));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", String(answers.modalities.videoMaxKeyframes));
  assign(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER", answers.modalities.videoKeyframeProvider);
  assign(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND", answers.modalities.videoFfmpegCommand);
  assign(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND", answers.modalities.videoFfprobeCommand);
  assign(env, "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL", answers.llmProviders.openaiCompatibleBaseUrl);
  assign(env, "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE", answers.llmProviders.openaiCompatibleAuthMode);
  assign(env, "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY", answers.llmProviders.openaiCompatibleApiKey);
  assign(env, "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN", answers.llmProviders.openaiOAuthAccessToken);
  assign(env, "MINDORY_LLM_OLLAMA_BASE_URL", answers.llmProviders.ollamaBaseUrl);
  assign(env, "MINDORY_LLM_LOCAL_HTTP_BASE_URL", answers.llmProviders.localHttpBaseUrl);
  assign(env, "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS", String(answers.llmProviders.localCommandTimeoutMs));
  assign(env, "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND", answers.llmProviders.localCommandHealthcheckCommand);
  assign(env, "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS", JSON.stringify(answers.llmProviders.localCommandHealthcheckArgs));
  assign(env, "MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND", answers.llmProviders.localCommandOperationCommand);
  assign(env, "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS", JSON.stringify(answers.llmProviders.localCommandOperationArgs));
  assign(env, "MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES", String(answers.llmProviders.localCommandMaxInputBytes));
  assign(env, "MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES", String(answers.llmProviders.localCommandMaxOutputBytes));
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
    vector: answers.vector,
    docling: answers.docling,
    antivirus: answers.antivirus,
    modalities: answers.modalities,
    llm_roles: answers.llmRoles,
    llm_providers: answers.llmProviders,
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
  if (answers.storage.provider === "s3" && answers.storage.s3.endpoint.includes("minio")) {
    profiles.add("minio");
  }
  if (answers.antivirus.mode !== "disabled" && answers.antivirus.provider === "clamav") {
    profiles.add("clamav");
  }
  if (answers.vector.provider === "qdrant") {
    profiles.add("qdrant");
  }
  if (answers.docling.enabled) {
    profiles.add("docling");
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

function answersUsesLocalCommandProvider(answers: MindoryInstallAnswers): boolean {
  return Object.values(answers.llmRoles).some((roleAnswers) => roleAnswers?.enabled === true && roleAnswers.provider === "local-command");
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
    promptFromCatalog("vector.provider", "MINDORY_VECTOR_PROVIDER", "choice"),
    promptFromCatalog("vector.qdrant_url", "MINDORY_QDRANT_URL", "text"),
    promptFromCatalog("vector.qdrant_collection_prefix", "MINDORY_QDRANT_COLLECTION_PREFIX", "text"),
    promptFromCatalog("docling.enabled", "MINDORY_DOCLING_ENABLED", "boolean"),
    promptFromCatalog("docling.url", "MINDORY_DOCLING_URL", "text"),
    promptFromCatalog("docling.timeout_ms", "MINDORY_DOCLING_TIMEOUT_MS", "number"),
    promptFromCatalog("docling.port", "MINDORY_DOCLING_PORT", "number"),
    promptFromCatalog("modalities.text", "MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED", "boolean"),
    promptFromCatalog("modalities.pdf", "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED", "boolean"),
    promptFromCatalog("modalities.image", "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED", "boolean"),
    promptFromCatalog("modalities.audio", "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED", "boolean"),
    promptFromCatalog("modalities.video", "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED", "boolean"),
    promptFromCatalog("modalities.video_max_keyframes", "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", "number"),
    promptFromCatalog("modalities.video_keyframe_provider", "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER", "choice"),
    promptFromCatalog("modalities.video_ffmpeg_command", "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND", "text"),
    promptFromCatalog("modalities.video_ffprobe_command", "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND", "text"),
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
  prompts.push(promptFromCatalog("llm.local_command.healthcheck_command", "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND", "text"));
  prompts.push(promptFromCatalog("llm.local_command.healthcheck_args", "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS", "text"));
  prompts.push(promptFromCatalog("llm.local_command.operation_command", "MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND", "text"));
  prompts.push(promptFromCatalog("llm.local_command.operation_args", "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS", "text"));

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

  answers.vector.provider = await askChoice(io, promptFromCatalog("vector.provider", "MINDORY_VECTOR_PROVIDER", "choice")) as VectorProvider;
  if (answers.vector.provider === "qdrant") {
    answers.vector.qdrantUrl = await askString(io, promptFromCatalog("vector.qdrant_url", "MINDORY_QDRANT_URL", "text", { defaultValue: answers.vector.qdrantUrl }));
    answers.vector.qdrantCollectionPrefix = await askString(io, promptFromCatalog("vector.qdrant_collection_prefix", "MINDORY_QDRANT_COLLECTION_PREFIX", "text", { defaultValue: answers.vector.qdrantCollectionPrefix }));
  }

  answers.docling.enabled = await askBoolean(io, promptFromCatalog("docling.enabled", "MINDORY_DOCLING_ENABLED", "boolean"));
  if (answers.docling.enabled) {
    answers.docling.url = await askString(io, promptFromCatalog("docling.url", "MINDORY_DOCLING_URL", "text", { defaultValue: answers.docling.url }));
    answers.docling.timeoutMs = await askNumber(io, promptFromCatalog("docling.timeout_ms", "MINDORY_DOCLING_TIMEOUT_MS", "number", { defaultValue: String(answers.docling.timeoutMs) }));
    answers.docling.port = await askNumber(io, promptFromCatalog("docling.port", "MINDORY_DOCLING_PORT", "number", { defaultValue: String(answers.docling.port) }));
  }

  answers.modalities.text = await askBoolean(io, promptFromCatalog("modalities.text", "MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED", "boolean"));
  answers.modalities.pdf = await askBoolean(io, promptFromCatalog("modalities.pdf", "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED", "boolean"));
  answers.modalities.image = await askBoolean(io, promptFromCatalog("modalities.image", "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED", "boolean"));
  answers.modalities.audio = await askBoolean(io, promptFromCatalog("modalities.audio", "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED", "boolean"));
  answers.modalities.video = await askBoolean(io, promptFromCatalog("modalities.video", "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED", "boolean"));
  answers.modalities.videoMaxKeyframes = await askNumber(io, promptFromCatalog("modalities.video_max_keyframes", "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", "number"));
  answers.modalities.videoKeyframeProvider = await askChoice(io, promptFromCatalog("modalities.video_keyframe_provider", "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER", "choice")) as VideoKeyframeProvider;
  if (answers.modalities.videoKeyframeProvider === "ffmpeg") {
    answers.modalities.videoFfmpegCommand = await askString(io, promptFromCatalog("modalities.video_ffmpeg_command", "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND", "text", { defaultValue: answers.modalities.videoFfmpegCommand }));
    answers.modalities.videoFfprobeCommand = await askString(io, promptFromCatalog("modalities.video_ffprobe_command", "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND", "text", { defaultValue: answers.modalities.videoFfprobeCommand }));
  }

  for (const role of LLM_ROLE_KEYS) {
    const experimentalAllowed = answers.allowExperimental || options.allowExperimental === true;
    const roleAllowed = roleSupportStatus(role) === "supported" || experimentalAllowed;
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
    if (
      roleAnswers.provider !== "disabled" &&
      roleSupportRequiresExperimental(llmRoleProviderSupportStatus(role, roleAnswers.provider)) &&
      !experimentalAllowed
    ) {
      throw new Error(`MINDORY_LLM_${role}_PROVIDER=${roleAnswers.provider} is ${llmRoleProviderSupportStatus(role, roleAnswers.provider)} and requires experimental mode.`);
    }
    const dimensionsEntry = maybeCatalogEntry(`MINDORY_LLM_${role}_DIMENSIONS`);
    if (dimensionsEntry !== undefined) {
      const dimensions = await askString(io, promptFromEntry(`llm.${role}.dimensions`, dimensionsEntry, "number"));
      roleAnswers.dimensions = dimensions.trim() === "" ? null : Number.parseInt(dimensions, 10);
    }
    answers.llmRoles[role] = roleAnswers;
  }

  if (answersUsesLocalCommandProvider(answers)) {
    answers.llmProviders.localCommandHealthcheckCommand = await askString(io, promptFromCatalog("llm.local_command.healthcheck_command", "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND", "text"));
    answers.llmProviders.localCommandHealthcheckArgs = parseJsonStringArray(
      await askString(io, promptFromCatalog("llm.local_command.healthcheck_args", "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS", "text")),
      "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS"
    );
    answers.llmProviders.localCommandOperationCommand = await askString(io, promptFromCatalog("llm.local_command.operation_command", "MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND", "text"));
    answers.llmProviders.localCommandOperationArgs = parseJsonStringArray(
      await askString(io, promptFromCatalog("llm.local_command.operation_args", "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS", "text")),
      "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS"
    );
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
  if (stepItem.id === "bootstrap-storage") {
    await bootstrapObjectStorage(answers, plan, options);
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

async function bootstrapObjectStorage(
  answers: MindoryInstallAnswers,
  plan: InstallPlan,
  options: InstallExecutionOptions
): Promise<void> {
  if (answers.storage.provider !== "s3") {
    return;
  }
  const bootstrapService = storageBootstrapService(plan);
  if (bootstrapService !== undefined) {
    await runDockerCompose(plan, ["up", bootstrapService], options);
    return;
  }
  await checkS3StorageAccess(answers, options.s3FetchImpl);
}

export async function checkS3StorageAccess(
  answers: MindoryInstallAnswers,
  fetchImpl?: typeof fetch
): Promise<void> {
  if (answers.storage.provider !== "s3") {
    return;
  }
  const storageOptions = {
    endpoint: answers.storage.s3.endpoint,
    region: answers.storage.s3.region,
    bucket: answers.storage.s3.bucket,
    accessKeyId: answers.storage.s3.accessKeyId,
    secretAccessKey: answers.storage.s3.secretAccessKey,
    forcePathStyle: answers.storage.s3.forcePathStyle
  };
  const storage = new S3ObjectStorage(fetchImpl === undefined ? storageOptions : {
    ...storageOptions,
    fetchImpl
  });
  await storage.ensureBucket();
  await storage.checkBucketAccess();
}

async function runComposeMigrations(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  await runDockerCompose(plan, ["up", "migrate"], options);
}

async function startComposeRuntime(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  await runDockerCompose(plan, ["up", "-d", "api", "worker", "mcp"], options);
}

async function runInstallHealthChecks(plan: InstallPlan, options: InstallExecutionOptions): Promise<void> {
  await waitForComposeServices(plan, options);
  await checkClamAvInstallerHealth(plan, options);
  await checkLocalCommandLlmInstallerHealth(plan, options);
  await checkFfmpegInstallerHealth(plan, options);
  await waitForApiReady(plan, options);
}

export async function checkFfmpegInstallerHealth(plan: InstallPlan, options: InstallExecutionOptions = {}): Promise<InstallCommandResult | null> {
  if (plan.environment.MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER !== "ffmpeg") {
    return null;
  }
  const command = plan.environment.MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND || "ffmpeg";
  const result = await runDockerComposeWithoutStatusCheck(plan, [
    "exec",
    "-T",
    "worker",
    "sh",
    "-lc",
    `${shellQuote(command)} -version >/dev/null`
  ], options);
  if ((result.status ?? 1) === 0) {
    return result;
  }
  throw new Error(`ffmpeg health check failed in the worker container. Install ffmpeg in the runtime image or set MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND to a valid executable. ${commandOutput(result)}`);
}

export async function checkClamAvInstallerHealth(plan: InstallPlan, options: InstallExecutionOptions = {}): Promise<ClamAvInstallerHealthReport> {
  const mode = (plan.environment.MINDORY_AV_MODE ?? "disabled") as AntivirusMode;
  const provider = plan.environment.MINDORY_AV_PROVIDER ?? "disabled";
  const platform = plan.environment.MINDORY_CLAMAV_PLATFORM ?? "linux/amd64";
  const reportBase = {
    mode,
    provider,
    platform
  };
  if (!isClamAvInstallerEnabled(plan)) {
    return {
      ...reportBase,
      status: "skipped",
      attempts: 0
    };
  }

  const retries = readPositiveInteger(plan.environment.MINDORY_CLAMAV_HEALTH_RETRIES, 12);
  const timeoutMs = readPositiveInteger(plan.environment.MINDORY_CLAMAV_HEALTH_TIMEOUT_MS, 120_000);
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError: ClamAvInstallerHealthError | null = null;

  while (attempts < retries && Date.now() <= deadline) {
    attempts += 1;
    const report: ClamAvInstallerHealthReport = {
      ...reportBase,
      status: "failed",
      attempts
    };
    try {
      const cleanProbe = await runClamAvHealthProbe(plan, "clean", options);
      report.cleanProbe = {
        status: cleanProbe.status,
        output: commandOutput(cleanProbe)
      };
      const cleanFailure = classifyClamAvCleanProbe(cleanProbe);
      if (cleanFailure !== null) {
        throw clamAvHealthError(cleanFailure, report);
      }

      const eicarProbe = await runClamAvHealthProbe(plan, "eicar", options);
      report.eicarProbe = {
        status: eicarProbe.status,
        output: commandOutput(eicarProbe)
      };
      const eicarFailure = classifyClamAvEicarProbe(eicarProbe);
      if (eicarFailure !== null) {
        throw clamAvHealthError(eicarFailure, report);
      }
      report.status = "healthy";
      return report;
    } catch (error) {
      lastError = error instanceof ClamAvInstallerHealthError
        ? error
        : clamAvHealthError("command_failed", {
          ...reportBase,
          status: "failed",
          attempts
        }, errorToString(error));
      if (!isRetryableClamAvHealthFailure(lastError.kind)) {
        throw lastError;
      }
      if (attempts < retries && Date.now() <= deadline) {
        await sleep(options.pollIntervalMs ?? 2_000);
      }
    }
  }

  if (lastError !== null) {
    throw lastError;
  }
  throw clamAvHealthError("timeout", {
    ...reportBase,
    status: "failed",
    attempts
  });
}

export async function checkLocalCommandLlmInstallerHealth(plan: InstallPlan, options: InstallExecutionOptions = {}): Promise<LlmProviderHealth | null> {
  if (!planUsesLocalCommandProvider(plan)) {
    return null;
  }
  const config = loadMindoryConfig(plan.environment);
  const healthOptions: {
    commandRunner?: LlmLocalCommandRunner;
    auditSink?: LlmAuditSink;
  } = {};
  if (options.llmCommandRunner !== undefined) {
    healthOptions.commandRunner = options.llmCommandRunner;
  }
  if (options.llmAuditSink !== undefined) {
    healthOptions.auditSink = options.llmAuditSink;
  }
  const health = await checkMindoryLlmProviderHealth(config, "local-command", healthOptions);
  if (health.status === "ok") {
    return health;
  }
  throw new Error(formatLocalCommandLlmHealthFailure(health));
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
  const required = [...new Set([...infrastructureServices(plan), "api", "worker", "mcp"])];
  const completed = ["migrate", ...storageBootstrapServices(plan)];
  let lastStatus = "";

  while (Date.now() < deadline) {
    const records = parseComposeJson((await runDockerCompose(plan, ["ps", "--all", "--format", "json"], options, { captureOutput: true })).stdout);
    const missing = required.filter((service) => findComposeService(records, service) === undefined);
    const notReady = required.filter((service) => {
      const record = findComposeService(records, service);
      if (service === "clamav" && record !== undefined && isClamAvInstallerEnabled(plan)) {
        return !composeStatusText(record).includes("running");
      }
      return record !== undefined && !isComposeRunningAndHealthy(record);
    });
    const notCompleted = completed.filter((service) => {
      const record = findComposeService(records, service);
      return record === undefined || !isComposeCompletedSuccessfully(record);
    });
    const failed = records.find((record) => isComposeFailed(record) && !isClamAvDetailedHealthCandidate(plan, record));
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

function isClamAvDetailedHealthCandidate(plan: InstallPlan, record: Record<string, unknown>): boolean {
  return isClamAvInstallerEnabled(plan) && composeServiceName(record) === "clamav" && composeStatusText(record).includes("running");
}

function isClamAvInstallerEnabled(plan: InstallPlan): boolean {
  return plan.environment.MINDORY_AV_MODE !== "disabled" && plan.environment.MINDORY_AV_PROVIDER === "clamav";
}

function planUsesLocalCommandProvider(plan: InstallPlan): boolean {
  return LLM_ROLE_KEYS.some((role) =>
    plan.environment[`MINDORY_LLM_${role}_ENABLED`] === "true" &&
    plan.environment[`MINDORY_LLM_${role}_PROVIDER`] === "local-command"
  );
}

function formatLocalCommandLlmHealthFailure(health: LlmProviderHealth): string {
  const checks = health.checks ?? [];
  const failedChecks = checks.filter((check) => check.status === "failed");
  const details = failedChecks.map((check) =>
    `${check.role}/${check.model}: ${check.errorCode ?? "local_command_healthcheck_failed"}${check.errorMessage === undefined ? "" : ` - ${check.errorMessage}`}`
  );
  const summary = health.errorMessage ?? "local-command LLM healthcheck failed.";
  return [
    summary,
    "Verify MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND, MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS and the configured role/model names.",
    ...details
  ].join(" ");
}

function storageBootstrapServices(plan: InstallPlan): string[] {
  const service = storageBootstrapService(plan);
  return service === undefined ? [] : [service];
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

async function runClamAvHealthProbe(
  plan: InstallPlan,
  probe: "clean" | "eicar",
  options: InstallExecutionOptions
): Promise<InstallCommandResult> {
  const script = probe === "clean" ? clamAvCleanProbeScript() : clamAvEicarProbeScript();
  return runDockerComposeWithoutStatusCheck(plan, ["exec", "-T", "clamav", "sh", "-lc", script], options);
}

function clamAvCleanProbeScript(): string {
  const probePath = "/tmp/mindory-clamav-clean-health.txt";
  return [
    `printf %s ${shellQuote("mindory clamav clean health probe")} > ${shellQuote(probePath)}`,
    `clamdscan --no-summary ${shellQuote(probePath)}`,
    "code=$?",
    `rm -f ${shellQuote(probePath)}`,
    "exit $code"
  ].join("; ");
}

function clamAvEicarProbeScript(): string {
  const probePath = "/tmp/mindory-clamav-eicar-health.com";
  const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  return [
    `printf %s ${shellQuote(eicar)} > ${shellQuote(probePath)}`,
    `clamdscan --no-summary ${shellQuote(probePath)}`,
    "code=$?",
    `rm -f ${shellQuote(probePath)}`,
    "exit $code"
  ].join("; ");
}

function classifyClamAvCleanProbe(result: InstallCommandResult): ClamAvInstallerHealthFailureKind | null {
  const output = commandOutput(result);
  if ((result.status ?? 1) === 0 && /\bOK\b/i.test(output)) {
    return null;
  }
  if (/\bFOUND\b/i.test(output)) {
    return "unexpected_infected_result";
  }
  return classifyClamAvCommandFailure(result);
}

function classifyClamAvEicarProbe(result: InstallCommandResult): ClamAvInstallerHealthFailureKind | null {
  const output = commandOutput(result);
  if (/\bFOUND\b/i.test(output)) {
    return null;
  }
  if ((result.status ?? 1) === 0 && /\bOK\b/i.test(output)) {
    return "infected_probe_not_detected";
  }
  return classifyClamAvCommandFailure(result);
}

function classifyClamAvCommandFailure(result: InstallCommandResult): ClamAvInstallerHealthFailureKind {
  const output = commandOutput(result).toLowerCase();
  if (result.status === null || /connect|connection refused|connection reset|no such file|cannot assign requested address|unavailable|could not connect|can't connect/.test(output)) {
    return "daemon_unavailable";
  }
  if (/timed?\s*out|timeout|deadline/.test(output)) {
    return "timeout";
  }
  if (/protocol|malformed|parse|unexpected|unknown command|error\b/.test(output)) {
    return "protocol_failure";
  }
  return "command_failed";
}

function isRetryableClamAvHealthFailure(kind: ClamAvInstallerHealthFailureKind): boolean {
  return kind === "daemon_unavailable" || kind === "timeout" || kind === "command_failed";
}

function clamAvHealthError(
  kind: ClamAvInstallerHealthFailureKind,
  report: ClamAvInstallerHealthReport,
  detail?: string
): ClamAvInstallerHealthError {
  return new ClamAvInstallerHealthError(kind, formatClamAvHealthDiagnostic(kind, report, detail), report);
}

function formatClamAvHealthDiagnostic(
  kind: ClamAvInstallerHealthFailureKind,
  report: ClamAvInstallerHealthReport,
  detail?: string
): string {
  const output = [report.cleanProbe?.output, report.eicarProbe?.output, detail].filter((value) => value !== undefined && value.trim() !== "").join(" ");
  const cause: Record<ClamAvInstallerHealthFailureKind, string> = {
    daemon_unavailable: "ClamAV daemon is unavailable.",
    timeout: "ClamAV health check timed out.",
    protocol_failure: "ClamAV returned a scan protocol failure.",
    unexpected_infected_result: "ClamAV reported the clean health probe as infected.",
    infected_probe_not_detected: "ClamAV did not detect the EICAR health probe.",
    command_failed: "ClamAV health command failed."
  };
  const fix = [
    `mode=${report.mode}`,
    `provider=${report.provider}`,
    `MINDORY_CLAMAV_PLATFORM=${report.platform}`,
    "Check Docker Compose logs for the clamav service.",
    "On Docker Desktop Apple Silicon, keep linux/amd64 emulation enabled or choose a platform supported by clamav/clamav:stable.",
    "After fixing the daemon, rerun installer repair or start."
  ].join(" ");
  return `${cause[kind]} Attempts=${report.attempts}. ${fix}${output === "" ? "" : ` Last output: ${output}`}`;
}

function commandOutput(result: InstallCommandResult): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function runDockerCompose(
  plan: InstallPlan,
  composeArgs: readonly string[],
  options: InstallExecutionOptions,
  runOptions: { captureOutput?: boolean } = {}
): Promise<InstallCommandResult> {
  const result = await runDockerComposeWithoutStatusCheck(plan, composeArgs, options);
  if ((result.status ?? 1) !== 0) {
    const details = `${result.stderr || result.stdout}`.trim();
    throw new Error(`docker compose ${composeArgs.join(" ")} failed with exit code ${result.status ?? 1}${details === "" ? "" : `: ${details}`}`);
  }
  if (runOptions.captureOutput === true) {
    return result;
  }
  return result;
}

async function runDockerComposeWithoutStatusCheck(
  plan: InstallPlan,
  composeArgs: readonly string[],
  options: InstallExecutionOptions
): Promise<InstallCommandResult> {
  const runner = options.commandRunner ?? createNodeCommandRunner();
  return runner.run(options.dockerBinary ?? "docker", [...composeBaseArgs(plan, options), ...composeArgs], {
    cwd: composeWorkingDirectory(plan, options),
    env: composeEnvironment(plan)
  });
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

function storageBootstrapService(plan: InstallPlan): string | undefined {
  if (plan.environment.MINDORY_STORAGE_PROVIDER !== "s3") {
    return undefined;
  }
  if (plan.composeProfiles.includes("librefs")) {
    return "librefs-bucket";
  }
  if (plan.composeProfiles.includes("minio")) {
    return "minio-bucket";
  }
  return undefined;
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

function createInstallBackup(mindoryHome: string, label: string): InstallBackupReport {
  const backupPath = path.join(mindoryHome, "backups", `${timestampLabel()}-${label}`);
  const copiedPaths: string[] = [];
  mkdirSync(backupPath, { recursive: true, mode: 0o700 });
  for (const relativePath of ["config", path.join("install", "compose")]) {
    const sourcePath = path.join(mindoryHome, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const targetPath = path.join(backupPath, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    cpSync(sourcePath, targetPath, { recursive: true });
    copiedPaths.push(relativePath);
  }
  return { backupPath, copiedPaths };
}

function restoreInstallBackup(mindoryHome: string, backupPath: string): void {
  for (const relativePath of ["config", path.join("install", "compose")]) {
    const sourcePath = path.join(backupPath, relativePath);
    const targetPath = path.join(mindoryHome, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }
    rmSync(targetPath, { recursive: true, force: true });
    mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function readMindoryHomeEnvironment(mindoryHome: string): Record<string, string> {
  const envPath = path.join(mindoryHome, "config", ".env");
  if (!existsSync(envPath)) {
    return {};
  }
  return parseEnvFile(readFileSync(envPath, "utf8"));
}

function readScheduledBackupConfig(mindoryHome: string, overrides: Partial<ScheduledBackupConfig> | undefined): ScheduledBackupConfig {
  const env = readMindoryHomeEnvironment(mindoryHome);
  const config = {
    enabled: overrides?.enabled ?? readEnvBoolean(env, "MINDORY_BACKUP_SCHEDULE_ENABLED"),
    intervalMinutes: overrides?.intervalMinutes ?? readEnvNumber(env, "MINDORY_BACKUP_SCHEDULE_INTERVAL_MINUTES"),
    retentionCount: overrides?.retentionCount ?? readEnvNumber(env, "MINDORY_BACKUP_RETENTION_COUNT"),
    retentionDays: overrides?.retentionDays ?? readEnvNumber(env, "MINDORY_BACKUP_RETENTION_DAYS"),
    includeConfig: overrides?.includeConfig ?? readEnvBoolean(env, "MINDORY_BACKUP_INCLUDE_CONFIG"),
    includePostgres: overrides?.includePostgres ?? readEnvBoolean(env, "MINDORY_BACKUP_INCLUDE_POSTGRES"),
    includeObjects: overrides?.includeObjects ?? readEnvBoolean(env, "MINDORY_BACKUP_INCLUDE_OBJECTS")
  };
  validateScheduledBackupConfig(config);
  return config;
}

function validateScheduledBackupConfig(config: ScheduledBackupConfig): void {
  if (!Number.isInteger(config.intervalMinutes) || config.intervalMinutes <= 0) {
    throw new Error("MINDORY_BACKUP_SCHEDULE_INTERVAL_MINUTES must be a positive integer.");
  }
  if (!Number.isInteger(config.retentionCount) || config.retentionCount <= 0) {
    throw new Error("MINDORY_BACKUP_RETENTION_COUNT must be a positive integer.");
  }
  if (!Number.isInteger(config.retentionDays) || config.retentionDays <= 0) {
    throw new Error("MINDORY_BACKUP_RETENTION_DAYS must be a positive integer.");
  }
}

function readEnvBoolean(env: Record<string, string>, name: string): boolean {
  return (env[name] ?? catalogDefault(name)).toLowerCase() === "true";
}

function readEnvNumber(env: Record<string, string>, name: string): number {
  const value = Number(env[name] ?? catalogDefault(name));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be greater than zero.`);
  }
  return value;
}

function scheduledBackupLockPath(mindoryHome: string): string {
  return path.join(mindoryHome, "backups", "scheduled-backup.lock");
}

function scheduledBackupHealthPath(mindoryHome: string): string {
  return path.join(mindoryHome, "backups", "scheduled-backup-health.json");
}

function scheduledBackupLogPath(mindoryHome: string): string {
  return path.join(mindoryHome, "logs", "scheduled-backup.log");
}

function acquireScheduledBackupLock(lockPath: string, now: Date): true | null {
  let fd: number | null = null;
  try {
    fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeFileSync(fd, `${JSON.stringify({ pid: processPid, started_at: now.toISOString() })}\n`);
    return true;
  } catch (error) {
    if (isFileAlreadyExistsError(error)) {
      return null;
    }
    throw error;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

function releaseScheduledBackupLock(lockPath: string, _lock: true): void {
  rmSync(lockPath, { force: true });
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}

function computeNextScheduledBackupRun(config: ScheduledBackupConfig, previous: ScheduledBackupHealth | null, now: Date): Date {
  if (previous?.last_success_at === null || previous?.last_success_at === undefined) {
    return now;
  }
  return addMinutes(new Date(previous.last_success_at), config.intervalMinutes);
}

function buildScheduledBackupHealth(
  config: ScheduledBackupConfig,
  previous: ScheduledBackupHealth | null,
  now: Date,
  updates: {
    lastStartedAt?: Date;
    lastSuccessAt?: Date;
    lastFailureAt?: Date;
    lastError?: string | null;
    lastBackupPath?: string;
    nextRunAt: Date | null;
  }
): ScheduledBackupHealth {
  return {
    schema_version: INSTALLER_SCHEMA_VERSION,
    kind: "mindory-scheduled-backup-health",
    enabled: config.enabled,
    interval_minutes: config.intervalMinutes,
    retention_count: config.retentionCount,
    retention_days: config.retentionDays,
    last_started_at: updates.lastStartedAt?.toISOString() ?? previous?.last_started_at ?? null,
    last_success_at: updates.lastSuccessAt?.toISOString() ?? previous?.last_success_at ?? null,
    last_failure_at: updates.lastFailureAt?.toISOString() ?? previous?.last_failure_at ?? null,
    last_error: updates.lastError === undefined ? previous?.last_error ?? null : updates.lastError,
    last_backup_path: updates.lastBackupPath ?? previous?.last_backup_path ?? null,
    next_run_at: updates.nextRunAt?.toISOString() ?? null
  };
}

function writeScheduledBackupHealth(healthPath: string, health: ScheduledBackupHealth): void {
  mkdirSync(path.dirname(healthPath), { recursive: true, mode: 0o700 });
  writeFileSync(healthPath, `${JSON.stringify(health, null, 2)}\n`, { mode: 0o600 });
}

function appendScheduledBackupLog(logPath: string, event: ScheduledBackupReport["status"], health: ScheduledBackupHealth, fields: Record<string, unknown> = {}): void {
  mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
  writeFileSync(logPath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    health,
    ...fields
  })}\n`, { flag: "a", mode: 0o600 });
}

function applyScheduledBackupRetention(mindoryHome: string, config: ScheduledBackupConfig, activeBackupPath: string, now: Date): ScheduledBackupRetentionReport {
  const backupsRoot = path.join(mindoryHome, "backups");
  const active = path.resolve(activeBackupPath);
  const cutoff = now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000;
  const entries = listRuntimeBackupDirectories(mindoryHome);
  const newestFirst = [...entries].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const keep = new Set(newestFirst.slice(0, config.retentionCount).map((entry) => entry.path));
  const deleted: string[] = [];
  for (const entry of newestFirst) {
    if (entry.path === active) {
      keep.add(entry.path);
      continue;
    }
    const expiredByCount = !keep.has(entry.path);
    const expiredByAge = entry.createdAt.getTime() < cutoff;
    if (!expiredByCount && !expiredByAge) {
      continue;
    }
    assertPathInside(entry.path, backupsRoot);
    rmSync(entry.path, { recursive: true, force: true });
    deleted.push(entry.path);
  }
  return {
    deleted,
    kept: listRuntimeBackupDirectories(mindoryHome).map((entry) => entry.path)
  };
}

function listRuntimeBackupDirectories(mindoryHome: string): Array<{ path: string; createdAt: Date }> {
  const backupsRoot = path.join(mindoryHome, "backups");
  if (!existsSync(backupsRoot)) {
    return [];
  }
  return readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backupsRoot, entry.name))
    .filter((entryPath) => existsSync(path.join(entryPath, "backup-manifest.json")))
    .map((entryPath) => {
      const manifest = readRuntimeBackupManifest(path.join(entryPath, "backup-manifest.json"));
      return {
        path: path.resolve(entryPath),
        createdAt: new Date(manifest.created_at)
      };
    });
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function assertPathInside(targetPath: string, parentPath: string): void {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to delete path outside ${parentPath}: ${targetPath}`);
  }
}

function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1);
    if (/^[A-Z0-9_]+$/.test(key)) {
      env[key] = unquoteEnvValue(value);
    }
  }
  return env;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function createRuntimePlanFromHome(mindoryHome: string, homeEnv: Record<string, string>): InstallPlan {
  const answers = createDefaultInstallAnswers({
    mindoryHome,
    publicUrl: homeEnv.MINDORY_PUBLIC_URL ?? catalogDefault("MINDORY_PUBLIC_URL"),
    storage: {
      provider: (homeEnv.MINDORY_STORAGE_PROVIDER ?? catalogDefault("MINDORY_STORAGE_PROVIDER")) as StorageProvider,
      localPath: homeEnv.MINDORY_STORAGE_LOCAL_PATH ?? catalogDefault("MINDORY_STORAGE_LOCAL_PATH"),
      s3: {
        endpoint: homeEnv.MINDORY_S3_ENDPOINT ?? catalogDefault("MINDORY_S3_ENDPOINT"),
        region: homeEnv.MINDORY_S3_REGION ?? catalogDefault("MINDORY_S3_REGION"),
        bucket: homeEnv.MINDORY_S3_BUCKET ?? catalogDefault("MINDORY_S3_BUCKET"),
        accessKeyId: homeEnv.MINDORY_S3_ACCESS_KEY_ID ?? catalogDefault("MINDORY_S3_ACCESS_KEY_ID"),
        secretAccessKey: homeEnv.MINDORY_S3_SECRET_ACCESS_KEY ?? catalogDefault("MINDORY_S3_SECRET_ACCESS_KEY"),
        forcePathStyle: (homeEnv.MINDORY_S3_FORCE_PATH_STYLE ?? catalogDefault("MINDORY_S3_FORCE_PATH_STYLE")) === "true"
      }
    },
    vector: {
      provider: (homeEnv.MINDORY_VECTOR_PROVIDER ?? catalogDefault("MINDORY_VECTOR_PROVIDER")) as VectorProvider,
      qdrantUrl: homeEnv.MINDORY_QDRANT_URL ?? catalogDefault("MINDORY_QDRANT_URL"),
      qdrantCollectionPrefix: homeEnv.MINDORY_QDRANT_COLLECTION_PREFIX ?? catalogDefault("MINDORY_QDRANT_COLLECTION_PREFIX")
    },
    docling: {
      enabled: (homeEnv.MINDORY_DOCLING_ENABLED ?? catalogDefault("MINDORY_DOCLING_ENABLED")) === "true",
      url: homeEnv.MINDORY_DOCLING_URL ?? catalogDefault("MINDORY_DOCLING_URL"),
      timeoutMs: Number.parseInt(homeEnv.MINDORY_DOCLING_TIMEOUT_MS ?? catalogDefault("MINDORY_DOCLING_TIMEOUT_MS"), 10),
      port: Number.parseInt(homeEnv.MINDORY_DOCLING_PORT ?? catalogDefault("MINDORY_DOCLING_PORT"), 10)
    },
    antivirus: {
      mode: (homeEnv.MINDORY_AV_MODE ?? catalogDefault("MINDORY_AV_MODE")) as AntivirusMode,
      provider: homeEnv.MINDORY_AV_PROVIDER ?? catalogDefault("MINDORY_AV_PROVIDER"),
      clamavPlatform: homeEnv.MINDORY_CLAMAV_PLATFORM ?? catalogDefault("MINDORY_CLAMAV_PLATFORM")
    }
  });
  const plan = createInstallPlan(answers);
  return {
    ...plan,
    environment: {
      ...plan.environment,
      ...homeEnv,
      MINDORY_HOME: mindoryHome
    }
  };
}

function copyBackupComponent(input: {
  component: RuntimeBackupComponent;
  source: string;
  target: string;
  backupRelativePath: string;
  restoreTargetRelativePath: string;
  dryRun: boolean;
}): RuntimeBackupComponentReport {
  if (!existsSync(input.source)) {
    return {
      component: input.component,
      status: "missing",
      source: input.source,
      target: input.target,
      reason: "Source path does not exist."
    };
  }
  if (input.dryRun) {
    return {
      component: input.component,
      status: "dry_run",
      source: input.source,
      target: input.target,
      backupRelativePath: input.backupRelativePath,
      restoreTargetRelativePath: input.restoreTargetRelativePath
    };
  }
  rmSync(input.target, { recursive: true, force: true });
  mkdirSync(path.dirname(input.target), { recursive: true, mode: 0o700 });
  cpSync(input.source, input.target, { recursive: true });
  return {
    component: input.component,
    status: "backed_up",
    source: input.source,
    target: input.target,
    backupRelativePath: input.backupRelativePath,
    restoreTargetRelativePath: input.restoreTargetRelativePath
  };
}

async function backupPostgresDatabase(
  plan: InstallPlan,
  backupPath: string,
  dryRun: boolean,
  options: RuntimeBackupOptions
): Promise<RuntimeBackupComponentReport> {
  const target = path.join(backupPath, "postgres", "mindory.sql");
  if (dryRun) {
    return {
      component: "postgres",
      status: "dry_run",
      target,
      backupRelativePath: path.join("postgres", "mindory.sql"),
      restoreTargetRelativePath: "postgres"
    };
  }
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const { database, user } = postgresConnectionParts(plan.environment.MINDORY_DATABASE_URL);
  const containerDumpPath = `/tmp/mindory-backup-${timestampLabel()}.sql`;
  await runDockerCompose(plan, [
    "exec",
    "-T",
    "postgres",
    "sh",
    "-lc",
    `pg_dump -U ${shellQuote(user)} -d ${shellQuote(database)} --clean --if-exists --no-owner --no-privileges > ${shellQuote(containerDumpPath)}`
  ], options);
  await runDockerCompose(plan, ["cp", `postgres:${containerDumpPath}`, target], options);
  try {
    await runDockerCompose(plan, ["exec", "-T", "postgres", "rm", "-f", containerDumpPath], options);
  } catch {
    // A failed temp-file cleanup should not invalidate an otherwise complete backup.
  }
  return {
    component: "postgres",
    status: "backed_up",
    source: `postgres:${containerDumpPath}`,
    target,
    backupRelativePath: path.join("postgres", "mindory.sql"),
    restoreTargetRelativePath: "postgres"
  };
}

async function restorePostgresDatabase(
  plan: InstallPlan,
  backupPath: string,
  options: RuntimeRestoreOptions
): Promise<RuntimeBackupComponentReport> {
  const source = path.join(backupPath, "postgres", "mindory.sql");
  if (!existsSync(source)) {
    return {
      component: "postgres",
      status: "missing",
      source,
      reason: "PostgreSQL dump is not present in this backup."
    };
  }
  const containerRestorePath = `/tmp/mindory-restore-${timestampLabel()}.sql`;
  const { database, user } = postgresConnectionParts(plan.environment.MINDORY_DATABASE_URL);
  await runDockerCompose(plan, ["cp", source, `postgres:${containerRestorePath}`], options);
  await runDockerCompose(plan, [
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    user,
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    containerRestorePath
  ], options);
  try {
    await runDockerCompose(plan, ["exec", "-T", "postgres", "rm", "-f", containerRestorePath], options);
  } catch {
    // A failed temp-file cleanup should not invalidate an otherwise complete restore.
  }
  return {
    component: "postgres",
    status: "restored",
    source,
    target: `postgres:${containerRestorePath}`,
    backupRelativePath: path.join("postgres", "mindory.sql"),
    restoreTargetRelativePath: "postgres"
  };
}

function objectStorageBackupSources(
  mindoryHome: string,
  homeEnv: Record<string, string>
): Array<{
  component: RuntimeBackupComponent;
  source: string;
  backupRelativePath: string;
  restoreTargetRelativePath: string;
}> {
  const provider = homeEnv.MINDORY_STORAGE_PROVIDER ?? catalogDefault("MINDORY_STORAGE_PROVIDER");
  if (provider === "local-fs") {
    return [{
      component: "objects",
      source: path.join(mindoryHome, "data", "objects"),
      backupRelativePath: "objects",
      restoreTargetRelativePath: path.join("data", "objects")
    }];
  }
  const endpoint = homeEnv.MINDORY_S3_ENDPOINT ?? catalogDefault("MINDORY_S3_ENDPOINT");
  if (endpoint.includes("librefs")) {
    return [{
      component: "librefs",
      source: path.join(mindoryHome, "data", "librefs"),
      backupRelativePath: "librefs",
      restoreTargetRelativePath: path.join("data", "librefs")
    }];
  }
  if (endpoint.includes("minio")) {
    return [{
      component: "librefs",
      source: path.join(mindoryHome, "data", "minio"),
      backupRelativePath: "minio",
      restoreTargetRelativePath: path.join("data", "minio")
    }];
  }
  return [];
}

function createRuntimeBackupManifest(
  mindoryHome: string,
  homeEnv: Record<string, string>,
  components: RuntimeBackupComponentReport[]
): RuntimeBackupManifest {
  const storageProvider = homeEnv.MINDORY_STORAGE_PROVIDER ?? catalogDefault("MINDORY_STORAGE_PROVIDER");
  const s3Endpoint = homeEnv.MINDORY_S3_ENDPOINT ?? catalogDefault("MINDORY_S3_ENDPOINT");
  const storage: RuntimeBackupManifest["storage"] = { provider: storageProvider };
  if (storageProvider === "s3") {
    storage.s3_endpoint = s3Endpoint;
  }
  return {
    schema_version: INSTALLER_SCHEMA_VERSION,
    kind: "mindory-runtime-backup",
    created_at: new Date().toISOString(),
    mindory_home: mindoryHome,
    storage,
    components
  };
}

function readRuntimeBackupManifest(manifestPath: string): RuntimeBackupManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`Mindory backup manifest not found at ${manifestPath}.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RuntimeBackupManifest;
  if (manifest.kind !== "mindory-runtime-backup" || manifest.schema_version !== INSTALLER_SCHEMA_VERSION) {
    throw new Error(`Unsupported Mindory backup manifest at ${manifestPath}.`);
  }
  return manifest;
}

function readPostgresPitrBackupManifest(manifestPath: string): PostgresPitrBackupManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`Mindory PITR manifest not found at ${manifestPath}.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PostgresPitrBackupManifest;
  if (manifest.kind !== "mindory-postgres-pitr-base" || manifest.schema_version !== INSTALLER_SCHEMA_VERSION) {
    throw new Error(`Unsupported Mindory PITR manifest at ${manifestPath}.`);
  }
  return manifest;
}

function restoreFilesystemComponent(
  manifest: RuntimeBackupManifest,
  backupPath: string,
  mindoryHome: string,
  component: RuntimeBackupComponent
): RuntimeBackupComponentReport {
  const entry = manifest.components.find((candidate) => candidate.component === component && candidate.status === "backed_up");
  if (entry === undefined || entry.backupRelativePath === undefined || entry.restoreTargetRelativePath === undefined) {
    return {
      component,
      status: "skipped",
      reason: "Component was not backed up in this backup."
    };
  }
  const source = path.join(backupPath, entry.backupRelativePath);
  const target = path.join(mindoryHome, entry.restoreTargetRelativePath);
  if (!existsSync(source)) {
    return {
      component,
      status: "missing",
      source,
      target,
      reason: "Backup component path is missing."
    };
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  cpSync(source, target, { recursive: true });
  return {
    component,
    status: "restored",
    source,
    target,
    backupRelativePath: entry.backupRelativePath,
    restoreTargetRelativePath: entry.restoreTargetRelativePath
  };
}

function postgresConnectionParts(databaseUrl: string | undefined): { database: string; user: string } {
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    return { database: "mindory", user: "mindory" };
  }
  try {
    const parsed = new URL(databaseUrl);
    return {
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "") || "mindory"),
      user: decodeURIComponent(parsed.username || "mindory")
    };
  } catch {
    return { database: "mindory", user: "mindory" };
  }
}

function postgresWalArchivePath(mindoryHome: string): string {
  return path.join(mindoryHome, "backups", "postgres-wal");
}

function normalizePitrTargetTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("PITR target time must be a valid ISO timestamp.");
  }
  return date.toISOString();
}

function renderPostgresPitrRestoreScript(targetTime: string): string {
  const recoveryConfig = [
    "restore_command = 'cp /wal-archive/%f %p'",
    `recovery_target_time = '${targetTime.replaceAll("'", "''")}'`,
    "recovery_target_action = 'promote'",
    ""
  ].join("\n");
  return [
    "rm -rf /restore/*",
    "tar -xzf /backup/base.tar.gz -C /restore",
    "if [ -f /backup/pg_wal.tar.gz ]; then mkdir -p /restore/pg_wal && tar -xzf /backup/pg_wal.tar.gz -C /restore/pg_wal; fi",
    `printf %s ${shellQuote(recoveryConfig)} > /restore/postgresql.auto.conf`,
    "touch /restore/recovery.signal",
    "chown -R postgres:postgres /restore"
  ].join(" && ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function sanitizeBackupLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "runtime-backup";
}

function assertSafeMindoryHome(mindoryHome: string): string {
  const resolved = path.resolve(mindoryHome);
  if (resolved === path.parse(resolved).root || resolved.length < 6) {
    throw new Error(`Refusing to operate on unsafe MINDORY_HOME path ${resolved}.`);
  }
  return resolved;
}

function timestampLabel(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
    "vector.provider": "MINDORY_VECTOR_PROVIDER",
    "vector.qdrant_url": "MINDORY_QDRANT_URL",
    "vector.qdrant_collection_prefix": "MINDORY_QDRANT_COLLECTION_PREFIX",
    "docling.enabled": "MINDORY_DOCLING_ENABLED",
    "docling.url": "MINDORY_DOCLING_URL",
    "docling.timeout_ms": "MINDORY_DOCLING_TIMEOUT_MS",
    "docling.port": "MINDORY_DOCLING_PORT",
    "modalities.text": "MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED",
    "modalities.pdf": "MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED",
    "modalities.image": "MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED",
    "modalities.audio": "MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED",
    "modalities.video": "MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED",
    "modalities.video_max_keyframes": "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES",
    "modalities.video_keyframe_provider": "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER",
    "modalities.video_ffmpeg_command": "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND",
    "modalities.video_ffprobe_command": "MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND",
    "interfaces.api_port": "MINDORY_API_PORT",
    "interfaces.mcp_enabled": "MINDORY_MCP_ENABLED",
    "interfaces.hermes_enabled": "MINDORY_HERMES_ADAPTER_ENABLED",
    "tokens.mcp_api_token": "MINDORY_MCP_API_TOKEN",
    "tokens.cli_api_token": "MINDORY_CLI_API_TOKEN",
    "tokens.hermes_api_token": "MINDORY_HERMES_API_TOKEN",
    "llm.local_command.healthcheck_command": "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND",
    "llm.local_command.healthcheck_args": "MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS",
    "llm.local_command.operation_command": "MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND",
    "llm.local_command.operation_args": "MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS"
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
  return llmRoleSupportStatus(role);
}

function roleSupportRequiresExperimental(status: ConfigSupportStatus): boolean {
  return status !== "supported";
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
    vector: { ...defaults.vector, ...overrides.vector },
    docling: { ...defaults.docling, ...overrides.docling },
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

function parseJsonStringArray(value: string, label: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      throw new Error("expected a JSON array of strings");
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} must be a JSON array of strings: ${errorToString(error)}.`);
  }
}

function isSecretEntry(entry: ConfigCatalogEntry): boolean {
  return entry.secret || entry.name.endsWith("_TOKEN") || entry.name.endsWith("_API_KEY") || entry.name.endsWith("_SECRET_ACCESS_KEY");
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
