#!/usr/bin/env node
import {
  buildRedactedInstallSummary,
  createDefaultInstallAnswers,
  createReadlineWizardIo,
  renderEnvFile,
  renderMindoryConfigJson,
  runInstallWizard
} from "./index.js";

const args = process.argv.slice(2);
const command = args[0] ?? "wizard";

try {
  if (command === "wizard") {
    await runWizardCommand();
  } else if (command === "plan" || command === "dry-run") {
    printJson(buildRedactedInstallSummary(createDefaultInstallAnswers()));
  } else if (command === "render-defaults") {
    const answers = createDefaultInstallAnswers();
    printJson({
      config: JSON.parse(renderMindoryConfigJson(answers)),
      env: renderEnvFile(answers)
    });
  } else if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
  } else {
    throw new Error(`Unknown installer command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function runWizardCommand(): Promise<void> {
  const io = createReadlineWizardIo();
  try {
    const answers = await runInstallWizard(io);
    printJson({
      answers: JSON.parse(renderMindoryConfigJson(answers)),
      summary: buildRedactedInstallSummary(answers)
    });
  } finally {
    io.close();
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`Mindory installer

Usage:
  mindory-installer wizard
  mindory-installer plan
  mindory-installer render-defaults

The installer CLI currently collects and validates answers. Execution, recovery
and resume commands are added by later installer tasks.
`);
}
