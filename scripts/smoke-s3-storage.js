import { createServer } from "node:http";
import { once } from "node:events";
import { Readable } from "node:stream";
import { S3ObjectStorage } from "../packages/storage/s3/dist/index.js";

const bucket = "mindory-smoke";
const objects = new Map();

const server = createServer(async (request, response) => {
  try {
    if (!request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) {
      response.writeHead(403);
      response.end("missing signature");
      return;
    }
    if (request.headers["x-amz-date"] === undefined || request.headers["x-amz-content-sha256"] === undefined) {
      response.writeHead(403);
      response.end("missing signed headers");
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const [, pathBucket, ...keyParts] = url.pathname.split("/");
    const key = keyParts.map(decodeURIComponent).join("/");
    if (pathBucket !== bucket || key === "") {
      response.writeHead(404);
      response.end();
      return;
    }

    if (request.method === "PUT") {
      const body = await readBody(request);
      const metadata = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (name.startsWith("x-amz-meta-") && typeof value === "string") {
          metadata[name.slice("x-amz-meta-".length)] = value;
        }
      }
      objects.set(key, {
        body,
        contentType: request.headers["content-type"] ?? "application/octet-stream",
        etag: `etag-${body.length}`,
        metadata
      });
      response.writeHead(200, { etag: `"etag-${body.length}"` });
      response.end();
      return;
    }

    const object = objects.get(key);
    if (object === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }

    if (request.method === "HEAD") {
      response.writeHead(200, objectHeaders(object));
      response.end();
      return;
    }

    if (request.method === "GET") {
      response.writeHead(200, objectHeaders(object));
      response.end(object.body);
      return;
    }

    if (request.method === "DELETE") {
      objects.delete(key);
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(405);
    response.end();
  } catch (error) {
    response.writeHead(500);
    response.end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not determine smoke S3 server port.");
  }

  const storage = new S3ObjectStorage({
    endpoint: `http://127.0.0.1:${address.port}`,
    region: "us-east-1",
    bucket,
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
    forcePathStyle: true
  });

  const put = await storage.putObject({
    key: "docs/hello.txt",
    body: "hello from s3",
    contentType: "text/plain",
    metadata: { source: "smoke" }
  });
  assert(put.sizeBytes === 13, "putObject should return object size.");
  assert(put.contentType === "text/plain", "putObject should preserve content type.");
  assert(put.metadata.source === "smoke", "putObject should preserve metadata.");

  const stat = await storage.statObject("docs/hello.txt");
  assert(stat.sizeBytes === 13, "statObject should return object size.");
  assert(await storage.objectExists("docs/hello.txt"), "objectExists should return true.");

  const get = await storage.getObject("docs/hello.txt");
  const content = await streamToString(get.body);
  assert(content === "hello from s3", "getObject should return object body.");

  await storage.deleteObject("docs/hello.txt");
  assert(!(await storage.objectExists("docs/hello.txt")), "objectExists should return false after delete.");

  let invalidKeyRejected = false;
  try {
    await storage.statObject("../bad");
  } catch {
    invalidKeyRejected = true;
  }
  assert(invalidKeyRejected, "S3 storage should reject invalid keys.");

  console.log("S3-compatible storage smoke scenario passed.");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function objectHeaders(object) {
  return {
    "content-length": String(object.body.length),
    "content-type": object.contentType,
    etag: `"${object.etag}"`,
    ...Object.fromEntries(Object.entries(object.metadata).map(([key, value]) => [`x-amz-meta-${key}`, value]))
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of Readable.from(stream)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
