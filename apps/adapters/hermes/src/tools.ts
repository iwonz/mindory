import type { MindoryHermesAdapter } from "./adapter.js";
import type { HermesIdentityInput } from "./identity.js";

export interface HermesToolInput extends HermesIdentityInput {
  query?: string;
  text?: string;
  memoryId?: string;
  documentId?: string;
  sourceRefs?: Array<{ type: string; id: string }>;
  limit?: number;
}

export interface MindoryHermesTools {
  memor_recall(input: HermesToolInput): Promise<unknown>;
  memor_remember(input: HermesToolInput): Promise<unknown>;
  memor_document_search(input: HermesToolInput): Promise<unknown>;
  memor_document_read(input: HermesToolInput): Promise<unknown>;
  memor_explain(input: HermesToolInput): Promise<unknown>;
}

export function buildMindoryHermesTools(adapter: MindoryHermesAdapter): MindoryHermesTools {
  return {
    async memor_recall(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.postJson("/v1/memories/search", {
        projectIds: [identity.projectId],
        query: input.query ?? "",
        statuses: ["active"],
        limit: input.limit ?? 10
      });
    },
    async memor_remember(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.postJson("/v1/memories", {
        projectId: identity.projectId,
        type: "semantic",
        text: requireToolText(input, "text"),
        status: "active",
        sourceRefs: input.sourceRefs ?? [{ type: "session", id: identity.sessionId }],
        createdSource: {
          type: "agent",
          integration: "hermes",
          external_id: identity.externalSessionId
        },
        createdByPeerId: identity.agentPeerId
      });
    },
    async memor_document_search(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.postJson("/v1/documents/search", {
        projectIds: [identity.projectId],
        query: requireToolText(input, "query"),
        limit: input.limit ?? 10
      });
    },
    async memor_document_read(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.getJson(`/v1/documents/${encodeURIComponent(requireToolText(input, "documentId"))}?projectId=${encodeURIComponent(identity.projectId)}`);
    },
    async memor_explain(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.postJson(`/v1/memories/${encodeURIComponent(requireToolText(input, "memoryId"))}/explain`, {
        projectId: identity.projectId
      });
    }
  };
}

function requireToolText(input: HermesToolInput, key: "documentId" | "memoryId" | "query" | "text"): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}
