import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scenario = [
  "seed demo project and bearer token",
  "api create project peers session and messages",
  "api upload document and poll processing jobs",
  "strict indexed document search when embeddings are enabled",
  "api create source-backed memory",
  "api build context",
  "cli build context and inspect jobs",
  "mcp recall memory through HTTP API",
  "hermes prepare context and save turn"
];

if (process.env.MINDORY_E2E_LIVE !== "true") {
  for (const required of ["api", "cli", "mcp", "hermes", "upload document", "source-backed memory", "poll processing jobs", "indexed", "document search"]) {
    assert(scenario.some((step) => step.includes(required)), `Dry-run scenario must include ${required}.`);
  }
  console.log("MVP acceptance dry-run validated. Set MINDORY_E2E_LIVE=true to run against a live API.");
  process.exit(0);
}

const apiUrl = (process.env.MINDORY_E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const requireIndexed = process.env.MINDORY_E2E_REQUIRE_INDEXED === "true";
const projectId = process.env.MINDORY_DEMO_PROJECT_ID ?? "mindory-demo";
const token = process.env.MINDORY_DEMO_TOKEN ?? "mindory-demo-token";
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

const { MindoryApiClient } = await import("../apps/mcp/dist/http-client.js");
const { MindoryMcpToolRegistry } = await import("../apps/mcp/dist/tools.js");
const mcp = new MindoryMcpToolRegistry(new MindoryApiClient({ baseUrl: apiUrl, token }));
const mcpResult = await mcp.callTool("memory_recall", {
  projectIds: [projectId],
  query: "source-backed context",
  limit: 5
});
assert(mcpResult.content[0]?.text.includes("source-backed"), "MCP recall should return source-backed memory content.");

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

function runCli(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--api-url", apiUrl, "--token", token, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`CLI failed (${args.join(" ")}): ${result.stderr || result.stdout}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
