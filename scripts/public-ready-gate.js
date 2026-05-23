import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = truthy(process.env.MINDORY_PUBLIC_READY_LIVE);
const timeoutMs = readPositiveInteger(process.env.MINDORY_PUBLIC_READY_TIMEOUT_MS ?? "900000", "MINDORY_PUBLIC_READY_TIMEOUT_MS");

const scenario = [
  "fresh clone from source URL",
  "clean temporary MINDORY_HOME install",
  "published pre-release bootstrap verification",
  "local-model profile acceptance",
  "full Web UI Playwright flow",
  "CLI and MCP smoke through self-host acceptance",
  "public stale wording validation",
  "clean git status before announcement"
];

if (live) {
  await runLiveGate();
} else {
  runDryRunGate();
}

function runDryRunGate() {
  for (const required of [
    "fresh clone",
    "MINDORY_HOME",
    "published pre-release",
    "local-model",
    "Web UI",
    "CLI",
    "MCP",
    "stale wording",
    "git status"
  ]) {
    assert(scenario.some((step) => step.includes(required)), `Public-ready scenario must include ${required}.`);
  }

  const packageJson = readJson("package.json");
  const checkRepo = read("scripts/check-repo.js");
  const releaseChecklist = read("docs/RELEASE_CHECKLIST.md");
  const acceptanceDocs = read("docs/MVP_ACCEPTANCE.md");
  const repositoryStatus = read("docs/REPOSITORY_STATUS.md");
  const deploymentDocs = read("docs/DEPLOYMENT.md");

  assert(packageJson.scripts?.["public-ready:gate"] === "node scripts/public-ready-gate.js", "Root package must expose public-ready:gate.");
  assert(checkRepo.includes("public-ready:gate"), "pnpm check must include public-ready:gate dry-run.");
  for (const scriptName of [
    "published-release:acceptance",
    "selfhost:gate",
    "local-model:acceptance",
    "ui:e2e",
    "public-debt:validate"
  ]) {
    assert(packageJson.scripts?.[scriptName], `Root package must expose ${scriptName}.`);
  }

  for (const token of [
    "MINDORY_PUBLIC_READY_LIVE=true pnpm public-ready:gate",
    "fresh clone",
    "published-release:acceptance",
    "selfhost:gate",
    "local-model:acceptance",
    "ui:e2e",
    "git status --short"
  ]) {
    assert(`${releaseChecklist}\n${acceptanceDocs}\n${repositoryStatus}\n${deploymentDocs}`.includes(token), `Public-ready docs must include ${token}.`);
  }

  console.log("Public-ready final gate dry-run passed. Set MINDORY_PUBLIC_READY_LIVE=true to run the live pre-release gate.");
}

async function runLiveGate() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-public-ready-"));
  const clonePath = path.join(tempRoot, "fresh-clone");
  const uiHome = path.join(tempRoot, "ui-home");
  const sourceUrl = process.env.MINDORY_PUBLIC_READY_SOURCE_URL ?? root;
  let uiStackStarted = false;

  try {
    run("git", ["clone", "--depth", "1", sourceUrl, clonePath], { cwd: tempRoot }, "fresh clone");
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: clonePath }, "fresh clone dependency install");
    run("pnpm", ["check"], { cwd: clonePath }, "fresh clone repository check");

    run("pnpm", ["published-release:acceptance"], {
      cwd: clonePath,
      env: {
        ...process.env,
        MINDORY_PUBLISHED_RELEASE_ACCEPTANCE_LIVE: "true"
      }
    }, "published pre-release bootstrap acceptance");

    run("pnpm", ["selfhost:gate"], {
      cwd: clonePath,
      env: {
        ...process.env,
        MINDORY_SELFHOST_ACCEPTANCE_TIMEOUT_MS: String(timeoutMs)
      }
    }, "public self-host live gate");

    run("pnpm", ["local-model:acceptance"], {
      cwd: clonePath,
      env: {
        ...process.env,
        MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE: "true"
      }
    }, "local model live acceptance");

    run("pnpm", ["mvp:up", "--model-profile", "local", "--timeout-ms", String(timeoutMs)], {
      cwd: clonePath,
      env: {
        ...process.env,
        MINDORY_HOME: uiHome,
        MINDORY_E2E_MODEL_PROFILE: "local"
      }
    }, "Web UI live stack startup");
    uiStackStarted = true;

    run("pnpm", ["ui:e2e"], {
      cwd: clonePath,
      env: {
        ...process.env,
        MINDORY_HOME: uiHome,
        MINDORY_UI_E2E_LIVE: "true",
        MINDORY_UI_E2E_URL: process.env.MINDORY_UI_E2E_URL ?? "http://localhost:3080",
        MINDORY_E2E_API_URL: process.env.MINDORY_E2E_API_URL ?? "http://localhost:3000",
        MINDORY_DEMO_PROJECT_ID: process.env.MINDORY_DEMO_PROJECT_ID ?? "mindory-demo",
        MINDORY_DEMO_TOKEN: process.env.MINDORY_DEMO_TOKEN ?? "mindory-demo-token"
      }
    }, "Web UI live Playwright acceptance");

    run("pnpm", ["mvp:reset"], {
      cwd: clonePath,
      env: {
        ...process.env,
        MINDORY_HOME: uiHome
      }
    }, "Web UI live stack reset");
    uiStackStarted = false;

    run("pnpm", ["public-debt:validate"], { cwd: clonePath }, "public wording validation");
    const status = runCapture("git", ["status", "--short"], { cwd: clonePath }, "fresh clone git status");
    assert(status.trim().length === 0, `Fresh clone must be clean after final gate, got:\n${status}`);

    console.log(JSON.stringify({
      status: "public_ready_gate_passed",
      clonePath,
      sourceUrl
    }, null, 2));
  } finally {
    if (uiStackStarted) {
      run("pnpm", ["mvp:reset"], {
        cwd: clonePath,
        env: {
          ...process.env,
          MINDORY_HOME: uiHome
        },
        allowFailure: true
      }, "Web UI live stack cleanup");
    }
    removeIfSafeTempPath(tempRoot);
  }
}

function run(command, args, options, label) {
  const allowFailure = options.allowFailure === true;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: "inherit"
  });
  if ((result.status ?? 1) !== 0 && !allowFailure) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}.`);
  }
  return result;
}

function runCapture(command, args, options, label) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${label} failed.\n${result.stderr || result.stdout || "No output."}`);
  }
  return result.stdout;
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function readPositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function removeIfSafeTempPath(target) {
  const resolved = path.resolve(target);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove non-temporary path ${resolved}.`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function truthy(value) {
  return /^(1|true|yes)$/iu.test(value ?? "");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
