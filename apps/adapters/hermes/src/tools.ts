import type { MindoryHermesAdapter } from "./adapter.js";
import type { HermesIdentityInput } from "./identity.js";
import { queryString } from "./http-client.js";

export interface HermesToolInput extends HermesIdentityInput {
  query?: string;
  text?: string;
  memoryId?: string;
  documentId?: string;
  faceIdentityId?: string;
  targetFaceIdentityId?: string;
  label?: string | null;
  sourceRefs?: Array<{ type: string; id: string }>;
  artifactTypes?: string[];
  spanTypes?: string[];
  metadataFilters?: Array<Record<string, unknown>>;
  stages?: string[];
  reason?: string;
  requestId?: string;
  status?: string;
  limit?: number;
}

export interface MindoryHermesTools {
  memor_recall(input: HermesToolInput): Promise<unknown>;
  memor_remember(input: HermesToolInput): Promise<unknown>;
  memor_document_search(input: HermesToolInput): Promise<unknown>;
  memor_artifact_search(input: HermesToolInput): Promise<unknown>;
  memor_document_read(input: HermesToolInput): Promise<unknown>;
  memor_document_status(input: HermesToolInput): Promise<unknown>;
  memor_document_reprocess(input: HermesToolInput): Promise<unknown>;
  memor_face_identities(input: HermesToolInput): Promise<unknown>;
  memor_face_observations(input: HermesToolInput): Promise<unknown>;
  memor_face_rename(input: HermesToolInput): Promise<unknown>;
  memor_face_merge(input: HermesToolInput): Promise<unknown>;
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
        limit: input.limit ?? 10,
        metadataFilters: input.metadataFilters
      });
    },
    async memor_artifact_search(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.postJson("/v1/artifacts/search", {
        projectIds: [identity.projectId],
        query: requireToolText(input, "query"),
        artifactTypes: input.artifactTypes,
        spanTypes: input.spanTypes,
        metadataFilters: input.metadataFilters,
        limit: input.limit ?? 10
      });
    },
    async memor_document_read(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.getJson(`/v1/documents/${encodeURIComponent(requireToolText(input, "documentId"))}?projectId=${encodeURIComponent(identity.projectId)}`);
    },
    async memor_document_status(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.getJson(`/v1/documents/${encodeURIComponent(requireToolText(input, "documentId"))}/status?projectId=${encodeURIComponent(identity.projectId)}`);
    },
    async memor_document_reprocess(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.postJson(`/v1/documents/${encodeURIComponent(requireToolText(input, "documentId"))}/recompute`, {
        projectId: identity.projectId,
        stages: input.stages,
        reason: input.reason,
        requestId: input.requestId
      });
    },
    async memor_face_identities(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.getJson(`/v1/faces/identities?${queryString({
        projectId: identity.projectId,
        status: input.status,
        limit: input.limit
      })}`);
    },
    async memor_face_observations(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.getJson(`/v1/faces/observations?${queryString({
        projectId: identity.projectId,
        identityId: input.faceIdentityId,
        documentId: input.documentId,
        limit: input.limit
      })}`);
    },
    async memor_face_rename(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.patchJson(`/v1/faces/identities/${encodeURIComponent(requireToolText(input, "faceIdentityId"))}`, {
        projectId: identity.projectId,
        label: input.label ?? null
      });
    },
    async memor_face_merge(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.postJson(`/v1/faces/identities/${encodeURIComponent(requireToolText(input, "faceIdentityId"))}/merge`, {
        projectId: identity.projectId,
        targetIdentityId: requireToolText(input, "targetFaceIdentityId")
      });
    },
    async memor_explain(input) {
      const identity = await adapter.ensureProjectPeerSession(input);
      return adapter.api.postJson(`/v1/memories/${encodeURIComponent(requireToolText(input, "memoryId"))}/explain`, {
        projectId: identity.projectId
      });
    }
  };
}

function requireToolText(input: HermesToolInput, key: "documentId" | "faceIdentityId" | "memoryId" | "query" | "targetFaceIdentityId" | "text"): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}
