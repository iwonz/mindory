#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const token = "mcp-smoke-token";

const fakeApi = await startFakeMindoryApi();
const client = new Client({
  name: "mindory-mcp-smoke",
  version: "0.0.0"
}, {
  capabilities: {}
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["apps/mcp/dist/stdio.js"],
  cwd: root,
  env: {
    ...process.env,
    MINDORY_MCP_ENABLED: "true",
    MINDORY_MCP_TRANSPORT: "stdio",
    MINDORY_MCP_API_URL: fakeApi.baseUrl,
    MINDORY_MCP_API_TOKEN: token
  },
  stderr: "pipe"
});
let stderr = "";
transport.stderr?.setEncoding("utf8");
transport.stderr?.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await withTimeout(client.connect(transport), "MCP stdio initialize", 10_000);

  const listed = await withTimeout(client.listTools(), "MCP tools/list", 10_000);
  const toolNames = new Set(listed.tools.map((tool) => tool.name));
  for (const requiredTool of [
    "document_upload",
    "document_search",
    "document_reprocess",
    "artifact_search",
    "face_identity_list",
    "memory_remember",
    "memory_recall",
    "context_build",
    "job_get",
    "job_list",
    "job_retry"
  ]) {
    assert.ok(toolNames.has(requiredTool), `MCP stdio server must expose ${requiredTool}.`);
  }

  const recalled = await withTimeout(client.callTool({
    name: "memory_recall",
    arguments: {
      projectIds: ["mcp-smoke"],
      query: "source-backed smoke memory",
      limit: 1
    }
  }), "MCP tools/call memory_recall", 10_000);
  assert.equal(recalled.isError, undefined, `memory_recall should succeed. stderr: ${stderr}`);
  const text = recalled.content.find((item) => item.type === "text")?.text ?? "";
  assert.match(text, /source-backed smoke memory/, "memory_recall should return fake API response text.");
  assert.equal(fakeApi.requests.length, 1, "MCP tool call should reach the HTTP API exactly once.");
  assert.equal(fakeApi.requests[0]?.pathname, "/v1/memories/search");
  assert.equal(fakeApi.requests[0]?.authorization, `Bearer ${token}`);

  const artifactSearch = await withTimeout(client.callTool({
    name: "artifact_search",
    arguments: {
      projectIds: ["mcp-smoke"],
      query: "passport airport",
      artifactTypes: ["ocr_text"],
      metadataFilters: [{ key: "extension", valueText: "png" }],
      limit: 2
    }
  }), "MCP tools/call artifact_search", 10_000);
  assert.equal(artifactSearch.isError, undefined, `artifact_search should succeed. stderr: ${stderr}`);
  assert.equal(fakeApi.requests.at(-1)?.pathname, "/v1/artifacts/search");

  console.log("MCP stdio spawn smoke scenario passed.");
} finally {
  await client.close().catch(() => undefined);
  await fakeApi.close();
}

function startFakeMindoryApi() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await readRequestBody(request);
    requests.push({
      method: request.method,
      pathname: url.pathname,
      authorization: request.headers.authorization,
      body: body.length > 0 ? JSON.parse(body) : null
    });

    if (request.method === "POST" && url.pathname === "/v1/memories/search") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        hits: [
          {
            id: "mem_mcp_smoke",
            projectId: "mcp-smoke",
            text: "source-backed smoke memory",
            score: 1,
            sourceRefs: [{ type: "message", id: "msg_mcp_smoke" }]
          }
        ]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/artifacts/search") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        hits: [
          {
            artifact_id: "artifact_mcp_smoke",
            artifact_type: "ocr_text",
            content: "passport at airport",
            source_refs: [{ type: "document", id: "doc_mcp_smoke" }]
          }
        ]
      }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found", message: "Unhandled smoke route." } }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string", "Fake API must listen on a TCP address.");
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error);
              return;
            }
            closeResolve();
          });
        })
      });
    });
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function withTimeout(promise, label, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    })
  ]).finally(() => {
    clearTimeout(timer);
  });
}
