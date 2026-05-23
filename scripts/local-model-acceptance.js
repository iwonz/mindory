import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.env.MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE === "true";
const timeoutMs = parsePositiveInteger(process.env.MINDORY_LOCAL_MODEL_ACCEPTANCE_TIMEOUT_MS ?? "300000", "MINDORY_LOCAL_MODEL_ACCEPTANCE_TIMEOUT_MS");

const scenario = [
  "supported deterministic local HTTP model profile",
  "text document chunk embeddings and indexed search",
  "PDF OCR artifacts with source refs",
  "image OCR caption labels object search and image embeddings",
  "audio ASR transcript artifacts with time refs",
  "video keyframe artifacts with source refs",
  "face observations identities and unified face search",
  "jobs API completion details",
  "model operation audit records through @mindory/llm audit sinks",
  "live Docker mode is explicit"
];

for (const required of ["local HTTP", "text", "PDF OCR", "image OCR", "audio ASR", "video keyframe", "face", "jobs", "source refs", "audit", "live Docker"]) {
  assert(scenario.some((step) => step.includes(required)), `Local-model scenario must include ${required}.`);
}

if (live) {
  await runLiveAcceptance();
} else {
  runDryRunAcceptance();
}

function runDryRunAcceptance() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const checkRepo = fs.readFileSync(path.join(root, "scripts", "check-repo.js"), "utf8");
  const mvpAcceptance = fs.readFileSync(path.join(root, "scripts", "mvp-acceptance.js"), "utf8");
  const mvpDemo = fs.readFileSync(path.join(root, "scripts", "mvp-demo.js"), "utf8");
  const llmValidation = fs.readFileSync(path.join(root, "scripts", "validate-llm.js"), "utf8");
  const workerRuntime = fs.readFileSync(path.join(root, "apps", "worker", "src", "runtime.ts"), "utf8");
  const localModelsDocs = fs.readFileSync(path.join(root, "docs", "LOCAL_MODELS.md"), "utf8");

  assert(packageJson.scripts?.["local-model:acceptance"] === "node scripts/local-model-acceptance.js", "Root package must expose local-model:acceptance.");
  assert(checkRepo.includes("local-model:acceptance"), "Repository checks must include local-model:acceptance.");
  for (const token of [
    "MINDORY_E2E_MODEL_PROFILE",
    "assertLocalModelMultimodalArtifacts",
    "Local deterministic OCR text",
    "Local deterministic vision caption",
    "Local deterministic ASR transcript",
    "/v1/faces/observations",
    "/v1/faces/identities",
    "targets: [\"faces\"]",
    "/v1/jobs"
  ]) {
    assert(mvpAcceptance.includes(token), `MVP acceptance must verify local-model token ${token}.`);
  }
  for (const token of [
    "MINDORY_LLM_TEXT_EMBEDDING_ENABLED",
    "MINDORY_LLM_IMAGE_EMBEDDING_ENABLED",
    "MINDORY_LLM_OCR_ENABLED",
    "MINDORY_LLM_ASR_ENABLED",
    "MINDORY_LLM_VISION_CAPTIONING_ENABLED",
    "MINDORY_LLM_FACE_DETECTION_ENABLED",
    "MINDORY_LLM_FACE_RECOGNITION_ENABLED"
  ]) {
    assert(mvpDemo.includes(token), `Local model profile must configure ${token}.`);
  }
  for (const role of ["text-embedding", "image-embedding", "ocr", "asr", "vision-captioning", "face-detection", "face-recognition"]) {
    assert(llmValidation.includes(`audit.role === "${role}"`), `LLM validation must cover ${role} audit records.`);
  }
  assert(workerRuntime.includes("createModelOperationLogEvent(audit)"), "Worker runtime must export model operation audit logs.");
  assert(workerRuntime.includes("metrics.recordModelOperation(audit)"), "Worker runtime must record model operation metrics.");
  assert(localModelsDocs.includes("pnpm local-model:acceptance"), "Local model docs must document local-model acceptance.");
  console.log("Local model acceptance dry-run passed. Set MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE=true to run the Docker local-model path.");
}

async function runLiveAcceptance() {
  const apiPort = await findFreePort(3500 + Math.floor(Math.random() * 1000));
  const workerMetricsPort = await findFreePort(4500 + Math.floor(Math.random() * 1000));
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-local-model-acceptance-"));
  const env = {
    ...process.env,
    MINDORY_HOME: tempHome,
    MINDORY_API_PORT: String(apiPort),
    MINDORY_E2E_API_URL: `http://localhost:${apiPort}`,
    MINDORY_E2E_MODEL_PROFILE: "local",
    MINDORY_E2E_EXPECT_MODEL_AUDIT_METRICS: "true",
    MINDORY_METRICS_ENABLED: "true",
    MINDORY_METRICS_WORKER_PORT: String(workerMetricsPort)
  };
  try {
    run("pnpm", ["mvp:demo", "--model-profile", "local", "--require-indexed", "--timeout-ms", String(timeoutMs)], env);
    console.log("Local model live acceptance passed.");
  } finally {
    try {
      run("pnpm", ["mvp:reset"], env);
    } finally {
      removeIfSafeTempPath(tempHome);
    }
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 200; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(`Could not find a free local port starting at ${startPort}.`);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function removeIfSafeTempPath(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${os.tmpdir()}${path.sep}`)) {
    throw new Error(`Refusing to remove non-temp path ${resolved}.`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
