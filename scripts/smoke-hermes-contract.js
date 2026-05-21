import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MindoryHermesAdapter } from "../apps/adapters/hermes/dist/adapter.js";
import { HermesMindoryApiClient } from "../apps/adapters/hermes/dist/http-client.js";
import { MindoryHermesRuntimeBridge } from "../apps/adapters/hermes/dist/runtime-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(await readFile(path.join(root, "apps/adapters/hermes/fixtures/runtime-contract.json"), "utf8"));
const token = "hermes-contract-token";
const api = await startFakeMindoryApi();
const bridge = new MindoryHermesRuntimeBridge(new MindoryHermesAdapter({
  apiClient: new HermesMindoryApiClient({ baseUrl: api.baseUrl, token }),
  defaults: {
    defaultProject: "default",
    defaultUserPeer: "default-user",
    defaultAgentPeer: "default-agent"
  }
}));

try {
  assert.equal(fixture.captured_at, "2026-05-21", "Hermes contract fixture must record its capture date.");
  assert.equal(fixture.source.type, "local_contract_fixture", "Hermes contract fixture must document its source.");

  const identityA = bridge.mapIdentity(fixture.identity);
  const identityB = bridge.mapIdentity(fixture.identity);
  assert.deepEqual(identityA, identityB, "Identity mapping must be deterministic for the same Hermes ids.");
  assert.equal(identityA.projectId, "hermes-contract-project");
  assert.equal(identityA.externalUserId, "hermes-user-1");
  assert.equal(identityA.agentId, "hermes-agent-1");

  await bridge.beforePrompt(fixture.turn);
  await bridge.afterResponse(fixture.turn);

  const contextIndex = api.requests.findIndex((request) => request.path === "/v1/context/build");
  const uploadIndex = api.requests.findIndex((request) => request.path === "/v1/documents");
  const messageIndexes = api.requests
    .map((request, index) => ({ request, index }))
    .filter((item) => item.request.path.includes("/messages"));
  assert.ok(contextIndex >= 0, "Hermes before_prompt must build context through the API.");
  assert.ok(uploadIndex >= 0, "Hermes after_response must upload exposed attachments.");
  assert.equal(messageIndexes.length, 2, "Hermes after_response must save user and assistant messages.");
  assert.ok(contextIndex < messageIndexes[0].index, "Context must be prepared before saved messages.");
  assert.ok(uploadIndex < messageIndexes[0].index, "Attachments must upload before the user message is saved.");

  const userMessage = messageIndexes[0].request.body;
  const assistantMessage = messageIndexes[1].request.body;
  assert.equal(userMessage.role, "user");
  assert.equal(assistantMessage.role, "assistant");
  assert.equal(userMessage.metadata.hermes_attachments[0].external_attachment_id, "hermes-attachment-1");
  assert.ok(userMessage.metadata.uploaded_attachments[0].document.id, "Saved user message must preserve uploaded attachment response.");

  const laterContext = await bridge.beforePrompt(fixture.later_prompt);
  assert.match(laterContext.promptPrefix, /source-backed Hermes answers/, "Later Hermes sessions must recall project-scoped context.");
  const latestContextCall = api.requests.filter((request) => request.path === "/v1/context/build").at(-1);
  assert.equal(latestContextCall.body.projectIds[0], "hermes-contract-project");
  assert.equal(latestContextCall.body.include.memories, true);
  assert.equal(latestContextCall.body.include.documents, true);

  const toolResult = await bridge.tools().memor_recall({
    projectId: "hermes-contract-project",
    externalUserId: "hermes-user-1",
    agentId: "hermes-agent-1",
    externalSessionId: "hermes-session-2",
    query: "source-backed Hermes answers",
    limit: 3
  });
  assert.ok(JSON.stringify(toolResult).includes("source-backed Hermes answers"), "Hermes recall tool must call memory search through the API.");

  for (const request of api.requests) {
    assert.equal(request.authorization, `Bearer ${token}`, `Hermes API request ${request.path} must include bearer auth.`);
  }

  console.log("Hermes runtime contract smoke scenario passed.");
} finally {
  await api.close();
}

function startFakeMindoryApi() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const contentType = request.headers["content-type"] ?? "";
    const rawBody = await readRequestBody(request);
    const body = contentType.includes("application/json") && rawBody.length > 0 ? JSON.parse(rawBody) : null;
    requests.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.authorization,
      contentType,
      body
    });

    if (request.method === "POST" && url.pathname === "/v1/context/build") {
      json(response, {
        blocks: [
          {
            type: "memory",
            content: "The user prefers source-backed Hermes answers.",
            sourceRefs: [{ type: "memory", id: "mem_hermes_contract" }]
          }
        ],
        debug: { memoryHits: 1 }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/documents") {
      assert.ok(contentType.includes("multipart/form-data"), "Attachment uploads must use multipart/form-data.");
      json(response, {
        document: {
          id: "doc_hermes_contract",
          project_id: "hermes-contract-project"
        },
        scan_job: {
          id: "job_hermes_contract_scan"
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/memories/search") {
      json(response, {
        hits: [
          {
            id: "mem_hermes_contract",
            text: "source-backed Hermes answers",
            sourceRefs: [{ type: "message", id: "msg_hermes_contract_user" }]
          }
        ]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/projects") {
      json(response, { id: body.id, name: body.name });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/peers") {
      json(response, { id: body.id, project_id: body.projectId });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/sessions") {
      json(response, { id: body.id, project_id: body.projectId });
      return;
    }

    if (request.method === "POST" && url.pathname.includes("/messages")) {
      json(response, {
        id: body.role === "assistant" ? "msg_hermes_contract_assistant" : "msg_hermes_contract_user",
        ...body
      });
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found", message: `Unhandled route ${request.method} ${url.pathname}.` } }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string", "Fake Hermes contract API must listen on a TCP address.");
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

function json(response, body) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
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
