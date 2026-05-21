import type { MindoryApiClient, UploadDocumentInput } from "./http-client.js";

export type MindoryMcpToolName =
  | "create_session"
  | "append_message"
  | "get_session"
  | "get_session_messages"
  | "get_session_context"
  | "memory_remember"
  | "memory_recall"
  | "memory_explain"
  | "memory_forget"
  | "memory_list"
  | "document_upload"
  | "document_status"
  | "document_reprocess"
  | "document_processing_runs"
  | "document_search"
  | "document_read"
  | "document_list"
  | "artifact_search"
  | "face_identity_list"
  | "face_identity_get"
  | "face_observation_list"
  | "face_identity_rename"
  | "face_identity_merge"
  | "context_build"
  | "job_get"
  | "job_list"
  | "job_retry";

export interface McpToolDefinition {
  name: MindoryMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolTextContent {
  type: "text";
  text: string;
}

export interface McpToolCallResult {
  content: McpToolTextContent[];
  isError?: boolean;
}

export const mindoryMcpToolDefinitions: McpToolDefinition[] = [
  tool("create_session", "Create a Mindory session through the HTTP API.", {
    required: ["projectId"],
    properties: {
      projectId: stringSchema(),
      title: stringSchema(),
      peerIds: arraySchema(stringSchema()),
      source: objectSchema(),
      metadata: objectSchema()
    }
  }),
  tool("append_message", "Append a message to a Mindory session through the HTTP API.", {
    required: ["sessionId", "projectId", "authorPeerId", "role", "content"],
    properties: {
      sessionId: stringSchema(),
      projectId: stringSchema(),
      authorPeerId: stringSchema(),
      role: enumSchema(["user", "assistant", "system", "tool", "event"]),
      content: stringSchema(),
      source: objectSchema(),
      metadata: objectSchema()
    }
  }),
  tool("get_session", "Read a Mindory session through the HTTP API.", {
    required: ["sessionId", "projectId"],
    properties: {
      sessionId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("get_session_messages", "Read messages from a Mindory session through the HTTP API.", {
    required: ["sessionId", "projectId"],
    properties: {
      sessionId: stringSchema(),
      projectId: stringSchema(),
      limit: integerSchema()
    }
  }),
  tool("get_session_context", "Build prompt-ready context for a session.", {
    required: ["projectIds", "sessionId", "tokenBudget"],
    properties: contextBuildProperties()
  }),
  tool("memory_remember", "Create a manual evidence-backed MemoryClaim.", {
    required: ["projectId", "text", "sourceRefs"],
    properties: memoryRememberProperties()
  }),
  tool("memory_recall", "Search active memory claims.", {
    required: ["projectIds", "limit"],
    properties: memorySearchProperties()
  }),
  tool("memory_explain", "Explain why a memory is remembered by returning source references.", {
    required: ["memoryId", "projectId"],
    properties: {
      memoryId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("memory_forget", "Archive a memory claim.", {
    required: ["memoryId", "projectId"],
    properties: {
      memoryId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("memory_list", "List memory claims for projects using the memory search endpoint.", {
    required: ["projectIds", "limit"],
    properties: memorySearchProperties()
  }),
  tool("document_upload", "Upload a text or base64 document through the HTTP API.", {
    required: ["projectId", "filename", "mimeType", "content"],
    properties: {
      projectId: stringSchema(),
      filename: stringSchema(),
      mimeType: stringSchema(),
      content: stringSchema(),
      encoding: enumSchema(["utf8", "base64"]),
      title: stringSchema()
    }
  }),
  tool("document_status", "Read document processing status through the HTTP API.", {
    required: ["documentId", "projectId"],
    properties: {
      documentId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("document_reprocess", "Recompute derived document artifacts through the HTTP API.", {
    required: ["documentId", "projectId"],
    properties: {
      documentId: stringSchema(),
      projectId: stringSchema(),
      stages: arraySchema(stringSchema()),
      reason: stringSchema(),
      requestId: stringSchema()
    }
  }),
  tool("document_processing_runs", "List document processing runs through the HTTP API.", {
    required: ["documentId", "projectId"],
    properties: {
      documentId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("document_search", "Search document chunks through the HTTP API.", {
    required: ["projectIds", "query", "limit"],
    properties: {
      projectIds: arraySchema(stringSchema()),
      query: stringSchema(),
      limit: integerSchema(),
      metadataFilters: arraySchema(objectSchema())
    }
  }),
  tool("document_read", "Read document metadata through the HTTP API.", {
    required: ["documentId", "projectId"],
    properties: {
      documentId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("document_list", "List documents for a project through the HTTP API.", {
    required: ["projectId"],
    properties: {
      projectId: stringSchema(),
      status: stringSchema(),
      limit: integerSchema()
    }
  }),
  tool("artifact_search", "Search derived artifact text spans through the HTTP API.", {
    required: ["projectIds", "query", "limit"],
    properties: {
      projectIds: arraySchema(stringSchema()),
      query: stringSchema(),
      artifactTypes: arraySchema(stringSchema()),
      spanTypes: arraySchema(stringSchema()),
      metadataFilters: arraySchema(objectSchema()),
      limit: integerSchema()
    }
  }),
  tool("face_identity_list", "List workspace-scoped face identities through the HTTP API.", {
    required: ["projectId"],
    properties: {
      projectId: stringSchema(),
      status: enumSchema(["candidate", "confirmed", "archived"]),
      limit: integerSchema()
    }
  }),
  tool("face_identity_get", "Read a face identity through the HTTP API.", {
    required: ["identityId", "projectId"],
    properties: {
      identityId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("face_observation_list", "List face observations through the HTTP API.", {
    required: ["projectId"],
    properties: {
      projectId: stringSchema(),
      identityId: stringSchema(),
      documentId: stringSchema(),
      limit: integerSchema()
    }
  }),
  tool("face_identity_rename", "Rename or clear a face identity label through the HTTP API.", {
    required: ["identityId", "projectId", "label"],
    properties: {
      identityId: stringSchema(),
      projectId: stringSchema(),
      label: nullableStringSchema()
    }
  }),
  tool("face_identity_merge", "Merge one face identity into another through the HTTP API.", {
    required: ["sourceIdentityId", "targetIdentityId", "projectId"],
    properties: {
      sourceIdentityId: stringSchema(),
      targetIdentityId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("context_build", "Build prompt-ready context from session, memory and document evidence.", {
    required: ["projectIds", "tokenBudget"],
    properties: contextBuildProperties()
  }),
  tool("job_get", "Read a processing job through the HTTP API.", {
    required: ["jobId", "projectId"],
    properties: {
      jobId: stringSchema(),
      projectId: stringSchema()
    }
  }),
  tool("job_list", "List processing jobs for a project through the HTTP API.", {
    required: ["projectId"],
    properties: {
      projectId: stringSchema(),
      status: stringSchema(),
      type: stringSchema(),
      limit: integerSchema()
    }
  }),
  tool("job_retry", "Retry a processing job through the HTTP API.", {
    required: ["jobId", "projectId"],
    properties: {
      jobId: stringSchema(),
      projectId: stringSchema()
    }
  })
];

export class MindoryMcpToolRegistry {
  readonly api: MindoryApiClient;

  constructor(api: MindoryApiClient) {
    this.api = api;
  }

  listTools(): McpToolDefinition[] {
    return mindoryMcpToolDefinitions;
  }

  async callTool(name: string, args: unknown): Promise<McpToolCallResult> {
    if (!isMindoryToolName(name)) {
      return mcpTextResult({ code: "unknown_tool", message: `Unknown Mindory MCP tool: ${name}` }, true);
    }

    try {
      return mcpTextResult(await callMindoryTool(this.api, name, readObject(args)));
    } catch (error) {
      return mcpTextResult({
        code: "tool_call_failed",
        message: error instanceof Error ? error.message : String(error)
      }, true);
    }
  }
}

export async function callMindoryTool(
  api: MindoryApiClient,
  name: MindoryMcpToolName,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "create_session":
      return api.postJson("/v1/sessions", args);
    case "append_message": {
      const sessionId = requiredString(args, "sessionId");
      return api.postJson(`/v1/sessions/${encodeURIComponent(sessionId)}/messages`, withoutKeys(args, ["sessionId"]));
    }
    case "get_session":
      return api.getJson(`/v1/sessions/${encodeURIComponent(requiredString(args, "sessionId"))}?${projectQuery(args)}`);
    case "get_session_messages": {
      const sessionId = requiredString(args, "sessionId");
      return api.getJson(`/v1/sessions/${encodeURIComponent(sessionId)}/messages?${queryString({
        projectId: requiredString(args, "projectId"),
        limit: optionalString(args, "limit")
      })}`);
    }
    case "get_session_context":
    case "context_build":
      return api.postJson("/v1/context/build", args);
    case "memory_remember":
      return api.postJson("/v1/memories", args);
    case "memory_recall":
    case "memory_list":
      return api.postJson("/v1/memories/search", args);
    case "memory_explain":
      return api.postJson(`/v1/memories/${encodeURIComponent(requiredString(args, "memoryId"))}/explain`, {
        projectId: requiredString(args, "projectId")
      });
    case "memory_forget":
      return api.deleteJson(`/v1/memories/${encodeURIComponent(requiredString(args, "memoryId"))}?${projectQuery(args)}`);
    case "document_upload":
      return api.uploadDocument(readUploadDocumentInput(args));
    case "document_status":
      return api.getJson(`/v1/documents/${encodeURIComponent(requiredString(args, "documentId"))}/status?${projectQuery(args)}`);
    case "document_reprocess":
      return api.postJson(`/v1/documents/${encodeURIComponent(requiredString(args, "documentId"))}/recompute`, withoutKeys(args, ["documentId"]));
    case "document_processing_runs":
      return api.getJson(`/v1/documents/${encodeURIComponent(requiredString(args, "documentId"))}/processing-runs?${projectQuery(args)}`);
    case "document_search":
      return api.postJson("/v1/documents/search", args);
    case "document_read":
      return api.getJson(`/v1/documents/${encodeURIComponent(requiredString(args, "documentId"))}?${projectQuery(args)}`);
    case "document_list":
      return api.getJson(`/v1/documents?${queryString({
        projectId: requiredString(args, "projectId"),
        status: optionalString(args, "status"),
        limit: optionalString(args, "limit")
      })}`);
    case "artifact_search":
      return api.postJson("/v1/artifacts/search", args);
    case "face_identity_list":
      return api.getJson(`/v1/faces/identities?${queryString({
        projectId: requiredString(args, "projectId"),
        status: optionalString(args, "status"),
        limit: optionalString(args, "limit")
      })}`);
    case "face_identity_get":
      return api.getJson(`/v1/faces/identities/${encodeURIComponent(requiredString(args, "identityId"))}?${projectQuery(args)}`);
    case "face_observation_list":
      return api.getJson(`/v1/faces/observations?${queryString({
        projectId: requiredString(args, "projectId"),
        identityId: optionalString(args, "identityId"),
        documentId: optionalString(args, "documentId"),
        limit: optionalString(args, "limit")
      })}`);
    case "face_identity_rename":
      return api.patchJson(`/v1/faces/identities/${encodeURIComponent(requiredString(args, "identityId"))}`, {
        projectId: requiredString(args, "projectId"),
        label: nullableString(args, "label")
      });
    case "face_identity_merge":
      return api.postJson(`/v1/faces/identities/${encodeURIComponent(requiredString(args, "sourceIdentityId"))}/merge`, {
        projectId: requiredString(args, "projectId"),
        targetIdentityId: requiredString(args, "targetIdentityId")
      });
    case "job_get":
      return api.getJson(`/v1/jobs/${encodeURIComponent(requiredString(args, "jobId"))}?${projectQuery(args)}`);
    case "job_list":
      return api.getJson(`/v1/jobs?${queryString({
        projectId: requiredString(args, "projectId"),
        status: optionalString(args, "status"),
        type: optionalString(args, "type"),
        limit: optionalString(args, "limit")
      })}`);
    case "job_retry":
      return api.postJson(`/v1/jobs/${encodeURIComponent(requiredString(args, "jobId"))}/retry`, {
        projectId: requiredString(args, "projectId")
      });
  }

  throw new Error(`Unhandled Mindory MCP tool: ${name}`);
}

export function mcpTextResult(value: unknown, isError = false): McpToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ],
    ...(isError ? { isError: true } : {})
  };
}

function tool(name: MindoryMcpToolName, description: string, schema: { required?: string[]; properties: Record<string, unknown> }): McpToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: schema.required ?? [],
      properties: schema.properties
    }
  };
}

function contextBuildProperties(): Record<string, unknown> {
  return {
    projectIds: arraySchema(stringSchema()),
    sessionId: stringSchema(),
    query: stringSchema(),
    tokenBudget: integerSchema(),
    include: objectSchema()
  };
}

function memoryRememberProperties(): Record<string, unknown> {
  return {
    projectId: stringSchema(),
    type: enumSchema(["semantic", "episodic", "preference", "decision", "task", "artifact_reference", "derived"]),
    text: stringSchema(),
    status: enumSchema(["candidate", "active", "rejected", "archived"]),
    importance: numberSchema(),
    confidence: numberSchema(),
    sourceRefs: arraySchema(sourceRefSchema()),
    createdSource: objectSchema(),
    createdByPeerId: stringSchema(),
    metadata: objectSchema()
  };
}

function memorySearchProperties(): Record<string, unknown> {
  return {
    projectIds: arraySchema(stringSchema()),
    query: stringSchema(),
    statuses: arraySchema(enumSchema(["candidate", "active", "rejected", "archived"])),
    types: arraySchema(enumSchema(["semantic", "episodic", "preference", "decision", "task", "artifact_reference", "derived"])),
    limit: integerSchema()
  };
}

function sourceRefSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["type", "id"],
    additionalProperties: false,
    properties: {
      type: enumSchema(["session", "message", "document", "chunk", "memory"]),
      id: stringSchema()
    }
  };
}

function stringSchema(): Record<string, unknown> {
  return { type: "string", minLength: 1 };
}

function nullableStringSchema(): Record<string, unknown> {
  return { anyOf: [stringSchema(), { type: "null" }] };
}

function integerSchema(): Record<string, unknown> {
  return { type: "integer", minimum: 1 };
}

function numberSchema(): Record<string, unknown> {
  return { type: "number", minimum: 0, maximum: 1 };
}

function objectSchema(): Record<string, unknown> {
  return { type: "object", additionalProperties: true };
}

function arraySchema(items: Record<string, unknown>): Record<string, unknown> {
  return { type: "array", items };
}

function enumSchema(values: string[]): Record<string, unknown> {
  return { type: "string", enum: values };
}

function isMindoryToolName(name: string): name is MindoryMcpToolName {
  return mindoryMcpToolDefinitions.some((toolDefinition) => toolDefinition.name === name);
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function nullableString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === null || typeof value === "string") {
    return value;
  }
  throw new Error(`${key} is required.`);
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value === "number") {
    return String(value);
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function withoutKeys(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => !keys.includes(key)));
}

function projectQuery(args: Record<string, unknown>): string {
  return queryString({ projectId: requiredString(args, "projectId") });
}

function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params.toString();
}

function readUploadDocumentInput(args: Record<string, unknown>): UploadDocumentInput {
  const encoding = args.encoding === "base64" ? "base64" : "utf8";
  const input: UploadDocumentInput = {
    projectId: requiredString(args, "projectId"),
    filename: requiredString(args, "filename"),
    mimeType: requiredString(args, "mimeType"),
    content: requiredString(args, "content"),
    encoding
  };
  if (typeof args.title === "string" && args.title.length > 0) {
    input.title = args.title;
  }
  return input;
}
