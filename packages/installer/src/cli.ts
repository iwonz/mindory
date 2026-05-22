#!/usr/bin/env node
import {
  acquireInstallLock,
  buildRedactedInstallSummary,
  createEncryptedMindoryBackupArchive,
  createMindoryPostgresPitrBaseBackup,
  createMindoryRuntimeBackup,
  createDefaultInstallAnswers,
  createReadlineWizardIo,
  downloadEncryptedMindoryBackupArchive,
  executeInstallPlan,
  formatInstallerDiagnostic,
  installJournalPath,
  installLockPath,
  inspectInstallState,
  readScheduledBackupHealth,
  readInstallJournal,
  readInstallLock,
  renderEnvFile,
  renderMindoryConfigJson,
  restoreEncryptedMindoryBackupArchive,
  restoreMindoryPostgresPitrBackup,
  restoreMindoryRuntimeBackup,
  runScheduledMindoryBackup,
  runInstallWizard,
  uninstallMindoryHome,
  uploadEncryptedMindoryBackupArchive,
  updateInstallAssets
} from "./index.js";

const args = process.argv.slice(2);
const command = args[0] ?? "wizard";

try {
  if (command === "wizard") {
    await runWizardCommand();
  } else if (command === "plan" || command === "dry-run") {
    printJson(buildRedactedInstallSummary(createDefaultInstallAnswers()));
  } else if (command === "prepare") {
    await runPrepareCommand();
  } else if (command === "start") {
    await runStartCommand();
  } else if (command === "render-defaults") {
    const answers = createDefaultInstallAnswers();
    printJson({
      config: JSON.parse(renderMindoryConfigJson(answers)),
      env: renderEnvFile(answers)
    });
  } else if (command === "resume") {
    runResumeCommand();
  } else if (command === "repair") {
    runRepairCommand();
  } else if (command === "update") {
    await runUpdateCommand();
  } else if (command === "backup") {
    await runBackupCommand();
  } else if (command === "backup-archive") {
    await runBackupArchiveCommand();
  } else if (command === "backup-upload") {
    await runBackupUploadCommand();
  } else if (command === "backup-download") {
    await runBackupDownloadCommand();
  } else if (command === "backup-restore-archive") {
    await runBackupRestoreArchiveCommand();
  } else if (command === "backup-schedule") {
    await runBackupScheduleCommand();
  } else if (command === "pitr-backup") {
    await runPitrBackupCommand();
  } else if (command === "pitr-restore") {
    await runPitrRestoreCommand();
  } else if (command === "restore") {
    await runRestoreCommand();
  } else if (command === "uninstall") {
    runUninstallCommand();
  } else if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
  } else {
    throw new Error(`Unknown installer command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function runPitrBackupCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const outputDirectory = optionValue("--output");
  const label = optionValue("--label");
  const sourceRoot = optionValue("--source");
  try {
    const report = await createMindoryPostgresPitrBaseBackup(home, {
      dryRun: args.includes("--dry-run"),
      owner: "mindory-installer-cli",
      ...(outputDirectory === undefined ? {} : { outputDirectory }),
      ...(label === undefined ? {} : { label }),
      ...(sourceRoot === undefined ? {} : { sourceRoot })
    });
    printJson({
      status: report.dryRun ? "pitr_backup_dry_run" : "pitr_backed_up",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runPitrRestoreCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const backupPath = optionValue("--backup");
  const targetTime = optionValue("--target-time");
  const restoreDirectory = optionValue("--restore-directory");
  const sourceRoot = optionValue("--source");
  if (backupPath === undefined) {
    throw new Error("pitr-restore requires --backup <path>.");
  }
  if (targetTime === undefined) {
    throw new Error("pitr-restore requires --target-time <iso-timestamp>.");
  }
  try {
    const report = await restoreMindoryPostgresPitrBackup(home, backupPath, {
      yes: args.includes("--yes"),
      targetTime,
      replaceLiveData: args.includes("--replace-live-data"),
      owner: "mindory-installer-cli",
      ...(restoreDirectory === undefined ? {} : { restoreDirectory }),
      ...(sourceRoot === undefined ? {} : { sourceRoot })
    });
    printJson({
      status: report.replacedLiveData ? "pitr_restored_live_data" : "pitr_restore_staged",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runBackupScheduleCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  if (args.includes("--status")) {
    printJson({
      status: "scheduled_backup_status",
      mindoryHome: home,
      health: readScheduledBackupHealth(home)
    });
    return;
  }

  const label = optionValue("--label");
  const sourceRoot = optionValue("--source");
  try {
    const report = await runScheduledMindoryBackup(home, {
      dryRun: args.includes("--dry-run"),
      force: args.includes("--run-now"),
      config: {
        includeConfig: !args.includes("--no-config"),
        includePostgres: !args.includes("--no-postgres"),
        includeObjects: !args.includes("--no-objects")
      },
      owner: "mindory-installer-cli",
      ...(label === undefined ? {} : { label }),
      ...(sourceRoot === undefined ? {} : { sourceRoot })
    });
    printJson({
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runBackupCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const outputDirectory = optionValue("--output");
  const label = optionValue("--label");
  const sourceRoot = optionValue("--source");
  try {
    const report = await createMindoryRuntimeBackup(home, {
      dryRun: args.includes("--dry-run"),
      includeConfig: !args.includes("--no-config"),
      includePostgres: !args.includes("--no-postgres"),
      includeObjects: !args.includes("--no-objects"),
      owner: "mindory-installer-cli",
      ...(outputDirectory === undefined ? {} : { outputDirectory }),
      ...(label === undefined ? {} : { label }),
      ...(sourceRoot === undefined ? {} : { sourceRoot })
    });
    printJson({
      status: report.dryRun ? "backup_dry_run" : "backed_up",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runBackupArchiveCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const backupPath = optionValue("--backup");
  const outputFile = optionValue("--output");
  const encryptionKey = optionValue("--key");
  const keyId = optionValue("--key-id");
  if (backupPath === undefined) {
    throw new Error("backup-archive requires --backup <path>.");
  }
  try {
    const report = await createEncryptedMindoryBackupArchive(home, backupPath, {
      ...(outputFile === undefined ? {} : { outputFile }),
      ...(encryptionKey === undefined ? {} : { encryptionKey }),
      ...(keyId === undefined ? {} : { keyId })
    });
    printJson({
      status: "encrypted_backup_archive_created",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runBackupRestoreArchiveCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const archivePath = optionValue("--archive");
  const outputDirectory = optionValue("--output");
  const encryptionKey = optionValue("--key");
  if (archivePath === undefined) {
    throw new Error("backup-restore-archive requires --archive <path>.");
  }
  try {
    const report = await restoreEncryptedMindoryBackupArchive(home, archivePath, {
      yes: args.includes("--yes"),
      ...(outputDirectory === undefined ? {} : { outputDirectory }),
      ...(encryptionKey === undefined ? {} : { encryptionKey })
    });
    printJson({
      status: "encrypted_backup_archive_restored",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runBackupUploadCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const archivePath = optionValue("--archive");
  const objectKey = optionValue("--object-key");
  if (archivePath === undefined) {
    throw new Error("backup-upload requires --archive <path>.");
  }
  try {
    const report = await uploadEncryptedMindoryBackupArchive(home, archivePath, {
      ...(objectKey === undefined ? {} : { objectKey })
    });
    printJson({
      status: "encrypted_backup_uploaded",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runBackupDownloadCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const objectKey = optionValue("--object-key");
  const outputFile = optionValue("--output");
  if (objectKey === undefined) {
    throw new Error("backup-download requires --object-key <key>.");
  }
  try {
    const report = await downloadEncryptedMindoryBackupArchive(home, {
      objectKey,
      ...(outputFile === undefined ? {} : { outputFile })
    });
    printJson({
      status: "encrypted_backup_downloaded",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runRestoreCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const backupPath = optionValue("--backup");
  const sourceRoot = optionValue("--source");
  if (backupPath === undefined) {
    throw new Error("restore requires --backup <path>.");
  }
  try {
    const report = await restoreMindoryRuntimeBackup(home, backupPath, {
      yes: args.includes("--yes"),
      restoreConfig: !args.includes("--no-config"),
      restorePostgres: !args.includes("--no-postgres"),
      restoreObjects: !args.includes("--no-objects"),
      owner: "mindory-installer-cli",
      ...(sourceRoot === undefined ? {} : { sourceRoot })
    });
    printJson({
      status: "restored",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runUpdateCommand(): Promise<void> {
  const answers = createDefaultInstallAnswers({
    mindoryHome: optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome
  });
  const sourceRoot = optionValue("--source");
  const dryRun = args.includes("--dry-run");
  try {
    const report = await updateInstallAssets(answers, {
      dryRun,
      owner: "mindory-installer-cli",
      ...(sourceRoot === undefined ? {} : { sourceRoot })
    });
    printJson({
      status: dryRun ? "update_dry_run" : "updated",
      mindoryHome: answers.mindoryHome,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

function runUninstallCommand(): void {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  try {
    const report = uninstallMindoryHome(home, {
      yes: args.includes("--yes"),
      backup: args.includes("--backup")
    });
    printJson({
      status: "uninstalled",
      mindoryHome: home,
      ...report
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runPrepareCommand(): Promise<void> {
  const answers = createDefaultInstallAnswers({
    mindoryHome: optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome
  });
  const sourceRoot = optionValue("--source");
  try {
    const report = await executeInstallPlan(answers, {
      owner: "mindory-installer-cli",
      ...(sourceRoot === undefined ? {} : { sourceRoot })
    });
    printJson({
      status: "prepared",
      mindoryHome: report.plan.mindoryHome,
      summary: report.summary,
      journalPath: report.journalPath,
      executedStepIds: report.executedStepIds,
      pendingStepIds: report.pendingStepIds
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runStartCommand(): Promise<void> {
  const answers = createDefaultInstallAnswers({
    mindoryHome: optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome
  });
  const sourceRoot = optionValue("--source");
  const timeoutMs = optionValue("--timeout-ms");
  const parsedTimeoutMs = timeoutMs === undefined ? undefined : Number.parseInt(timeoutMs, 10);
  if (parsedTimeoutMs !== undefined && (!Number.isFinite(parsedTimeoutMs) || parsedTimeoutMs <= 0)) {
    throw new Error("--timeout-ms must be greater than zero.");
  }
  try {
    const report = await executeInstallPlan(answers, {
      owner: "mindory-installer-cli",
      stopBeforeStepId: null,
      ...(sourceRoot === undefined ? {} : { sourceRoot }),
      ...(parsedTimeoutMs === undefined ? {} : { timeoutMs: parsedTimeoutMs })
    });
    printJson({
      status: "provisioned",
      mindoryHome: report.plan.mindoryHome,
      summary: report.summary,
      journalPath: report.journalPath,
      initialTokenPath: `${report.plan.mindoryHome}/config/initial-token.json`,
      executedStepIds: report.executedStepIds,
      pendingStepIds: report.pendingStepIds
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  }
}

async function runWizardCommand(): Promise<void> {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const lock = acquireInstallLock(home, "mindory-installer-cli");
  const io = createReadlineWizardIo();
  const cleanup = installSignalHandlers(() => {
    lock.release();
    io.close();
  });
  try {
    const answers = await runInstallWizard(io);
    printJson({
      answers: JSON.parse(renderMindoryConfigJson(answers)),
      summary: buildRedactedInstallSummary(answers)
    });
  } catch (error) {
    printJson({ diagnostic: formatInstallerDiagnostic(error) });
    process.exitCode = 1;
  } finally {
    cleanup();
    lock.release();
    io.close();
  }
}

function runResumeCommand(): void {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const journal = readInstallJournal(home);
  const inspection = inspectInstallState(home);
  printJson({
    status: journal === null ? "no_journal" : "journal_found",
    message: inspection.recommendedAction,
    journalPath: installJournalPath(home),
    entries: journal ?? [],
    inspection
  });
}

function runRepairCommand(): void {
  const home = optionValue("--home") ?? createDefaultInstallAnswers().mindoryHome;
  const lock = readInstallLock(home);
  const journal = readInstallJournal(home);
  const inspection = inspectInstallState(home);
  printJson({
    status: "repair_inspection",
    message: inspection.recommendedAction,
    lockPath: installLockPath(home),
    lock,
    journalPath: installJournalPath(home),
    journalEntries: journal?.length ?? 0,
    inspection
  });
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`Mindory installer

Usage:
  mindory-installer wizard
  mindory-installer plan
  mindory-installer prepare [--home <path>] [--source <path>]
  mindory-installer start [--home <path>] [--source <path>] [--timeout-ms <n>]
  mindory-installer render-defaults
  mindory-installer resume [--home <path>]
  mindory-installer repair [--home <path>]
  mindory-installer update [--home <path>] [--source <path>] [--dry-run]
  mindory-installer backup [--home <path>] [--output <path>] [--label <name>] [--dry-run] [--no-postgres] [--no-objects]
  mindory-installer backup-archive --home <path> --backup <path> [--output <path>] [--key <secret>] [--key-id <id>]
  mindory-installer backup-upload --home <path> --archive <path> [--object-key <key>]
  mindory-installer backup-download --home <path> --object-key <key> [--output <path>]
  mindory-installer backup-restore-archive --home <path> --archive <path> --yes [--key <secret>] [--output <path>]
  mindory-installer backup-schedule [--home <path>] [--status] [--run-now] [--label <name>] [--dry-run] [--no-postgres] [--no-objects]
  mindory-installer pitr-backup [--home <path>] [--output <path>] [--label <name>] [--dry-run]
  mindory-installer pitr-restore --home <path> --backup <path> --target-time <iso> --yes [--restore-directory <path>] [--replace-live-data]
  mindory-installer restore --home <path> --backup <path> --yes [--no-postgres] [--no-objects] [--no-config]
  mindory-installer uninstall --home <path> --yes [--backup]

The prepare command writes the local MINDORY_HOME directory tree, generated
config and release Compose assets. The start command additionally runs Docker
Compose startup, health checks and first project/token provisioning. Full resume
execution is added by a later installer task.
`);
}

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function installSignalHandlers(cleanup: () => void): () => void {
  const onSignal = (signal: NodeJS.Signals): void => {
    cleanup();
    console.error(`Mindory installer interrupted by ${signal}. Rollback/resume inspection is available through the repair command.`);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
}
