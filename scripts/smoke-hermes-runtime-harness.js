import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MindoryHermesAdapter } from "../apps/adapters/hermes/dist/adapter.js";
import { HermesMindoryApiClient } from "../apps/adapters/hermes/dist/http-client.js";
import { MindoryHermesRuntimeBridge } from "../apps/adapters/hermes/dist/runtime-contract.js";
import { installMindoryHermesRuntime } from "../apps/adapters/hermes/dist/runtime-integration.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(await readFile(path.join(root, "apps/adapters/hermes/fixtures/runtime-contract.json"), "utf8"));
const token = "hermes-harness-token";
const api = await startFakeMindoryApi();
const runtime = createFakeCompatibleHermesRuntime();
const bridge = new MindoryHermesRuntimeBridge(new MindoryHermesAdapter({
  apiClient: new HermesMindoryApiClient({ baseUrl: api.baseUrl, token }),
  defaults: {
    defaultProject: "default",
    defaultUserPeer: "default-user",
    defaultAgentPeer: "default-agent"
  }
}));
const integration = installMindoryHermesRuntime(runtime, { bridge });

try {
  assert.deepEqual(
    integration.registrations.map((registration) => registration.hookName),
    ["before_prompt", "after_response", "completed_turn"],
    "Mindory Hermes integration must register all runtime lifecycle hooks."
  );

  const beforePromptPayload = await runtime.emit("before_prompt", {
    ...fixture.turn,
    prompt: "Hermes base prompt"
  });
  assert.match(beforePromptPayload.prompt, /^Mindory context:/, "before_prompt must prefix the Hermes prompt with Mindory context.");
  assert.match(beforePromptPayload.prompt, /Hermes base prompt/, "before_prompt must preserve the original Hermes prompt.");
  assert.equal(beforePromptPayload.mindory.promptContext.identity.projectId, "hermes-contract-project");
  assert.ok(beforePromptPayload.context.some((item) => item.source === "mindory"), "before_prompt must expose a Mindory context block.");

  await runtime.emit("after_response", fixture.turn);
  const contextIndex = api.requests.findIndex((request) => request.path === "/v1/context/build");
  const uploadIndex = api.requests.findIndex((request) => request.path === "/v1/documents");
  const messageIndexes = api.requests
    .map((request, index) => ({ request, index }))
    .filter((item) => item.request.path.includes("/messages"));
  assert.ok(contextIndex >= 0, "Hermes runtime before_prompt must call context build.");
  assert.ok(uploadIndex >= 0, "Hermes runtime after_response must upload exposed attachments.");
  assert.equal(messageIndexes.length, 2, "Hermes runtime after_response must save user and assistant turns.");
  assert.ok(contextIndex < messageIndexes[0].index, "Mindory context must be built before the first saved turn.");
  assert.ok(uploadIndex < messageIndexes[0].index, "Hermes attachments must upload before the user message is saved.");

  const userMessage = messageIndexes[0].request.body;
  assert.equal(userMessage.metadata.hermes_attachments[0].external_attachment_id, "hermes-attachment-1");
  assert.ok(userMessage.metadata.uploaded_attachments[0].document.id, "Saved user message must preserve uploaded attachment response.");

  const laterPromptPayload = await runtime.emit("before_prompt", {
    ...fixture.later_prompt,
    prompt: "Later Hermes prompt"
  });
  assert.match(laterPromptPayload.prompt, /source-backed Hermes answers/, "Later Hermes session must recall project-scoped context.");
  const latestContextCall = api.requests.filter((request) => request.path === "/v1/context/build").at(-1);
  assert.equal(latestContextCall.body.sessionId, "sess_hermes_session_hermes-contract-project_hermes-session-2");
  assert.equal(latestContextCall.body.projectIds[0], "hermes-contract-project");

  const completedTurnPayload = await runtime.emit("completed_turn", {
    ...fixture.later_prompt,
    userText: "Recall my Hermes answer preference.",
    assistantText: "You prefer source-backed Hermes answers.",
    prompt: "Completed turn prompt"
  });
  assert.equal(completedTurnPayload.mindory.lifecycle.identity.sessionId, "sess_hermes_session_hermes-contract-project_hermes-session-2");
  assert.ok(completedTurnPayload.mindory.lifecycle.savedTurn.userMessage, "completed_turn must save the user turn.");
  assert.ok(completedTurnPayload.mindory.lifecycle.savedTurn.assistantMessage, "completed_turn must save the assistant turn.");

  for (const request of api.requests) {
    assert.equal(request.authorization, `Bearer ${token}`, `Hermes harness API request ${request.path} must include bearer auth.`);
  }

  integration.uninstall();
  assert.equal(runtime.handlers.size, 0, "Mindory Hermes runtime uninstall must remove registered hooks.");

  console.log("Hermes fake-compatible runtime harness passed.");
} finally {
  await api.close();
}

function createFakeCompatibleHermesRuntime() {
  const handlers = new Map();
  return {
    handlers,
    registerHook(name, handler) {
      handlers.set(name, handler);
      return () => {
        handlers.delete(name);
      };
    },
    async emit(name, payload) {
      const handler = handlers.get(name);
      assert.ok(handler, `Fake Hermes runtime must have a ${name} handler.`);
      return handler(payload);
    }
  };
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
            sourceRefs: [{ type: "memory", id: "mem_hermes_harness" }]
          }
        ],
        debug: { memoryHits: 1 }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/documents") {
      assert.ok(contentType.includes("multipart/form-data"), "Hermes attachment uploads must use multipart/form-data.");
      json(response, {
        document: {
          id: "doc_hermes_harness",
          project_id: "hermes-contract-project"
        },
        scan_job: {
          id: "job_hermes_harness_scan"
        }
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
        id: body.role === "assistant" ? "msg_hermes_harness_assistant" : "msg_hermes_harness_user",
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
      assert.ok(address && typeof address !== "string", "Fake Hermes harness API must listen on a TCP address.");
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
