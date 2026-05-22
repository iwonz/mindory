import { Buffer } from "node:buffer";
import http from "node:http";
import { Readable } from "node:stream";
import { loadMindoryConfig } from "../packages/config/dist/index.js";
import { DoclingPdfExtractor } from "../packages/processors/extractors/docling/dist/index.js";
import { buildMindoryLlm, llmRoleState } from "../packages/llm/dist/index.js";

const host = process.env.MINDORY_DOCLING_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.MINDORY_DOCLING_PORT ?? "8081", 10);
const config = loadMindoryConfig(process.env);
const llm = buildMindoryLlm(config);
const extractor = new DoclingPdfExtractor({
  ocr: llmRoleState(llm, "ocr"),
  ocrRole: llm.registry.require("ocr"),
  ...(llm.ocr === undefined ? {} : { ocrProvider: llm.ocr })
});

function log(message, details = {}) {
  const entry = {
    level: "info",
    service: "mindory-docling",
    message,
    ...details,
    timestamp: new Date().toISOString()
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    throw Object.assign(new Error("Request body is required."), { statusCode: 400, code: "request_body_required" });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400, code: "invalid_json" });
  }
}

function documentFromPayload(payload, bytes) {
  const document = payload?.document;
  const projectId = typeof document?.project_id === "string" ? document.project_id : "";
  const documentId = typeof document?.document_id === "string" ? document.document_id : "";
  const originalFilename = typeof document?.original_filename === "string" ? document.original_filename : "document.pdf";
  const mimeType = typeof document?.mime_type === "string" ? document.mime_type : "application/pdf";
  if (projectId === "" || documentId === "") {
    throw Object.assign(new Error("document.project_id and document.document_id are required."), { statusCode: 400, code: "invalid_document" });
  }
  return {
    id: documentId,
    projectId,
    title: null,
    originalFilename,
    mimeType,
    sizeBytes: typeof document?.size_bytes === "number" ? document.size_bytes : bytes.byteLength,
    storageKey: `docling-service/${documentId}`,
    status: "extract_pending",
    source: {
      type: "unknown"
    },
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function bytesFromPayload(payload) {
  if (typeof payload?.data_base64 !== "string" || payload.data_base64.trim() === "") {
    throw Object.assign(new Error("data_base64 is required."), { statusCode: 400, code: "data_base64_required" });
  }
  return Buffer.from(payload.data_base64, "base64");
}

async function handleExtract(request, response) {
  const payload = await readJsonBody(request);
  const bytes = bytesFromPayload(payload);
  const document = documentFromPayload(payload, bytes);
  const result = await extractor.extract({
    document,
    body: Readable.from(bytes)
  });
  sendJson(response, 200, {
    status: "succeeded",
    extractor: extractor.name,
    version: extractor.version,
    text: result.text,
    mime_type: result.mimeType,
    pages: (result.pages ?? []).map((page) => ({
      page_number: page.pageNumber,
      text: page.text,
      width: page.width ?? null,
      height: page.height ?? null,
      confidence: page.confidence ?? null,
      metadata: page.metadata ?? {}
    })),
    metadata: {
      ...result.metadata,
      docling_service_runtime: "mindory-node"
    }
  });
}

const server = http.createServer((request, response) => {
  void (async () => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "mindory-docling",
        extractor: extractor.name,
        version: extractor.version
      });
      return;
    }
    if (request.method === "POST" && request.url === "/v1/extract") {
      await handleExtract(request, response);
      return;
    }
    sendJson(response, 404, {
      status: "failed",
      error: {
        code: "route_not_found",
        message: "Route not found."
      }
    });
  })().catch((error) => {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(response, statusCode, {
      status: "failed",
      error: {
        code: typeof error?.code === "string" ? error.code : "docling_service_error",
        message: error instanceof Error ? error.message : "Docling service failed."
      }
    });
  });
});

server.listen(port, host, () => {
  log("Docling-compatible extraction service listening.", { host, port });
});

process.on("SIGTERM", () => {
  server.close(() => {
    log("Docling-compatible extraction service stopped.");
    process.exit(0);
  });
});
