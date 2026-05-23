import type { HealthResponse, Message, Peer, Project, Session, StoredConnection } from "./types.js";

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

  private async request<T>(method: string, path: string, options: { auth?: boolean } = {}): Promise<T> {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(normalizedPath, apiBaseUrl(this.connection.apiUrl));
    const headers = new Headers({ accept: "application/json" });
    if (options.auth !== false) {
      headers.set("authorization", `Bearer ${this.connection.token}`);
    }
    const response = await fetch(url, { method, headers });
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
