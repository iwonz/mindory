import { MindoryHermesAdapter } from "../apps/adapters/hermes/dist/adapter.js";
import { buildMindoryHermesTools } from "../apps/adapters/hermes/dist/tools.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

class RecordingHermesApi {
  calls = [];
  uploadCount = 0;

  async getJson(path) {
    this.calls.push({ method: "GET", path });
    return { ok: true };
  }

  async postJson(path, body) {
    this.calls.push({ method: "POST", path, body });
    if (path === "/v1/context/build") {
      return {
        blocks: [
          {
            type: "memory",
            content: "User prefers source-backed answers.",
            sourceRefs: [{ type: "memory", id: "mem_1" }]
          }
        ],
        debug: { memoryHits: 1 }
      };
    }
    return { ok: true };
  }

  async deleteJson(path) {
    this.calls.push({ method: "DELETE", path });
    return { ok: true };
  }

  async uploadAttachment(input) {
    this.uploadCount += 1;
    this.calls.push({ method: "UPLOAD", path: "/v1/documents", input });
    return {
      document: {
        id: `doc_${this.uploadCount}`,
        project_id: input.projectId
      }
    };
  }
}

const api = new RecordingHermesApi();
const adapter = new MindoryHermesAdapter({
  apiClient: api,
  defaults: {
    defaultProject: "default",
    defaultUserPeer: "default-user",
    defaultAgentPeer: "default-agent"
  }
});

const lifecycle = await adapter.handleTurn({
  projectId: "p1",
  externalUserId: "user-1",
  externalSessionId: "session-1",
  agentId: "agent-1",
  userText: "Remember that I prefer source-backed answers.",
  assistantText: "Stored as evidence-backed context.",
  attachments: [
    {
      externalAttachmentId: "att-1",
      filename: "note.txt",
      mimeType: "text/plain",
      content: "hello",
      encoding: "utf8"
    }
  ]
});

assert(lifecycle.promptContext.promptPrefix.includes("Mindory context:"), "Lifecycle must format prompt context.");

const contextIndex = api.calls.findIndex((call) => call.path === "/v1/context/build");
const uploadIndex = api.calls.findIndex((call) => call.method === "UPLOAD");
const firstMessageIndex = api.calls.findIndex((call) => call.path?.includes("/messages"));
assert(contextIndex >= 0, "Lifecycle must build context.");
assert(firstMessageIndex >= 0, "Lifecycle must save messages.");
assert(contextIndex < firstMessageIndex, "Context must be built before saving the current turn.");
assert(uploadIndex >= 0 && uploadIndex < firstMessageIndex, "Attachments must upload before the user message is saved.");

const userMessageCall = api.calls[firstMessageIndex];
assert(userMessageCall.body.metadata.hermes_attachments[0].external_attachment_id === "att-1", "Saved user message must preserve Hermes attachment metadata.");
assert(userMessageCall.body.source.actor_peer_id, "Saved message source must preserve actor peer.");
assert(userMessageCall.body.source.agent_peer_id, "Saved message source must preserve agent peer.");

await adapter.preparePromptContext({
  projectId: "p1",
  externalUserId: "user-1",
  externalSessionId: "session-2",
  agentId: "agent-1",
  query: "Recall previous context"
});
const latestContextCall = api.calls.filter((call) => call.path === "/v1/context/build").at(-1);
assert(latestContextCall.body.projectIds[0] === "p1", "Later sessions must recall project-scoped context.");
assert(latestContextCall.body.include.memories === true, "Context recall must include memories by default.");
assert(latestContextCall.body.include.documents === true, "Context recall must include documents by default.");

const tools = buildMindoryHermesTools(adapter);
const beforeToolCalls = api.calls.length;
await tools.memor_recall({
  projectId: "p1",
  externalSessionId: "tool-session",
  query: "source-backed"
});
const toolCalls = api.calls.slice(beforeToolCalls);
assert(toolCalls.some((call) => call.path === "/v1/sessions"), "Hermes tools must ensure identity before API calls.");
assert(toolCalls.some((call) => call.path === "/v1/memories/search"), "Hermes recall tool must call memory search.");

console.log("Hermes runtime smoke scenario passed.");
