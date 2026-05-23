import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.env.MINDORY_SELFHOST_ACCEPTANCE_LIVE === "true";
const runLocalModel = process.env.MINDORY_SELFHOST_ACCEPTANCE_LOCAL === "true";
const liveTimeoutMs = parsePositiveInteger(process.env.MINDORY_SELFHOST_ACCEPTANCE_TIMEOUT_MS ?? "300000", "MINDORY_SELFHOST_ACCEPTANCE_TIMEOUT_MS");

const scenario = [
  "clean temporary MINDORY_HOME",
  "installer plan and prepare",
  "installer start through Compose health checks",
  "sync antivirus scan mode",
  "pgvector profile",
  "Qdrant profile",
  "Docling extraction profile",
  "disabled model mode",
  "local model mode with indexed pgvector search",
  "upload text PDF image audio and video fixtures",
  "poll jobs and inspect job details",
  "search documents artifacts metadata and context",
  "CLI context job and search commands",
  "MCP memory and artifact tools",
  "Hermes lifecycle context and saved turns",
  "backup manifest database and object storage",
  "signed remote update",
  "stack reset and guarded uninstall"
];

for (const required of [
  "clean temporary MINDORY_HOME",
  "installer",
  "sync antivirus",
  "pgvector",
  "Qdrant",
  "Docling",
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
  "remote update",
  "uninstall"
]) {
  assert(scenario.some((step) => step.includes(required)), `Self-host scenario must include ${required}.`);
}

if (live) {
  await runLiveAcceptance();
} else {
  await runDryRunAcceptance();
}

async function runDryRunAcceptance() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-selfhost-dry-"));
  const cleanup = [tempHome];
  try {
    const installer = await loadInstaller();
    assertProfileCoverage(installer, tempHome);
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
  const installer = await loadInstaller();
  await runLiveProfileAcceptance(installer, {
    label: "sync-pgvector-docling",
    vectorProvider: "pgvector",
    docling: true,
    modelProfile: "disabled",
    requireIndexed: false,
    remoteUpdate: true
  });
  await runLiveProfileAcceptance(installer, {
    label: "sync-qdrant-local-model",
    vectorProvider: "qdrant",
    docling: false,
    modelProfile: "local",
    requireIndexed: true,
    remoteUpdate: false
  });
  if (runLocalModel) {
    runLocalModelAcceptance();
  }
  console.log("Public self-host live acceptance passed.");
}

async function runLiveProfileAcceptance(installer, profile) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `mindory-selfhost-${profile.label}-`));
  const cleanup = [tempHome];
  let stackStarted = false;
  try {
    const answers = await createLiveProfileAnswers(installer, tempHome, profile);
    const expectedProfiles = expectedComposeProfiles(profile);
    const actualProfiles = installer.composeProfilesForAnswers(answers);
    for (const expectedProfile of expectedProfiles) {
      assert(actualProfiles.includes(expectedProfile), `${profile.label} must enable Compose profile ${expectedProfile}.`);
    }

    console.log(`[selfhost] starting ${profile.label} in ${tempHome}`);
    const report = await installer.executeInstallPlan(answers, {
      sourceRoot: root,
      stopBeforeStepId: null,
      timeoutMs: liveTimeoutMs,
      dockerBinary: resolveDockerBinary(),
      owner: `mindory-selfhost-${profile.label}`
    });
    stackStarted = true;
    assert(report.pendingStepIds.length === 0, `${profile.label} install must finish without pending steps.`);

    const credentials = readInitialCredentials(tempHome);
    await assertApiReady(credentials.api_url, liveTimeoutMs);
    run("node", ["scripts/mvp-acceptance.js"], {
      MINDORY_E2E_LIVE: "true",
      MINDORY_E2E_API_URL: credentials.api_url,
      MINDORY_DEMO_PROJECT_ID: credentials.project_id,
      MINDORY_DEMO_TOKEN: credentials.token,
      MINDORY_E2E_REQUIRE_INDEXED: profile.requireIndexed ? "true" : "false",
      MINDORY_E2E_MODEL_PROFILE: profile.modelProfile
    });

    run("node", ["packages/installer/dist/cli.js", "backup", "--home", tempHome, "--source", root, "--label", `selfhost-${profile.label}`]);
    if (profile.remoteUpdate) {
      await runSignedRemoteUpdate(installer, answers, tempHome, cleanup, profile.label);
      await assertApiReady(credentials.api_url, liveTimeoutMs);
    }

    resetLiveStack(tempHome);
    stackStarted = false;
    const uninstall = runJson("node", ["packages/installer/dist/cli.js", "uninstall", "--home", tempHome, "--yes", "--backup"]);
    if (typeof uninstall.backupPath === "string") {
      cleanup.push(uninstall.backupPath);
    }
    assert(uninstall.status === "uninstalled", `${profile.label} uninstall must report uninstalled.`);
  } catch (error) {
    diagnoseLiveFailure(tempHome, profile.label);
    throw error;
  } finally {
    if (stackStarted) {
      try {
        resetLiveStack(tempHome);
      } catch {
        diagnoseLiveFailure(tempHome, `${profile.label}-cleanup`);
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

async function loadInstaller() {
  return import("../packages/installer/dist/index.js");
}

function assertProfileCoverage(installer, tempHome) {
  const syncPgvectorDocling = installer.createDefaultInstallAnswers({
    mindoryHome: tempHome,
    antivirus: { mode: "sync_scan", provider: "clamav" },
    vector: { provider: "pgvector" },
    docling: { enabled: true, url: "http://docling:8081", port: 8081, timeoutMs: 120000 }
  });
  const qdrantLocal = installer.createDefaultInstallAnswers({
    mindoryHome: tempHome,
    antivirus: { mode: "sync_scan", provider: "clamav" },
    vector: { provider: "qdrant", qdrantUrl: "http://qdrant:6333", qdrantCollectionPrefix: "mindory_selfhost" },
    llmRoles: {
      TEXT_EMBEDDING: {
        enabled: true,
        provider: "local-http",
        model: "mindory-local-embedding",
        dimensions: 1536,
        required: true,
        timeoutMs: 60000,
        concurrency: 1
      }
    }
  });
  const syncProfiles = installer.composeProfilesForAnswers(syncPgvectorDocling);
  const qdrantProfiles = installer.composeProfilesForAnswers(qdrantLocal);
  assert(syncProfiles.includes("clamav"), "Sync antivirus acceptance must enable the clamav profile.");
  assert(syncProfiles.includes("docling"), "Docling acceptance must enable the docling profile.");
  assert(!syncProfiles.includes("qdrant"), "pgvector acceptance must not rely on Qdrant.");
  assert(qdrantProfiles.includes("clamav"), "Qdrant acceptance must still exercise sync ClamAV.");
  assert(qdrantProfiles.includes("qdrant"), "Qdrant acceptance must enable the qdrant profile.");
  assert(qdrantProfiles.includes("local-models"), "Qdrant indexed acceptance must enable deterministic local embeddings.");
  assert(installer.answersToEnvMap(syncPgvectorDocling).MINDORY_AV_MODE === "sync_scan", "Self-host acceptance must render sync_scan.");
  assert(installer.answersToEnvMap(syncPgvectorDocling).MINDORY_DOCLING_ENABLED === "true", "Self-host acceptance must render Docling enabled.");
  assert(installer.answersToEnvMap(qdrantLocal).MINDORY_VECTOR_PROVIDER === "qdrant", "Self-host acceptance must render Qdrant provider.");
}

async function createLiveProfileAnswers(installer, tempHome, profile) {
  const apiPort = await findFreePort(3300 + Math.floor(Math.random() * 1000));
  const doclingPort = profile.docling ? await findFreePort(8400 + Math.floor(Math.random() * 1000)) : 8081;
  const collectionPrefix = `mindory_${profile.label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${Date.now()}`;
  return installer.createDefaultInstallAnswers({
    mindoryHome: tempHome,
    publicUrl: `http://localhost:${apiPort}`,
    antivirus: {
      mode: "sync_scan",
      provider: "clamav",
      clamavPlatform: process.env.MINDORY_CLAMAV_PLATFORM ?? "linux/amd64"
    },
    vector: {
      provider: profile.vectorProvider,
      qdrantUrl: "http://qdrant:6333",
      qdrantCollectionPrefix: collectionPrefix
    },
    docling: {
      enabled: profile.docling,
      url: `http://docling:${doclingPort}`,
      port: doclingPort,
      timeoutMs: 120000
    },
    llmProviders: {
      localHttpBaseUrl: "http://llm:8080"
    },
    llmRoles: profile.modelProfile === "local"
      ? {
        TEXT_EMBEDDING: {
          enabled: true,
          provider: "local-http",
          model: "mindory-local-embedding",
          dimensions: 1536,
          required: true,
          timeoutMs: 60000,
          concurrency: 1
        }
      }
      : {},
    interfaces: {
      apiPort,
      mcpEnabled: true,
      hermesEnabled: false
    }
  });
}

function expectedComposeProfiles(profile) {
  const profiles = ["clamav"];
  if (profile.vectorProvider === "qdrant") {
    profiles.push("qdrant");
  }
  if (profile.docling) {
    profiles.push("docling");
  }
  if (profile.modelProfile === "local") {
    profiles.push("local-models");
  }
  return profiles;
}

async function runSignedRemoteUpdate(installer, answers, tempHome, cleanup, label) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `mindory-selfhost-release-${label}-`));
  cleanup.push(outDir);
  const version = `0.0.0-task112-${label}-${Date.now()}`;
  const release = runJson("node", ["scripts/build-release-bundle.js", "--out", outDir, "--version", version]);
  assert(typeof release.manifest === "string", "Release bundle builder must return a signed manifest path.");
  assert(typeof release.publicKey === "string", "Release bundle builder must return a public key path.");
  const report = await installer.updateInstallFromRemoteRelease(answers, {
    manifestPath: release.manifest,
    publicKeyPath: release.publicKey,
    timeoutMs: liveTimeoutMs,
    dockerBinary: resolveDockerBinary(),
    backupLabel: `selfhost-remote-update-${label}`,
    owner: `mindory-selfhost-remote-update-${label}`
  });
  assert(report.pendingStepIds.length === 0, "Signed remote update must finish without pending steps.");
  assert(fs.existsSync(report.releaseDirectory), "Signed remote update must stage the verified release directory.");
}

function readInitialCredentials(tempHome) {
  return JSON.parse(fs.readFileSync(path.join(tempHome, "config", "initial-token.json"), "utf8"));
}

async function assertApiReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "API did not respond.";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ready`, { headers: { accept: "application/json" } });
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

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 200; port += 1) {
    if (await canListenOnPort(port)) {
      return port;
    }
  }
  throw new Error(`Could not find a free TCP port near ${startPort}.`);
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function diagnoseLiveFailure(tempHome, label) {
  const composePath = path.join(tempHome, "install", "compose", "docker-compose.yml");
  const envPath = path.join(tempHome, "config", ".env");
  if (!fs.existsSync(composePath) || !fs.existsSync(envPath)) {
    return;
  }
  console.error(`[selfhost] ${label} failed; collecting Docker Compose status.`);
  runBestEffort(resolveDockerBinary(), [
    "compose",
    "--env-file",
    envPath,
    "-f",
    composePath,
    "--profile",
    "clamav",
    "--profile",
    "qdrant",
    "--profile",
    "docling",
    "--profile",
    "local-models",
    "ps",
    "--all"
  ]);
  runBestEffort(resolveDockerBinary(), [
    "compose",
    "--env-file",
    envPath,
    "-f",
    composePath,
    "--profile",
    "clamav",
    "--profile",
    "qdrant",
    "--profile",
    "docling",
    "--profile",
    "local-models",
    "logs",
    "--tail",
    "120"
  ]);
}

function resetLiveStack(tempHome) {
  const composePath = path.join(tempHome, "install", "compose", "docker-compose.yml");
  const envPath = path.join(tempHome, "config", ".env");
  if (!fs.existsSync(composePath) || !fs.existsSync(envPath)) {
    run("pnpm", ["mvp:reset"], { MINDORY_HOME: tempHome });
    return;
  }
  run(resolveDockerBinary(), [
    "compose",
    "--env-file",
    envPath,
    "-f",
    composePath,
    "--profile",
    "clamav",
    "--profile",
    "qdrant",
    "--profile",
    "docling",
    "--profile",
    "local-models",
    "down",
    "--remove-orphans",
    "--volumes"
  ]);
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
    if (candidate === "docker" || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "docker";
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...commandEnv(),
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
      ...commandEnv(),
      ...env
    }
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function runBestEffort(command, args) {
  spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: commandEnv()
  });
}

function commandEnv() {
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

function removeIfSafeTempPath(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${os.tmpdir()}${path.sep}`)) {
    return;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
