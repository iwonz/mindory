import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.env.MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE === "true";
const ocrLive = process.env.MINDORY_LOCAL_OCR_ACCEPTANCE_LIVE === "true";
const asrLive = process.env.MINDORY_LOCAL_ASR_ACCEPTANCE_LIVE === "true";
const visionLive = process.env.MINDORY_LOCAL_VISION_ACCEPTANCE_LIVE === "true";
const timeoutMs = parsePositiveInteger(process.env.MINDORY_LOCAL_MODEL_ACCEPTANCE_TIMEOUT_MS ?? "300000", "MINDORY_LOCAL_MODEL_ACCEPTANCE_TIMEOUT_MS");

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"]
};

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
}
if (ocrLive) {
  await runOcrRunnerLiveAcceptance();
}
if (asrLive) {
  await runAsrRunnerLiveAcceptance();
}
if (visionLive) {
  await runVisionRunnerLiveAcceptance();
}
if (!live && !ocrLive && !asrLive && !visionLive) {
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
  const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
  const tesseractServer = fs.readFileSync(path.join(root, "deploy", "local-models", "ocr", "tesseract", "server.py"), "utf8");
  const asrServer = fs.readFileSync(path.join(root, "deploy", "local-models", "asr", "faster-whisper", "server.py"), "utf8");
  const visionServer = fs.readFileSync(path.join(root, "deploy", "local-models", "vision", "image-semantics", "server.py"), "utf8");

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
  for (const token of [
    "local-models-ocr",
    "deploy/local-models/ocr/tesseract/Dockerfile",
    "MINDORY_LLM_OCR_LOCAL_HTTP_BASE_URL",
    "MINDORY_OCR_HEALTH_LOAD_MODEL",
    "local-models-asr",
    "deploy/local-models/asr/faster-whisper/Dockerfile",
    "MINDORY_LLM_ASR_LOCAL_HTTP_BASE_URL",
    "MINDORY_ASR_HEALTH_LOAD_MODEL",
    "local-models-vision",
    "deploy/local-models/vision/image-semantics/Dockerfile",
    "MINDORY_LLM_IMAGE_EMBEDDING_LOCAL_HTTP_BASE_URL",
    "MINDORY_LLM_VISION_CAPTIONING_LOCAL_HTTP_BASE_URL",
    "MINDORY_IMAGE_SEMANTICS_HEALTH_LOAD_MODEL"
  ]) {
    assert(compose.includes(token), `Local model Compose profile must include ${token}.`);
  }
  for (const token of ["Tesseract", "pypdfium2", "POST", "/ocr", "page_number", "confidence"]) {
    assert(tesseractServer.includes(token), `Tesseract runner server must include ${token}.`);
  }
  for (const token of ["faster_whisper", "WhisperModel", "POST", "/asr", "segment_index", "start_ms", "end_ms"]) {
    assert(asrServer.includes(token), `Faster Whisper ASR runner server must include ${token}.`);
  }
  for (const token of ["numpy", "PIL", "POST", "/embeddings/images", "/vision/caption", "/vision/objects", "bounding_box", "image_embedding_failed"]) {
    assert(visionServer.includes(token), `Image semantics runner server must include ${token}.`);
  }
  assert(localModelsDocs.includes("MINDORY_LOCAL_OCR_ACCEPTANCE_LIVE=true"), "Local model docs must document live Tesseract acceptance.");
  assert(localModelsDocs.includes("MINDORY_LOCAL_ASR_ACCEPTANCE_LIVE=true"), "Local model docs must document live Faster Whisper acceptance.");
  assert(localModelsDocs.includes("MINDORY_LOCAL_VISION_ACCEPTANCE_LIVE=true"), "Local model docs must document live image semantics acceptance.");
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

async function runOcrRunnerLiveAcceptance() {
  const ocrPort = await findFreePort(8083 + Math.floor(Math.random() * 1000));
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-local-ocr-acceptance-"));
  const env = {
    ...process.env,
    MINDORY_HOME: tempHome,
    MINDORY_OCR_PORT: String(ocrPort),
    MINDORY_LLM_OCR_LOCAL_HTTP_BASE_URL: `http://ocr:8083`,
    MINDORY_LLM_OCR_MODEL: "tesseract-eng"
  };
  try {
    run("docker", ["compose", "--profile", "local-models-ocr", "up", "--build", "-d", "ocr"], env);
    const baseUrl = `http://127.0.0.1:${ocrPort}`;
    await waitForHttpOk(`${baseUrl}/health`, timeoutMs);
    const imageResult = await postOcr(baseUrl, createTextPngWithDocker(env, "MINDORY OCR IMAGE"), "image/png");
    assert(extractOcrText(imageResult).length > 0, "Tesseract live image OCR must return recognized text.");
    const pdfResult = await postOcr(baseUrl, createTextPdfBuffer("Mindory OCR PDF"), "application/pdf");
    assert(extractOcrText(pdfResult).length > 0, "Tesseract live PDF OCR must return recognized text.");
    console.log("Tesseract live acceptance passed.");
  } catch (error) {
    try {
      run("docker", ["compose", "--profile", "local-models-ocr", "logs", "ocr"], env);
    } catch {
      // Keep the original acceptance error when log collection itself fails.
    }
    throw error;
  } finally {
    try {
      run("docker", ["compose", "--profile", "local-models-ocr", "down", "--remove-orphans"], env);
    } finally {
      removeIfSafeTempPath(tempHome);
    }
  }
}

async function runAsrRunnerLiveAcceptance() {
  const asrPort = await findFreePort(8084 + Math.floor(Math.random() * 1000));
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-local-asr-acceptance-"));
  const env = {
    ...process.env,
    MINDORY_HOME: tempHome,
    MINDORY_ASR_PORT: String(asrPort),
    MINDORY_ASR_MODEL: process.env.MINDORY_ASR_MODEL ?? "Systran/faster-whisper-tiny.en",
    MINDORY_ASR_DEVICE: process.env.MINDORY_ASR_DEVICE ?? "cpu",
    MINDORY_ASR_COMPUTE_TYPE: process.env.MINDORY_ASR_COMPUTE_TYPE ?? "int8",
    MINDORY_LLM_ASR_LOCAL_HTTP_BASE_URL: `http://asr:8084`,
    MINDORY_LLM_ASR_MODEL: process.env.MINDORY_LLM_ASR_MODEL ?? "Systran/faster-whisper-tiny.en"
  };
  try {
    run("docker", ["compose", "--profile", "local-models-asr", "up", "--build", "-d", "asr"], env);
    const baseUrl = `http://127.0.0.1:${asrPort}`;
    await waitForHttpOk(`${baseUrl}/health`, timeoutMs);
    const fixture = createAsrFixtureWithDocker(env, "mindory audio runner test");
    const result = await postAsr(baseUrl, fixture, "audio/wav");
    const transcript = extractAsrText(result);
    assert(transcript.length > 0, "Faster Whisper live ASR must return non-empty transcript text.");
    assert(Array.isArray(result.segments) && result.segments.some((segment) => Number.isInteger(segment.start_ms) && Number.isInteger(segment.end_ms)), "Faster Whisper live ASR must return time-coded transcript segments.");
    await assertAsrFailureDiagnostics(baseUrl);
    console.log("Faster Whisper ASR live acceptance passed.");
  } catch (error) {
    try {
      run("docker", ["compose", "--profile", "local-models-asr", "logs", "asr"], env);
    } catch {
      // Keep the original acceptance error when log collection itself fails.
    }
    throw error;
  } finally {
    try {
      run("docker", ["compose", "--profile", "local-models-asr", "down", "--remove-orphans"], env);
    } finally {
      removeIfSafeTempPath(tempHome);
    }
  }
}

async function runVisionRunnerLiveAcceptance() {
  const visionPort = await findFreePort(8082 + Math.floor(Math.random() * 1000));
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-local-vision-acceptance-"));
  const env = {
    ...process.env,
    MINDORY_HOME: tempHome,
    MINDORY_IMAGE_SEMANTICS_PORT: String(visionPort),
    MINDORY_LLM_IMAGE_EMBEDDING_LOCAL_HTTP_BASE_URL: `http://vision:8082`,
    MINDORY_LLM_VISION_CAPTIONING_LOCAL_HTTP_BASE_URL: `http://vision:8082`,
    MINDORY_LLM_IMAGE_EMBEDDING_MODEL: "mindory-image-embedding-v1",
    MINDORY_LLM_VISION_CAPTIONING_MODEL: "mindory-vision-captioning-v1"
  };
  try {
    run("docker", ["compose", "--profile", "local-models-vision", "up", "--build", "-d", "vision"], env);
    const baseUrl = `http://127.0.0.1:${visionPort}`;
    await waitForHttpOk(`${baseUrl}/health`, timeoutMs);
    const fixture = createVisionFixtureWithDocker(env);
    const caption = await postVisionCaption(baseUrl, fixture, "image/png");
    assert(typeof caption.caption === "string" && caption.caption.includes("Image semantics:"), "Image semantics live caption must include the generated analysis caption.");
    assert(Array.isArray(caption.labels) && caption.labels.some((label) => String(label).includes("red")), "Image semantics live caption must include color-derived labels.");
    const objects = await postVisionObjects(baseUrl, fixture, "image/png");
    assert(Array.isArray(objects.objects) && objects.objects.some((object) => String(object.label).includes("red")), "Image semantics live object detection must return color object observations.");
    assert(objects.objects.some((object) => object.bounding_box && Number(object.bounding_box.width) > 0), "Image semantics live object detection must include bounding boxes.");
    const embeddings = await postImageEmbeddings(baseUrl, fixture, "image/png", 1536);
    assert(Array.isArray(embeddings.embeddings?.[0]) && embeddings.embeddings[0].length === 1536, "Image semantics live embedding must return the requested vector dimensions.");
    await assertVisionFailureDiagnostics(baseUrl);
    console.log("Image semantics live acceptance passed.");
  } catch (error) {
    try {
      run("docker", ["compose", "--profile", "local-models-vision", "logs", "vision"], env);
    } catch {
      // Keep the original acceptance error when log collection itself fails.
    }
    throw error;
  } finally {
    try {
      run("docker", ["compose", "--profile", "local-models-vision", "down", "--remove-orphans"], env);
    } finally {
      removeIfSafeTempPath(tempHome);
    }
  }
}

async function waitForHttpOk(url, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `${response.status} ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function postVisionCaption(baseUrl, bytes, mimeType) {
  const response = await fetch(`${baseUrl}/vision/caption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mindory-vision-captioning-v1",
      mime_type: mimeType,
      data_base64: bytes.toString("base64")
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Vision caption request failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function postVisionObjects(baseUrl, bytes, mimeType) {
  const response = await fetch(`${baseUrl}/vision/objects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mindory-vision-captioning-v1",
      mime_type: mimeType,
      data_base64: bytes.toString("base64")
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Vision object request failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function postImageEmbeddings(baseUrl, bytes, mimeType, dimensions) {
  const response = await fetch(`${baseUrl}/embeddings/images`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mindory-image-embedding-v1",
      dimensions,
      images: [{
        mime_type: mimeType,
        data_base64: bytes.toString("base64")
      }]
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Image embedding request failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function postOcr(baseUrl, bytes, mimeType) {
  const response = await fetch(`${baseUrl}/ocr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "tesseract-eng",
      mime_type: mimeType,
      data_base64: bytes.toString("base64")
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OCR request failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function postAsr(baseUrl, bytes, mimeType) {
  const response = await fetch(`${baseUrl}/asr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "Systran/faster-whisper-tiny.en",
      mime_type: mimeType,
      data_base64: bytes.toString("base64")
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ASR request failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function assertVisionFailureDiagnostics(baseUrl) {
  const response = await fetch(`${baseUrl}/vision/caption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mindory-vision-captioning-v1",
      mime_type: "image/png",
      data_base64: Buffer.from("not an image").toString("base64")
    })
  });
  const text = await response.text();
  assert(!response.ok, "Image semantics live caption must reject invalid image bytes.");
  assert(text.includes("vision_failed"), "Image semantics live failure response must include vision_failed diagnostics.");
}

async function assertAsrFailureDiagnostics(baseUrl) {
  const response = await fetch(`${baseUrl}/asr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "Systran/faster-whisper-tiny.en",
      mime_type: "audio/wav",
      data_base64: Buffer.from("not an audio file").toString("base64")
    })
  });
  const text = await response.text();
  assert(!response.ok, "Faster Whisper live ASR must reject invalid audio.");
  assert(text.includes("asr_failed"), "Faster Whisper live ASR failure response must include asr_failed diagnostics.");
}

function extractOcrText(payload) {
  const direct = typeof payload.text === "string" ? payload.text : "";
  const pages = Array.isArray(payload.pages) ? payload.pages.map((page) => page?.text ?? "").join("\n") : "";
  return `${direct}\n${pages}`.trim();
}

function extractAsrText(payload) {
  const direct = typeof payload.text === "string" ? payload.text : "";
  const segments = Array.isArray(payload.segments) ? payload.segments.map((segment) => segment?.text ?? "").join("\n") : "";
  return `${direct}\n${segments}`.trim();
}

function createVisionFixtureWithDocker(env) {
  const script = `
import base64
import io
import sys
from PIL import Image, ImageDraw

image = Image.new("RGB", (420, 260), "white")
draw = ImageDraw.Draw(image)
draw.rectangle((28, 40, 150, 210), fill=(225, 25, 25))
draw.ellipse((178, 55, 310, 190), fill=(30, 165, 60))
draw.rectangle((320, 80, 395, 205), fill=(30, 70, 215))
buffer = io.BytesIO()
image.save(buffer, format="PNG")
sys.stdout.write(base64.b64encode(buffer.getvalue()).decode("ascii"))
`;
  const result = spawnSync("docker", ["compose", "--profile", "local-models-vision", "exec", "-T", "vision", "python", "-c", script], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Could not create vision image fixture: ${(result.stderr || result.stdout).trim()}`);
  }
  return Buffer.from(result.stdout.trim(), "base64");
}

function createTextPngWithDocker(env, text) {
  const script = `
import base64
import io
import sys
from PIL import Image, ImageDraw, ImageFont

text = sys.argv[1]
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
probe = Image.new("RGB", (1, 1), "white")
draw = ImageDraw.Draw(probe)
left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
image = Image.new("RGB", (right - left + 96, bottom - top + 96), "white")
draw = ImageDraw.Draw(image)
draw.text((48 - left, 48 - top), text, fill="black", font=font)
buffer = io.BytesIO()
image.save(buffer, format="PNG")
sys.stdout.write(base64.b64encode(buffer.getvalue()).decode("ascii"))
`;
  const result = spawnSync("docker", ["compose", "--profile", "local-models-ocr", "exec", "-T", "ocr", "python", "-c", script, text], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Could not create OCR image fixture: ${(result.stderr || result.stdout).trim()}`);
  }
  return Buffer.from(result.stdout.trim(), "base64");
}

function createAsrFixtureWithDocker(env, text) {
  const script = `
import base64
import subprocess
import sys
import tempfile
from pathlib import Path

text = sys.argv[1]
with tempfile.TemporaryDirectory(prefix="mindory-asr-fixture-") as temp_dir:
    path = Path(temp_dir) / "fixture.wav"
    subprocess.run(["espeak-ng", "-w", str(path), text], check=True, capture_output=True, text=True)
    sys.stdout.write(base64.b64encode(path.read_bytes()).decode("ascii"))
`;
  const result = spawnSync("docker", ["compose", "--profile", "local-models-asr", "exec", "-T", "asr", "python", "-c", script, text], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Could not create ASR audio fixture: ${(result.stderr || result.stdout).trim()}`);
  }
  return Buffer.from(result.stdout.trim(), "base64");
}

function createTextPdfBuffer(text) {
  const escaped = text.replace(/[\\()]/g, (match) => `\\${match}`);
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  ];
  const stream = `BT /F1 40 Tf 72 90 Td (${escaped}) Tj ET`;
  objects.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function createTextPpmBuffer(text) {
  const scale = 14;
  const glyphWidth = 5;
  const glyphHeight = 7;
  const spacing = 2;
  const margin = 30;
  const width = margin * 2 + text.length * (glyphWidth + spacing) * scale;
  const height = margin * 2 + glyphHeight * scale;
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  const pixels = Buffer.alloc(width * height * 3, 255);
  for (let index = 0; index < text.length; index += 1) {
    drawGlyph(pixels, width, height, margin + index * (glyphWidth + spacing) * scale, margin, text[index].toUpperCase(), scale);
  }
  return Buffer.concat([header, pixels]);
}

function drawGlyph(buffer, width, height, x, y, char, scale) {
  const rows = FONT[char] ?? FONT[" "];
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < rows[row].length; col += 1) {
      if (rows[row][col] !== "1") {
        continue;
      }
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          setRgbPixel(buffer, width, height, x + col * scale + dx, y + row * scale + dy, 0, 0, 0);
        }
      }
    }
  }
}

function setRgbPixel(buffer, width, height, x, y, r, g, b) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }
  const offset = (y * width + x) * 3;
  buffer[offset] = r;
  buffer[offset + 1] = g;
  buffer[offset + 2] = b;
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
