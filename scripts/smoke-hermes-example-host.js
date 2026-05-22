import assert from "node:assert/strict";
import http from "node:http";
import { MindoryHermesAdapter } from "../apps/adapters/hermes/dist/adapter.js";
import { createMindoryHermesExampleHost } from "../apps/adapters/hermes/dist/example-host.js";
import { HermesMindoryApiClient } from "../apps/adapters/hermes/dist/http-client.js";

const token = "hermes-example-token";
const api = await startFakeMindoryApi();
const host = createMindoryHermesExampleHost({
  adapter: new MindoryHermesAdapter({
    apiClient: new HermesMindoryApiClient({ baseUrl: api.baseUrl, token }),
    defaults: {
      defaultProject: "default",
      defaultUserPeer: "default-user",
      defaultAgentPeer: "default-agent"
    }
  })
});

try {
  assert.deepEqual(
    host.registeredHookNames(),
    ["before_prompt", "after_response", "completed_turn"],
    "Example host must register all Mindory Hermes lifecycle hooks."
  );

  const firstTurn = await host.runTurn({
    identity: {
      projectId: "hermes-example-project",
      user: { id: "hermes-user-1" },
      agent: { id: "hermes-agent-1" },
      session: { id: "hermes-session-1" }
    },
    prompt: "Base Hermes prompt",
    userText: "Remember that I prefer source-backed Hermes answers.",
    assistantText: "I will keep answers source-backed.",
    attachments: [
      {
        id: "hermes-example-attachment",
        filename: "source-note.txt",
        mimeType: "text/plain",
        content: "Hermes users prefer source-backed answers.",
        encoding: "utf8"
      }
    ],
    metadata: {
      host: "mindory-example"
    }
  });

  assert.match(String(firstTurn.beforePrompt.prompt), /^Mindory context:/, "Example host must augment prompts with Mindory context.");
  assert.ok(isRecord(firstTurn.afterResponse.mindory), "Example host must attach saved turn metadata.");

  const contextIndex = api.requests.findIndex((request) => request.path === "/v1/context/build");
  const uploadIndex = api.requests.findIndex((request) => request.path === "/v1/documents");
  const messageIndexes = api.requests
    .map((request, index) => ({ request, index }))
    .filter((item) => item.request.path.includes("/messages"));
  assert.ok(contextIndex >= 0, "Example host must build context through the HTTP API.");
  assert.ok(uploadIndex >= 0, "Example host must upload exposed attachments through the HTTP API.");
  assert.equal(messageIndexes.length, 2, "Example host must save user and assistant turns through the HTTP API.");
  assert.ok(contextIndex < messageIndexes[0].index, "Example host must build context before saving turns.");
  assert.ok(uploadIndex < messageIndexes[0].index, "Example host must upload attachments before saving the user message.");
  assert.equal(messageIndexes[0].request.body.metadata.hermes_attachments[0].external_attachment_id, "hermes-example-attachment");

  const laterPrompt = await host.runLaterPrompt({
    identity: {
      projectId: "hermes-example-project",
      user: { id: "hermes-user-1" },
      agent: { id: "hermes-agent-1" },
      session: { id: "hermes-session-2" }
    },
    prompt: "Later Hermes prompt",
    query: "What answer style do I prefer?"
  });
  assert.match(String(laterPrompt.prompt), /source-backed Hermes answers/, "Example host must recall context in a later session.");
  const latestContextCall = api.requests.filter((request) => request.path === "/v1/context/build").at(-1);
  assert.equal(latestContextCall.body.sessionId, "sess_hermes_session_hermes-example-project_hermes-session-2");

  const completedTurn = await host.runCompletedTurn({
    identity: {
      projectId: "hermes-example-project",
      user: { id: "hermes-user-1" },
      agent: { id: "hermes-agent-1" },
      session: { id: "hermes-session-2" }
    },
    prompt: "Combined lifecycle prompt",
    userText: "Keep using source-backed Hermes answers.",
    assistantText: "Confirmed."
  });
  assert.ok(isRecord(completedTurn.mindory), "Example host completed_turn must attach lifecycle metadata.");

  for (const request of api.requests) {
    assert.equal(request.authorization, `Bearer ${token}`, `Example host API request ${request.path} must include bearer auth.`);
  }

  host.uninstall();
  assert.deepEqual(host.registeredHookNames(), [], "Example host uninstall must remove registered hooks.");

  console.log("Hermes example host smoke scenario passed.");
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
            sourceRefs: [{ type: "memory", id: "mem_hermes_example" }]
          }
        ],
        debug: { memoryHits: 1 }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/documents") {
      assert.ok(contentType.includes("multipart/form-data"), "Example host attachment upload must use multipart/form-data.");
      json(response, {
        document: {
          id: "doc_hermes_example",
          project_id: "hermes-example-project"
        },
        scan_job: {
          id: "job_hermes_example_scan"
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
        id: body.role === "assistant" ? "msg_hermes_example_assistant" : "msg_hermes_example_user",
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
      assert.ok(address && typeof address !== "string", "Example host API must listen on a TCP address.");
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
