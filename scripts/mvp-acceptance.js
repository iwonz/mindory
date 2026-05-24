import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scenario = [
  "seed demo project and bearer token",
  "api create project peers session and messages",
  "api upload document and poll processing jobs",
  "api upload PDF image audio and video documents",
  "artifact search with metadata filters",
  "local model OCR ASR vision face artifacts and audit wiring",
  "local model image and audio generation smoke through @mindory/llm",
  "document reprocess and job status details",
  "disabled and non-blocking model modes",
  "strict indexed document search when embeddings are enabled",
  "api create source-backed memory",
  "api build context",
  "cli build context and inspect jobs",
  "mcp recall memory through HTTP API",
  "hermes prepare context and save turn"
];

if (process.env.MINDORY_E2E_LIVE !== "true") {
  for (const required of ["api", "cli", "mcp", "hermes", "upload document", "PDF", "image", "audio", "video", "artifact search", "metadata filters", "local model", "face", "generation", "audit", "reprocess", "job status details", "disabled and non-blocking", "source-backed memory", "poll processing jobs", "indexed", "document search"]) {
    assert(scenario.some((step) => step.includes(required)), `Dry-run scenario must include ${required}.`);
  }
  console.log("MVP acceptance dry-run validated. Set MINDORY_E2E_LIVE=true to run against a live API.");
  process.exit(0);
}

const apiUrl = (process.env.MINDORY_E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const requireIndexed = process.env.MINDORY_E2E_REQUIRE_INDEXED === "true";
const expectModelAuditMetrics = process.env.MINDORY_E2E_EXPECT_MODEL_AUDIT_METRICS === "true";
const projectId = process.env.MINDORY_DEMO_PROJECT_ID ?? "mindory-demo";
const token = process.env.MINDORY_DEMO_TOKEN ?? "mindory-demo-token";
const modelProfile = process.env.MINDORY_E2E_MODEL_PROFILE ?? "disabled";
const userPeerId = "peer_demo_user";
const agentPeerId = "peer_demo_agent";
const sessionId = `sess_demo_${Date.now()}`;

const project = await requestJson("POST", "/v1/projects", {
  id: projectId,
  name: "Mindory Demo",
  metadata: { demo: true }
});
assert(project.id === projectId, "Project creation should return the demo project.");

await requestJson("POST", "/v1/peers", {
  id: userPeerId,
  projectId,
  type: "human",
  name: "Demo User",
  externalId: "demo-user"
});
await requestJson("POST", "/v1/peers", {
  id: agentPeerId,
  projectId,
  type: "agent",
  name: "Demo Agent",
  externalId: "demo-agent"
});
await requestJson("POST", "/v1/sessions", {
  id: sessionId,
  projectId,
  peerIds: [userPeerId, agentPeerId],
  title: "MVP acceptance"
});
const message = await requestJson("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
  projectId,
  authorPeerId: userPeerId,
  role: "user",
  content: "Remember that I prefer source-backed context for Mindory demos."
});

const uploaded = await uploadDemoDocument();
const documentId = uploaded.document?.id;
assert(typeof documentId === "string", "Document upload should return a document id.");
await waitForDocument(documentId);
await assertDocumentSearch(documentId);
const multimodal = await uploadMultimodalDocuments();
await assertMultimodalSearch(multimodal);
if (modelProfile === "local") {
  await assertLocalModelMultimodalArtifacts(multimodal);
  assertLocalModelGenerationSmoke();
}
await assertDocumentReprocess(multimodal.image);

const memory = await requestJson("POST", "/v1/memories", {
  projectId,
  type: "preference",
  text: "The demo user prefers source-backed context for Mindory demos.",
  sourceRefs: [{ type: "message", id: message.id }],
  createdByPeerId: agentPeerId
});
assert(memory.source_refs?.length > 0, "Memory must include source refs.");

const context = await requestJson("POST", "/v1/context/build", {
  projectIds: [projectId],
  sessionId,
  query: "source-backed context",
  tokenBudget: 3000
});
assert(Array.isArray(context.blocks), "Context build should return blocks.");

runCli(["context", "build", "--project", projectId, "--session", sessionId, "--token-budget", "3000", "source-backed context"]);
runCli(["jobs", "list", "--project", projectId, "--limit", "5"]);
runCli(["artifact", "search", "--project", projectId, "--metadata-filter", "{\"key\":\"extension\",\"valueText\":\"png\"}", "passport airport"]);

const { MindoryApiClient } = await import("../apps/mcp/dist/http-client.js");
const { MindoryMcpToolRegistry } = await import("../apps/mcp/dist/tools.js");
const mcp = new MindoryMcpToolRegistry(new MindoryApiClient({ baseUrl: apiUrl, token }));
const mcpResult = await mcp.callTool("memory_recall", {
  projectIds: [projectId],
  query: "source-backed context",
  limit: 5
});
assert(mcpResult.content[0]?.text.includes("source-backed"), "MCP recall should return source-backed memory content.");
const artifactMcpResult = await mcp.callTool("artifact_search", {
  projectIds: [projectId],
  query: "passport airport",
  artifactTypes: ["ocr_text", "image_caption"],
  metadataFilters: [{ key: "extension", valueText: "png" }],
  limit: 5
});
assert(artifactMcpResult.content[0]?.text.includes(multimodal.image), "MCP artifact search should return the image document.");

const { MindoryHermesAdapter } = await import("../apps/adapters/hermes/dist/adapter.js");
const { HermesMindoryApiClient } = await import("../apps/adapters/hermes/dist/http-client.js");
const hermes = new MindoryHermesAdapter({
  apiClient: new HermesMindoryApiClient({ baseUrl: apiUrl, token }),
  defaults: {
    defaultProject: projectId,
    defaultUserPeer: userPeerId,
    defaultAgentPeer: agentPeerId
  }
});
const hermesResult = await hermes.handleTurn({
  projectId,
  externalUserId: "demo-user",
  externalSessionId: `hermes-${sessionId}`,
  agentId: "demo-agent",
  userText: "Recall my Mindory demo preference.",
  assistantText: "I will use source-backed context."
});
assert(hermesResult.promptContext.promptPrefix.includes("Mindory context") || hermesResult.promptContext.promptPrefix === "", "Hermes should prepare prompt context.");

console.log("Live MVP acceptance scenario passed.");

async function requestJson(method, pathname, body = undefined) {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function uploadDemoDocument() {
  const filePath = path.join(root, "fixtures/demo/mindory-demo.txt");
  const fixture = await readFile(filePath, "utf8");
  const body = `${fixture}\nMindory acceptance marker source-backed context document search ${sessionId}.\n`;
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "Mindory MVP demo document");
  form.append("file", new Blob([body], { type: "text/plain" }), "mindory-demo.txt");
  const response = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    },
    body: form
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`document upload failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function uploadMultimodalDocuments() {
  const pdf = await uploadFixtureDocument({
    filename: "mindory-demo.pdf",
    mimeType: "application/pdf",
    title: "Mindory MVP PDF",
    body: buildMinimalPdf([
      "Mindory PDF native text source-backed acceptance.",
      "Second PDF page keeps page artifact refs searchable."
    ])
  });
  const image = await uploadFixtureDocument({
    filename: "nature-3-people-passport-airport.png",
    mimeType: "image/png",
    title: "Mindory MVP image",
    body: buildMinimalPng({
      width: 4,
      height: 3,
      text: "passport airport nature 3 people"
    })
  });
  const audio = await uploadFixtureDocument({
    filename: "mindory-demo-audio.wav",
    mimeType: "audio/wav",
    title: "Mindory MVP audio",
    body: buildMinimalWav({
      sampleRate: 8000,
      durationMs: 1000,
      transcript: "Audio transcript keeps durable memory recall searchable."
    })
  });
  const video = await uploadFixtureDocument({
    filename: "mindory-demo-video.mp4",
    mimeType: "video/mp4",
    title: "Mindory MVP video",
    body: buildVideoManifestFile({
      durationMs: 12000,
      codec: "manifest-h264",
      frames: [
        { timestampMs: 0, description: "forest path and nature", labels: ["nature"] },
        { timestampMs: 3000, description: "dogs near airport luggage", labels: ["dogs", "airport"] },
        { timestampMs: 6000, description: "passport in hand near terminal", labels: ["passport"] }
      ]
    })
  });
  const documents = {
    pdf: pdf.document.id,
    image: image.document.id,
    audio: audio.document.id,
    video: video.document.id
  };
  for (const documentId of Object.values(documents)) {
    await waitForDocument(documentId);
  }
  return documents;
}

async function uploadFixtureDocument(input) {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", input.title);
  form.append("file", new Blob([input.body], { type: input.mimeType }), input.filename);
  const response = await fetch(`${apiUrl}/v1/documents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    },
    body: form
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`document upload failed for ${input.filename}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForDocument(documentId) {
  const accepted = requireIndexed ? new Set(["indexed"]) : new Set(["chunked", "indexed"]);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await requestJson("GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    if (accepted.has(status.status)) {
      return status;
    }
    if (["failed", "scan_failed", "scan_infected", "quarantined"].includes(status.status)) {
      throw new Error(`document processing failed with status ${status.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const expected = requireIndexed ? "indexed" : "chunked/indexed";
  throw new Error(`document processing did not reach ${expected} status in time`);
}

async function assertDocumentSearch(documentId) {
  const search = await requestJson("POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "Mindory acceptance marker source-backed context document search",
    limit: 5
  });
  assert(Array.isArray(search.hits), "Document search should return hits array.");
  assert(search.hits.some((hit) => hit.documentId === documentId), "Document search should return the uploaded document chunk.");
  assert(search.hits.some((hit) => Array.isArray(hit.sourceRefs) && hit.sourceRefs.some((ref) => ref.type === "chunk")), "Document search hits should include chunk source refs.");
}

async function assertMultimodalSearch(documents) {
  const pdfSearch = await requestJson("POST", "/v1/documents/search", {
    projectIds: [projectId],
    query: "page artifact refs searchable",
    metadataFilters: [{ key: "extension", valueText: "pdf" }],
    limit: 5
  });
  assert(pdfSearch.hits.some((hit) => hit.documentId === documents.pdf), "PDF search should return native text hits.");

  const imageArtifacts = await requestJson("POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "passport airport",
    artifactTypes: ["ocr_text", "image_caption", "image_analysis"],
    metadataFilters: [{ key: "extension", valueText: "png" }],
    limit: 5
  });
  assert(imageArtifacts.hits.some((hit) => hit.document_id === documents.image), "Artifact search should return image OCR/caption hits.");

  const audioArtifacts = await requestJson("POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "durable memory recall",
    artifactTypes: ["transcript"],
    spanTypes: ["transcript_segment"],
    metadataFilters: [{ key: "extension", valueText: "wav" }],
    limit: 5
  });
  assert(audioArtifacts.hits.some((hit) => hit.document_id === documents.audio), "Artifact search should return audio transcript hits.");

  const videoArtifacts = await requestJson("POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "dogs luggage",
    artifactTypes: ["video_keyframe"],
    spanTypes: ["video_keyframe_description"],
    metadataFilters: [{ key: "duration_ms", operator: "between", minNumber: 10000, maxNumber: 15000, unit: "ms" }],
    limit: 5
  });
  assert(videoArtifacts.hits.some((hit) => hit.document_id === documents.video), "Artifact search should return video keyframe hits.");
}

async function assertLocalModelMultimodalArtifacts(documents) {
  const localOcr = await requestJson("POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "Local deterministic OCR text",
    artifactTypes: ["ocr_text"],
    limit: 10
  });
  assert(localOcr.hits.some((hit) => [documents.pdf, documents.image].includes(hit.document_id)), "Local model acceptance should find deterministic OCR artifacts.");
  assert(localOcr.hits.some((hit) => Array.isArray(hit.source_refs) && hit.source_refs.some((ref) => ref.type === "artifact")), "Local OCR hits should include artifact source refs.");

  const localVision = await requestJson("POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "Local deterministic vision caption",
    artifactTypes: ["image_caption", "image_analysis"],
    limit: 10
  });
  assert(localVision.hits.some((hit) => hit.document_id === documents.image), "Local model acceptance should find deterministic image caption artifacts.");

  const localAsr = await requestJson("POST", "/v1/artifacts/search", {
    projectIds: [projectId],
    query: "Local deterministic ASR transcript",
    artifactTypes: ["transcript"],
    spanTypes: ["transcript_segment"],
    limit: 10
  });
  assert(localAsr.hits.some((hit) => hit.document_id === documents.audio), "Local model acceptance should find deterministic ASR transcript artifacts.");

  const observations = await requestJson("GET", `/v1/faces/observations?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent(documents.image)}&limit=20`);
  assert(Array.isArray(observations.observations) && observations.observations.length > 0, "Local model acceptance should create face observations for the image.");
  assert(observations.observations.some((observation) => observation.model === "mindory-local-face"), "Face observations should record the configured local face model.");

  const identities = await requestJson("GET", `/v1/faces/identities?projectId=${encodeURIComponent(projectId)}&limit=20`);
  assert(Array.isArray(identities.identities) && identities.identities.length > 0, "Local model acceptance should create workspace face identities.");

  const unifiedFaces = await requestJson("POST", "/v1/search", {
    projectIds: [projectId],
    targets: ["faces"],
    query: "local-face",
    limit: 10
  });
  assert(unifiedFaces.hits.some((hit) => hit.kind === "face_observation" && hit.documentId === documents.image), "Unified search should return local face observations.");
  assert(unifiedFaces.hits.some((hit) => Array.isArray(hit.sourceRefs) && hit.sourceRefs.some((ref) => ref.type === "face_observation")), "Face search hits should include face source refs.");

  const jobs = await requestJson("GET", `/v1/jobs?projectId=${encodeURIComponent(projectId)}&limit=50`);
  assert(Array.isArray(jobs.jobs) && jobs.jobs.some((job) => job.status === "succeeded"), "Local model acceptance should expose succeeded processing jobs.");

  if (expectModelAuditMetrics) {
    await assertLocalModelAuditMetrics();
  }
}

async function assertLocalModelAuditMetrics() {
  const metricsPort = process.env.MINDORY_METRICS_WORKER_PORT ?? "3001";
  const metricsPath = process.env.MINDORY_METRICS_PATH ?? "/metrics";
  const url = `http://127.0.0.1:${metricsPort}${metricsPath}`;
  let lastError = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "text/plain" } });
      const metrics = await response.text();
      if (response.ok && localModelAuditMetricsPresent(metrics)) {
        return;
      }
      lastError = response.ok ? "model operation metrics were not present yet" : `metrics endpoint returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Local model audit metrics were not exported from worker metrics endpoint ${url}: ${lastError}`);
}

function localModelAuditMetricsPresent(metrics) {
  for (const role of ["text-embedding", "image-embedding", "ocr", "asr", "vision-captioning", "face-detection", "face-recognition"]) {
    if (!metrics.includes("mindory_model_operations_total") || !metrics.includes(`role="${role}"`) || !metrics.includes('provider="local-http"') || !metrics.includes('status="success"')) {
      return false;
    }
  }
  return true;
}

function assertLocalModelGenerationSmoke() {
  const generationEnv = {
    ...process.env,
    MINDORY_LLM_LOCAL_HTTP_BASE_URL: process.env.MINDORY_E2E_LLM_LOCAL_HTTP_BASE_URL ?? "http://127.0.0.1:8080",
    MINDORY_LLM_IMAGE_GENERATION_ENABLED: "true",
    MINDORY_LLM_IMAGE_GENERATION_PROVIDER: "local-http",
    MINDORY_LLM_IMAGE_GENERATION_MODEL: process.env.MINDORY_LLM_IMAGE_GENERATION_MODEL ?? "mindory-local-image-generation",
    MINDORY_LLM_AUDIO_GENERATION_ENABLED: "true",
    MINDORY_LLM_AUDIO_GENERATION_PROVIDER: "local-http",
    MINDORY_LLM_AUDIO_GENERATION_MODEL: process.env.MINDORY_LLM_AUDIO_GENERATION_MODEL ?? "mindory-local-audio-generation"
  };
  const image = runCliJson(["llm", "generate-image", "draw Mindory local acceptance media", "--include-bytes"], generationEnv);
  assertGeneratedMedia(image, "image-generation", "image/png", isPngBase64);
  const audio = runCliJson(["llm", "generate-audio", "say Mindory local acceptance media", "--include-bytes"], generationEnv);
  assertGeneratedMedia(audio, "audio-generation", "audio/wav", isWavBase64);
}

function assertGeneratedMedia(result, role, mimeType, isValidBase64) {
  assert(result.status === "success", `${role} CLI smoke should return success.`);
  assert(result.mimeType === mimeType, `${role} CLI smoke should return ${mimeType}.`);
  assert(Number.isInteger(result.byteLength) && result.byteLength > 0, `${role} CLI smoke should return non-empty media bytes.`);
  assert(isValidBase64(result.dataBase64), `${role} CLI smoke should return valid media bytes.`);
  const audits = Array.isArray(result.audits) ? result.audits : [result.audit];
  assert(audits.some((audit) => audit?.role === role && audit.provider === "local-http" && audit.status === "success"), `${role} CLI smoke should include a successful local-http audit record.`);
}

async function assertDocumentReprocess(documentId) {
  const recompute = await requestJson("POST", `/v1/documents/${encodeURIComponent(documentId)}/recompute`, {
    projectId,
    stages: ["image"],
    reason: "mvp_acceptance_reprocess",
    requestId: `mvp_reprocess_${Date.now()}`
  });
  assert(recompute.job?.id, "Reprocess should return a processing job id.");
  const job = await waitForJob(recompute.job.id, "succeeded");
  assert(job.details?.stages?.length > 0, "Reprocess job should expose stage graph details.");
}

async function waitForJob(jobId, expectedStatus) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const job = await requestJson("GET", `/v1/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`);
    if (job.status === expectedStatus) {
      return job;
    }
    if (["failed", "dead"].includes(job.status)) {
      throw new Error(`job ${jobId} failed: ${JSON.stringify(job.details ?? job)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`job ${jobId} did not reach ${expectedStatus} in time`);
}

function runCli(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--api-url", apiUrl, "--token", token, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`CLI failed (${args.join(" ")}): ${result.stderr || result.stdout}`);
  }
}

function runCliJson(args, env) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--api-url", apiUrl, "--token", token, ...args], {
    cwd: root,
    encoding: "utf8",
    env
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`CLI failed (${args.join(" ")}): ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`CLI returned non-JSON output for ${args.join(" ")}: ${result.stdout || error}`);
  }
}

function isPngBase64(value) {
  if (typeof value !== "string") {
    return false;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes.subarray(1, 4).toString("ascii") === "PNG"
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function isWavBase64(value) {
  if (typeof value !== "string") {
    return false;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.length >= 44
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WAVE";
}

function buildMinimalPdf(pageTexts) {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    `2 0 obj\n<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pageTexts.length} >>\nendobj`
  ];
  for (const [index, text] of pageTexts.entries()) {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const content = `BT /F1 12 Tf 72 720 Td (${escapePdfLiteralString(text)}) Tj ET`;
    objects.push(`${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjectId} 0 R >>\nendobj`);
    objects.push(`${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream\nendobj`);
  }
  return Buffer.from([
    "%PDF-1.4",
    ...objects,
    "trailer\n<< /Root 1 0 R >>",
    "%%EOF"
  ].join("\n"), "latin1");
}

function escapePdfLiteralString(value) {
  return value.replace(/[()\\]/g, (match) => `\\${match}`);
}

function buildMinimalPng(input) {
  const pixelBytesPerRow = input.width * 3;
  const rawRows = Buffer.alloc((pixelBytesPerRow + 1) * input.height);
  for (let y = 0; y < input.height; y += 1) {
    const rowStart = y * (pixelBytesPerRow + 1);
    rawRows[rowStart] = 0;
    for (let x = 0; x < input.width; x += 1) {
      const pixelStart = rowStart + 1 + x * 3;
      rawRows[pixelStart] = 0xe8;
      rawRows[pixelStart + 1] = 0xf3;
      rawRows[pixelStart + 2] = 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(input.width, 0);
  ihdr.writeUInt32BE(input.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from(`Description\0${input.text}`, "utf8")),
    pngChunk("IDAT", deflateSync(rawRows)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function buildMinimalWav(input) {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.round((input.sampleRate * input.durationMs) / 1000);
  const data = Buffer.alloc(sampleCount * channels * bytesPerSample);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(input.sampleRate, 4);
  fmt.writeUInt32LE(input.sampleRate * channels * bytesPerSample, 8);
  fmt.writeUInt16LE(channels * bytesPerSample, 12);
  fmt.writeUInt16LE(bitsPerSample, 14);
  const transcript = Buffer.concat([Buffer.from(input.transcript, "utf8"), Buffer.from([0])]);
  const chunks = [
    riffChunk("fmt ", fmt),
    riffChunk("data", data),
    riffChunk("LIST", Buffer.concat([Buffer.from("INFO", "latin1"), riffChunk("ICMT", transcript)]))
  ];
  const size = 4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(size, 4);
  header.write("WAVE", 8, "latin1");
  return Buffer.concat([header, ...chunks]);
}

function buildVideoManifestFile(input) {
  return Buffer.from(`MINDORY_VIDEO_MANIFEST\n${JSON.stringify(input)}`, "utf8");
}

function riffChunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, "latin1");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
