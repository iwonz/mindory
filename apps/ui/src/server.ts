import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(packageRoot, "dist");
const host = process.env.MINDORY_UI_HOST ?? "127.0.0.1";
const port = parseInteger(process.env.MINDORY_UI_PORT ?? "3080", "MINDORY_UI_PORT");
const apiUrl = trimTrailingSlash(process.env.MINDORY_UI_API_URL ?? "http://localhost:3000");

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "ui_server_error", message: error instanceof Error ? error.message : String(error) }));
  });
});

server.listen(port, host, () => {
  console.log(`Mindory UI listening on http://${host}:${port}`);
  console.log(`Proxying /api to ${apiUrl}`);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "mindory-ui" }));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
    await proxyApi(request, response, url);
    return;
  }
  serveStatic(url.pathname, response);
}

async function proxyApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const apiPath = url.pathname === "/api" ? "/" : url.pathname.slice("/api".length);
  const target = `${apiUrl}${apiPath}${url.search}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || ["host", "connection", "content-length"].includes(key.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }

  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : request;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      duplex: body === undefined ? undefined : "half"
    } as RequestInit);
  } catch (error) {
    if (apiPath === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "unavailable",
        service: "mindory-api",
        message: error instanceof Error ? error.message : String(error)
      }));
      return;
    }
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({
      error: "api_proxy_unavailable",
      message: error instanceof Error ? error.message : String(error)
    }));
    return;
  }

  response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  if (upstream.body === null) {
    response.end();
    return;
  }
  const bytes = Buffer.from(await upstream.arrayBuffer());
  response.end(bytes);
}

function serveStatic(pathname: string, response: ServerResponse): void {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolved = path.resolve(distRoot, relativePath);
  if (!resolved.startsWith(`${distRoot}${path.sep}`) || !existsSync(resolved) || !statSync(resolved).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": contentType(resolved) });
  createReadStream(resolved).pipe(response);
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath);
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
