#!/usr/bin/env node
import {
  acquireInstallLock,
  buildRedactedInstallSummary,
  createDefaultInstallAnswers,
  createReadlineWizardIo,
  executeInstallPlan,
  formatInstallerDiagnostic,
  installJournalPath,
  installLockPath,
  inspectInstallState,
  readInstallJournal,
  readInstallLock,
  renderEnvFile,
  renderMindoryConfigJson,
  runInstallWizard,
  uninstallMindoryHome,
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
