import type {
  DocumentArtifact,
  DocumentRecord,
  HealthResponse,
  JobRetryResponse,
  Message,
  Peer,
  ProcessingJob,
  ProcessingRun,
  Project,
  RecomputeDocumentResponse,
  Session,
  StoredConnection,
  UploadDocumentResponse
} from "./types.js";

export class MindoryUiApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    message: string,
    readonly payload: unknown
  ) {
    super(message);
    this.name = "MindoryUiApiError";
  }
}

export class MindoryUiApiClient {
  constructor(private readonly connection: StoredConnection) {}

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health", { auth: false });
  }

  ready(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/ready", { auth: false });
  }

  async listProjects(limit = 100): Promise<Project[]> {
    const payload = await this.request<{ projects: Project[] }>("GET", `/v1/projects?limit=${encodeURIComponent(String(limit))}`);
    return payload.projects;
  }

  async listPeers(projectId: string, limit = 100): Promise<Peer[]> {
    const payload = await this.request<{ peers: Peer[] }>("GET", `/v1/peers?projectId=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(String(limit))}`);
    return payload.peers;
  }

  async listSessions(projectId: string, limit = 100): Promise<Session[]> {
    const payload = await this.request<{ sessions: Session[] }>("GET", `/v1/sessions?projectId=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(String(limit))}`);
    return payload.sessions;
  }

  async listMessages(projectId: string, sessionId: string, limit = 100): Promise<Message[]> {
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/messages?projectId=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(String(limit))}`;
    const payload = await this.request<{ messages: Message[] }>("GET", path);
    return payload.messages;
  }

  async listDocuments(projectId: string, limit = 100): Promise<DocumentRecord[]> {
    const payload = await this.request<{ documents: DocumentRecord[] }>("GET", `/v1/documents?projectId=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(String(limit))}`);
    return payload.documents;
  }

  async uploadDocument(input: { projectId: string; file: File; title?: string }): Promise<UploadDocumentResponse> {
    const form = new FormData();
    form.set("projectId", input.projectId);
    form.set("file", input.file);
    const title = input.title?.trim();
    if (title) {
      form.set("title", title);
    }
    return this.request<UploadDocumentResponse>("POST", "/v1/documents", { body: form });
  }

  getDocument(projectId: string, documentId: string): Promise<DocumentRecord> {
    return this.request<DocumentRecord>("GET", `/v1/documents/${encodeURIComponent(documentId)}?projectId=${encodeURIComponent(projectId)}`);
  }

  async listProcessingRuns(projectId: string, documentId: string): Promise<ProcessingRun[]> {
    const payload = await this.request<{ processing_runs: ProcessingRun[] }>("GET", `/v1/documents/${encodeURIComponent(documentId)}/processing-runs?projectId=${encodeURIComponent(projectId)}`);
    return payload.processing_runs;
  }

  async listDocumentArtifacts(projectId: string, documentId: string): Promise<DocumentArtifact[]> {
    const payload = await this.request<{ artifacts: DocumentArtifact[] }>("GET", `/v1/documents/${encodeURIComponent(documentId)}/artifacts?projectId=${encodeURIComponent(projectId)}`);
    return payload.artifacts;
  }

  recomputeDocument(projectId: string, documentId: string): Promise<RecomputeDocumentResponse> {
    return this.request<RecomputeDocumentResponse>("POST", `/v1/documents/${encodeURIComponent(documentId)}/recompute`, {
      body: JSON.stringify({
        projectId,
        reason: "ui_reprocess"
      })
    });
  }

  async listJobs(projectId: string, limit = 100): Promise<ProcessingJob[]> {
    const payload = await this.request<{ jobs: ProcessingJob[] }>("GET", `/v1/jobs?projectId=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(String(limit))}`);
    return payload.jobs;
  }

  retryJob(projectId: string, jobId: string): Promise<JobRetryResponse> {
    return this.request<JobRetryResponse>("POST", `/v1/jobs/${encodeURIComponent(jobId)}/retry`, {
      body: JSON.stringify({ projectId })
    });
  }

  private async request<T>(method: string, path: string, options: { auth?: boolean; body?: BodyInit } = {}): Promise<T> {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(normalizedPath, apiBaseUrl(this.connection.apiUrl));
    const headers = new Headers({ accept: "application/json" });
    if (typeof options.body === "string") {
      headers.set("content-type", "application/json");
    }
    if (options.auth !== false) {
      headers.set("authorization", `Bearer ${this.connection.token}`);
    }
    const response = await fetch(url, { method, headers, body: options.body });
    const payload = await parsePayload(response);
    if (!response.ok) {
      throw new MindoryUiApiError(response.status, method, path, errorMessage(response.status, payload), payload);
    }
    return payload as T;
  }
}

async function parsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function errorMessage(status: number, payload: unknown): string {
  if (isRecord(payload) && typeof payload.message === "string") {
    return payload.message;
  }
  if (status === 401) {
    return "Authentication failed.";
  }
  if (status === 403) {
    return "This token does not have access to the requested project.";
  }
  return `Mindory API returned ${status}.`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function apiBaseUrl(value: string): string {
  return new URL(ensureTrailingSlash(value), window.location.origin).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
