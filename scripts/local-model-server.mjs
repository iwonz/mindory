import { createHash } from "node:crypto";
import http from "node:http";
import { deflateSync } from "node:zlib";

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
        generation: true,
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

    if (request.method === "POST" && url.pathname === "/generation/image") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-image-generation");
      const prompt = stringOrDefault(body.prompt, "mindory image");
      const media = deterministicPng(`image:${model}:${prompt}`);
      writeJson(response, 200, {
        model,
        data_base64: media.toString("base64"),
        mime_type: "image/png",
        metadata: {
          prompt,
          generator: "mindory-local-model",
          width: 64,
          height: 64
        },
        usage: {
          image_count: 1,
          prompt_tokens: tokenEstimate(prompt),
          total_tokens: tokenEstimate(prompt)
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/generation/audio") {
      const body = await readJson(request);
      const model = stringOrDefault(body.model, "mindory-local-audio-generation");
      const prompt = stringOrDefault(body.prompt, "mindory audio");
      const durationSeconds = 1;
      const media = deterministicWav(`audio:${model}:${prompt}`, durationSeconds);
      writeJson(response, 200, {
        model,
        data_base64: media.toString("base64"),
        mime_type: "audio/wav",
        duration_seconds: durationSeconds,
        metadata: {
          prompt,
          generator: "mindory-local-model",
          sampleRate: 16000,
          channels: 1
        },
        usage: {
          audio_seconds: durationSeconds,
          prompt_tokens: tokenEstimate(prompt),
          total_tokens: tokenEstimate(prompt)
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

function deterministicPng(text) {
  const width = 64;
  const height = 64;
  const seed = createHash("sha256").update(text).digest();
  const bytesPerPixel = 3;
  const scanlineLength = 1 + width * bytesPerPixel;
  const pixels = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * scanlineLength;
    pixels[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * bytesPerPixel;
      const wave = ((x ^ y) + seed[(x + y) % seed.length]) % 256;
      pixels[offset] = (seed[0] + x * 3 + wave) % 256;
      pixels[offset + 1] = (seed[1] + y * 5 + wave) % 256;
      pixels[offset + 2] = (seed[2] + x * 2 + y * 2 + wave) % 256;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function deterministicWav(text, durationSeconds) {
  const seed = createHash("sha256").update(text).digest();
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  const pcm = Buffer.alloc(dataSize);
  const frequency = 220 + (seed[0] % 50) * 8;
  const overtone = 440 + (seed[1] % 40) * 11;

  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleRate;
    const envelope = Math.min(1, index / 400) * Math.min(1, (sampleCount - index) / 400);
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.36
      + Math.sin(2 * Math.PI * overtone * t) * 0.12;
    const value = Math.max(-1, Math.min(1, sample * envelope));
    pcm.writeInt16LE(Math.round(value * 0x7fff), index * 2);
  }

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crc32Table = new Uint32Array(256);
for (let index = 0; index < crc32Table.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crc32Table[index] = value >>> 0;
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
