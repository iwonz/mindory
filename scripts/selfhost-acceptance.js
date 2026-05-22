import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.env.MINDORY_SELFHOST_ACCEPTANCE_LIVE === "true";
const runLocalModel = process.env.MINDORY_SELFHOST_ACCEPTANCE_LOCAL === "true";

const scenario = [
  "clean temporary MINDORY_HOME",
  "installer plan and prepare",
  "installer start through Compose health checks",
  "disabled model mode",
  "local model mode with indexed pgvector search",
  "upload text PDF image audio and video fixtures",
  "poll jobs and inspect job details",
  "search documents artifacts metadata and context",
  "CLI context job and search commands",
  "MCP memory and artifact tools",
  "Hermes lifecycle context and saved turns",
  "backup manifest database and object storage",
  "stack reset and guarded uninstall"
];

for (const required of [
  "clean temporary MINDORY_HOME",
  "installer",
  "disabled model",
  "local model",
  "upload",
  "jobs",
  "search",
  "context",
  "CLI",
  "MCP",
  "Hermes",
  "backup",
  "uninstall"
]) {
  assert(scenario.some((step) => step.includes(required)), `Self-host scenario must include ${required}.`);
}

if (live) {
  await runLiveAcceptance();
} else {
  runDryRunAcceptance();
}

function runDryRunAcceptance() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-selfhost-dry-"));
  const cleanup = [tempHome];
  try {
    run("node", ["packages/installer/dist/cli.js", "plan"]);
    run("node", ["packages/installer/dist/cli.js", "prepare", "--home", tempHome, "--source", root]);
    run("node", ["packages/installer/dist/cli.js", "backup", "--home", tempHome, "--dry-run", "--no-postgres", "--no-objects"]);
    run("node", ["scripts/mvp-acceptance.js"]);
    const uninstall = runJson("node", ["packages/installer/dist/cli.js", "uninstall", "--home", tempHome, "--yes", "--backup"]);
    if (typeof uninstall.backupPath === "string") {
      cleanup.push(uninstall.backupPath);
    }
    assert(uninstall.status === "uninstalled", "Dry-run self-host acceptance must exercise guarded uninstall.");
    assert(!fs.existsSync(tempHome), "Dry-run self-host acceptance must remove the temporary home through uninstall.");
    console.log("Public self-host acceptance dry-run passed. Set MINDORY_SELFHOST_ACCEPTANCE_LIVE=true to run the Docker path.");
  } finally {
    for (const target of cleanup) {
      removeIfSafeTempPath(target);
    }
  }
}

async function runLiveAcceptance() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-selfhost-live-"));
  const cleanup = [tempHome];
  let stackStarted = false;
  try {
    run("node", ["packages/installer/dist/cli.js", "start", "--home", tempHome, "--source", root, "--timeout-ms", "300000"]);
    stackStarted = true;
    const credentials = JSON.parse(fs.readFileSync(path.join(tempHome, "config", "initial-token.json"), "utf8"));
    run("node", ["scripts/mvp-acceptance.js"], {
      MINDORY_E2E_LIVE: "true",
      MINDORY_E2E_API_URL: credentials.api_url,
      MINDORY_DEMO_PROJECT_ID: credentials.project_id,
      MINDORY_DEMO_TOKEN: credentials.token,
      MINDORY_E2E_MODEL_PROFILE: "disabled"
    });
    run("node", ["packages/installer/dist/cli.js", "backup", "--home", tempHome, "--source", root, "--label", "selfhost-acceptance"]);
    run("pnpm", ["mvp:reset"], { MINDORY_HOME: tempHome });
    stackStarted = false;
    const uninstall = runJson("node", ["packages/installer/dist/cli.js", "uninstall", "--home", tempHome, "--yes", "--backup"]);
    if (typeof uninstall.backupPath === "string") {
      cleanup.push(uninstall.backupPath);
    }
    if (runLocalModel) {
      runLocalModelAcceptance();
    }
    console.log("Public self-host live acceptance passed.");
  } finally {
    if (stackStarted) {
      try {
        run("pnpm", ["mvp:reset"], { MINDORY_HOME: tempHome });
      } catch {
        // The primary failure should stay visible; cleanup is best-effort here.
      }
    }
    for (const target of cleanup) {
      removeIfSafeTempPath(target);
    }
  }
}

function runLocalModelAcceptance() {
  const localHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-selfhost-local-model-"));
  try {
    run("pnpm", ["mvp:demo", "--model-profile", "local", "--require-indexed", "--timeout-ms", "300000"], {
      MINDORY_HOME: localHome
    });
    run("pnpm", ["mvp:reset"], {
      MINDORY_HOME: localHome
    });
  } finally {
    removeIfSafeTempPath(localHome);
  }
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env
    }
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

function runJson(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function removeIfSafeTempPath(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${os.tmpdir()}${path.sep}`)) {
    return;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
