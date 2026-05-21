import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const command = args[0]?.startsWith("-") ? "up" : args.shift() ?? "up";
const options = parseOptions(args);

const profiles = options.profiles.length > 0 ? options.profiles : ["clamav"];
const apiUrl = (process.env.MINDORY_E2E_API_URL ?? `http://localhost:${process.env.MINDORY_API_PORT ?? "3000"}`).replace(/\/$/, "");
const projectId = process.env.MINDORY_DEMO_PROJECT_ID ?? "mindory-demo";
const demoToken = process.env.MINDORY_DEMO_TOKEN ?? "mindory-demo-token";
const demoTokenId = process.env.MINDORY_DEMO_TOKEN_ID ?? "tok_mindory_demo";
const dockerBinary = resolveDockerBinary();

try {
  if (command === "up") {
    await runUp();
  } else if (command === "down") {
    runDown(false);
  } else if (command === "reset") {
    runDown(true);
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    throw new Error(`Unknown mvp demo command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function runUp() {
  ensureDockerCompose();

  if (options.runAcceptance) {
    runPnpm(["typecheck"]);
  }

  const upArgs = ["compose", ...profileArgs(), "up", "-d"];
  if (options.build) {
    upArgs.push("--build");
  }
  runDocker(upArgs);

  await waitForComposeServices(options.timeoutMs);
  await waitForApiReady(apiUrl, options.timeoutMs);
  seedDemo();

  if (options.runAcceptance) {
    runLiveAcceptance();
  }

  console.log("");
  console.log("Mindory MVP demo is ready.");
  console.log(`API URL: ${apiUrl}`);
  console.log(`Project: ${projectId}`);
  console.log(`Token: ${demoToken}`);
  console.log("Useful commands:");
  console.log("  pnpm mvp:down");
  console.log("  pnpm mvp:reset");
}

function runDown(resetVolumes) {
  ensureDockerCompose();
  const downArgs = ["compose", ...profileArgs(), "down", "--remove-orphans"];
  if (resetVolumes) {
    downArgs.push("--volumes");
  }
  runDocker(downArgs);
  console.log(resetVolumes ? "Mindory MVP demo stack and volumes removed." : "Mindory MVP demo stack stopped.");
}

function seedDemo() {
  runDocker([
    "compose",
    ...profileArgs(),
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "-e",
    `MINDORY_DEMO_PROJECT_ID=${projectId}`,
    "-e",
    `MINDORY_DEMO_TOKEN=${demoToken}`,
    "-e",
    `MINDORY_DEMO_TOKEN_ID=${demoTokenId}`,
    "-e",
    `MINDORY_E2E_API_URL=${apiUrl}`,
    "api",
    "node",
    "scripts/seed-demo.js"
  ]);
}

function runLiveAcceptance() {
  run(process.execPath, ["scripts/mvp-acceptance.js"], {
    env: {
      ...process.env,
      MINDORY_E2E_LIVE: "true",
      MINDORY_E2E_API_URL: apiUrl,
      MINDORY_DEMO_PROJECT_ID: projectId,
      MINDORY_DEMO_TOKEN: demoToken,
      MINDORY_E2E_REQUIRE_INDEXED: options.requireIndexed ? "true" : process.env.MINDORY_E2E_REQUIRE_INDEXED ?? "false"
    }
  });
}

async function waitForComposeServices(timeoutMs) {
  const required = ["postgres", "redis", "api", "worker", "mcp"];
  const completed = ["migrate"];
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const records = composePs();
    const missing = required.filter((service) => !findService(records, service));
    const notReady = required.filter((service) => {
      const record = findService(records, service);
      return record !== undefined && !isRunningAndHealthy(record);
    });
    const notCompleted = completed.filter((service) => {
      const record = findService(records, service);
      return record === undefined || !isCompletedSuccessfully(record);
    });
    const failed = records.find((record) => isFailed(record));

    if (failed !== undefined) {
      throw new Error(`Docker Compose service ${serviceName(failed)} failed. Run "docker compose logs ${serviceName(failed)}" for details.`);
    }

    if (missing.length === 0 && notReady.length === 0 && notCompleted.length === 0) {
      return;
    }

    lastStatus = JSON.stringify({ missing, notReady, notCompleted });
    await sleep(2000);
  }

  throw new Error(`Timed out waiting for Docker Compose services: ${lastStatus}`);
}

async function waitForApiReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "API did not respond yet.";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/ready`, { headers: { accept: "application/json" } });
      if (response.ok) {
        return;
      }
      lastError = `GET /ready returned ${response.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(2000);
  }

  throw new Error(`Timed out waiting for API readiness at ${baseUrl}/ready: ${lastError}`);
}

function composePs() {
  const result = spawnSync(dockerBinary, ["compose", ...profileArgs(), "ps", "--all", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    env: dockerEnv()
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`docker compose ps failed: ${result.stderr || result.stdout}`);
  }
  return parseComposeJson(result.stdout);
}

function parseComposeJson(output) {
  const trimmed = output.trim();
  if (trimmed === "") {
    return [];
  }
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function findService(records, service) {
  return records.find((record) => serviceName(record) === service);
}

function serviceName(record) {
  if (typeof record.Service === "string" && record.Service !== "") {
    return record.Service;
  }
  if (typeof record.Name === "string") {
    const match = record.Name.match(/^mindory-([^-]+)-\d+$/);
    return match?.[1] ?? record.Name;
  }
  return "unknown";
}

function isRunningAndHealthy(record) {
  const state = statusText(record);
  const health = String(record.Health ?? "").toLowerCase();
  if (!state.includes("running")) {
    return false;
  }
  return health === "" || health === "healthy" || state.includes("healthy");
}

function isCompletedSuccessfully(record) {
  const state = statusText(record);
  const exitCode = String(record.ExitCode ?? "");
  if (exitCode !== "") {
    return (state.includes("exited") || state.includes("completed")) && exitCode === "0";
  }
  return state.includes("completed") || state.includes("exited (0)") || state.includes("exited(0)");
}

function isFailed(record) {
  const state = statusText(record);
  const exitCode = String(record.ExitCode ?? "");
  if (state.includes("unhealthy")) {
    return true;
  }
  if ((state.includes("exited") || state.includes("dead")) && exitCode !== "" && exitCode !== "0") {
    return true;
  }
  return /exited\s*\(([1-9]\d*)\)/.test(state);
}

function statusText(record) {
  return `${record.State ?? ""} ${record.Status ?? ""} ${record.Health ?? ""}`.toLowerCase();
}

function ensureDockerCompose() {
  const result = spawnSync(dockerBinary, ["compose", "version"], {
    cwd: root,
    encoding: "utf8",
    env: dockerEnv()
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Docker Compose is unavailable. Start Docker Desktop and confirm \`${dockerBinary} compose version\` works.`);
  }
}

function resolveDockerBinary() {
  if (process.env.MINDORY_TEST_DOCKER_BIN) {
    return process.env.MINDORY_TEST_DOCKER_BIN;
  }
  for (const candidate of [
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
    "docker"
  ]) {
    if (candidate === "docker" || existsSync(candidate)) {
      return candidate;
    }
  }
  return "docker";
}

function dockerEnv() {
  return {
    ...process.env,
    PATH: [
      "/Applications/Docker.app/Contents/Resources/bin",
      "/usr/local/bin",
      "/opt/homebrew/bin",
      process.env.PATH ?? ""
    ].join(":")
  };
}

function runDocker(commandArgs) {
  run(dockerBinary, commandArgs, { env: dockerEnv() });
}

function runPnpm(pnpmArgs) {
  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, ...pnpmArgs]);
    return;
  }
  run("pnpm", pnpmArgs);
}

function run(commandName, commandArgs, optionsOverride = {}) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...optionsOverride
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${commandName} ${commandArgs.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

function profileArgs() {
  return profiles.flatMap((profile) => ["--profile", profile]);
}

function parseOptions(rawArgs) {
  const parsed = {
    build: true,
    profiles: [],
    requireIndexed: false,
    runAcceptance: false,
    timeoutMs: 240_000
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--acceptance") {
      parsed.runAcceptance = true;
    } else if (arg === "--require-indexed") {
      parsed.requireIndexed = true;
      parsed.runAcceptance = true;
    } else if (arg === "--no-build") {
      parsed.build = false;
    } else if (arg === "--profile") {
      const value = rawArgs[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--profile requires a profile name.");
      }
      parsed.profiles.push(value);
      index += 1;
    } else if (arg === "--timeout-ms") {
      const value = rawArgs[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--timeout-ms requires a number.");
      }
      parsed.timeoutMs = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
        throw new Error("--timeout-ms must be greater than zero.");
      }
      index += 1;
    } else {
      throw new Error(`Unknown mvp demo option: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Mindory MVP demo workflow

Usage:
  pnpm mvp:up
  pnpm mvp:demo
  pnpm mvp:down
  pnpm mvp:reset

Options for scripts/mvp-demo.js up:
  --acceptance       Run live MVP acceptance after seeding.
  --require-indexed  Require indexed pgvector document status in acceptance.
  --no-build         Skip Docker image rebuild.
  --profile <name>   Add a Compose profile. Defaults to clamav.
  --timeout-ms <n>   Readiness timeout. Defaults to 240000.
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
