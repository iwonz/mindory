import { createHash } from "node:crypto";
import http from "node:http";

const host = process.env.MINDORY_LOCAL_MODEL_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.MINDORY_LOCAL_MODEL_PORT ?? "8080", 10);
const defaultModel = process.env.MINDORY_LOCAL_MODEL_NAME ?? "mindory-local-embedding";
const defaultDimensions = 1536;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        status: "ok",
        service: "mindory-local-model",
        embeddings: true,
        dimensions: defaultDimensions
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/models") {
      writeJson(response, 200, {
        data: [
          {
            id: defaultModel,
            object: "model",
            owned_by: "mindory-local"
          }
        ]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/embeddings") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, defaultModel);
      const input = Array.isArray(body.input) ? body.input : Array.isArray(body.texts) ? body.texts : [body.input ?? ""];
      const dimensions = positiveInteger(body.dimensions, defaultDimensions);
      writeJson(response, 200, {
        model,
        data: input.map((text, index) => ({
          index,
          embedding: deterministicEmbedding(String(text), model, dimensions)
        }))
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/embeddings/images") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-image-embedding");
      const images = Array.isArray(body.images) ? body.images : [];
      const dimensions = positiveInteger(body.dimensions, defaultDimensions);
      writeJson(response, 200, {
        model,
        data: images.map((image, index) => ({
          index,
          embedding: deterministicEmbedding(`${image?.mime_type ?? "image"}:${image?.data_base64 ?? ""}`, model, dimensions)
        }))
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/ocr") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-ocr");
      const text = "Local deterministic OCR text from Mindory local model service.";
      writeJson(response, 200, {
        model,
        text,
        pages: [
          {
            page_number: 1,
            text,
            confidence: 0.99
          }
        ]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/vision/caption") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-vision");
      writeJson(response, 200, {
        model,
        caption: "Local deterministic vision caption: image contains a document, nature and people.",
        labels: ["document", "nature", "people", "local-vision"]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/vision/objects") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-vision");
      writeJson(response, 200, {
        model,
        labels: ["document", "nature", "people"],
        objects: [
          {
            label: "document",
            confidence: 0.96,
            bounding_box: { x: 0.14, y: 0.18, width: 0.38, height: 0.42, unit: "ratio" }
          },
          {
            label: "person",
            confidence: 0.92,
            bounding_box: { x: 0.62, y: 0.16, width: 0.18, height: 0.44, unit: "ratio" }
          },
          {
            label: "nature",
            confidence: 0.88,
            bounding_box: { x: 0.02, y: 0.58, width: 0.94, height: 0.34, unit: "ratio" }
          }
        ]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/asr") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-asr");
      const text = "Local deterministic ASR transcript from Mindory local model service.";
      writeJson(response, 200, {
        model,
        text,
        segments: [
          {
            segment_index: 0,
            text,
            start_ms: 0,
            end_ms: 1000,
            confidence: 0.98
          }
        ],
        duration_seconds: 1
      });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/faces/detect" || url.pathname === "/faces/recognize")) {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-face");
      writeJson(response, 200, {
        model,
        faces: deterministicFaces(model)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/chat/completions") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-chat");
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const lastUserMessage = [...messages].reverse().find((message) => message?.role === "user")?.content ?? "";
      writeJson(response, 200, {
        model,
        choices: [
          {
            message: {
              role: "assistant",
              content: `local model response: ${lastUserMessage}`
            }
          }
        ],
        usage: {
          prompt_tokens: tokenEstimate(messages.map((message) => message?.content ?? "").join(" ")),
          completion_tokens: tokenEstimate(lastUserMessage),
          total_tokens: tokenEstimate(messages.map((message) => message?.content ?? "").join(" ")) + tokenEstimate(lastUserMessage)
        }
      });
      return;
    }

    writeJson(response, 404, {
      error: "not_found"
    });
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : "local_model_error"
    });
  }
});

server.listen(port, host, () => {
  console.log(`Mindory local model server listening on ${host}:${port}`);
});

function deterministicEmbedding(text, model, dimensions) {
  const embedding = [];
  let counter = 0;
  while (embedding.length < dimensions) {
    const digest = createHash("sha256").update(`${model}\0${text}\0${counter}`).digest();
    for (let offset = 0; offset <= digest.length - 4 && embedding.length < dimensions; offset += 4) {
      const value = digest.readUInt32BE(offset);
      embedding.push((value / 0xffffffff) * 2 - 1);
    }
    counter += 1;
  }
  return embedding;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(body.trim() === "" ? {} : JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(body));
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tokenEstimate(text) {
  return Math.max(1, Math.ceil(String(text).trim().split(/\s+/).filter(Boolean).length * 1.3));
}

function deterministicFaces(model) {
  return [0, 1, 2].map((index) => ({
    bounding_box: {
      x: 0.1 + index * 0.22,
      y: 0.2,
      width: 0.16,
      height: 0.32,
      unit: "ratio"
    },
    embedding: deterministicEmbedding(`face:${model}:${index}`, model, 512),
    confidence: 0.97,
    label: `local-face-${index + 1}`
  }));
}
