import { MindoryUiApiClient, MindoryUiApiError } from "./api.js";
import { clearConnection, loadConnection, maskToken, saveConnection } from "./state.js";
import type { HealthResponse, Message, Peer, Project, Session, StoredConnection } from "./types.js";

interface ViewState {
  connection: StoredConnection;
  health: Loadable<HealthResponse>;
  projects: Loadable<Project[]>;
  peers: Loadable<Peer[]>;
  sessions: Loadable<Session[]>;
  messages: Loadable<Message[]>;
  selectedProjectId: string;
  selectedSessionId: string;
  notice: string;
}

type Loadable<T> =
  | { state: "idle"; data: T }
  | { state: "loading"; data: T }
  | { state: "ready"; data: T }
  | { state: "error"; data: T; error: DisplayError };

interface DisplayError {
  title: string;
  message: string;
  status?: number;
}

const emptyHealth: HealthResponse = {};
const appRoot = requireRoot();

const view: ViewState = {
  connection: loadConnection(),
  health: idle(emptyHealth),
  projects: idle([]),
  peers: idle([]),
  sessions: idle([]),
  messages: idle([]),
  selectedProjectId: "",
  selectedSessionId: "",
  notice: ""
};

render();
void refreshHealth();
if (view.connection.token.length > 0) {
  void refreshProjects();
}

function render(): void {
  appRoot.replaceChildren(
    el("div", { className: "app-shell" },
      renderSidebar(),
      el("main", { className: "workspace" },
        renderHealthBanner(),
        renderWorkspaceHeader(),
        el("section", { className: "workspace-grid", "aria-label": "Mindory workspace" },
          renderProjectsPanel(),
          renderSessionsPanel(),
          renderMessagesPanel()
        )
      )
    )
  );
}

function requireRoot(): HTMLElement {
  const node = document.getElementById("app");
  if (!node) {
    throw new Error("Mindory UI root element is missing.");
  }
  return node;
}

function renderSidebar(): HTMLElement {
  const apiInput = input("API URL", view.connection.apiUrl, "url");
  const tokenInput = input("Bearer token", view.connection.token, "password");
  apiInput.setAttribute("autocomplete", "url");
  tokenInput.setAttribute("autocomplete", "current-password");

  const saveButton = button("Save", "primary", () => {
    view.connection = {
      apiUrl: apiInput.value.trim() || "/api",
      token: tokenInput.value.trim()
    };
    saveConnection(view.connection);
    view.notice = `Connection saved (${maskToken(view.connection.token)}).`;
    view.projects = idle([]);
    view.sessions = idle([]);
    view.messages = idle([]);
    view.peers = idle([]);
    view.selectedProjectId = "";
    view.selectedSessionId = "";
    render();
    void refreshHealth();
    if (view.connection.token.length > 0) {
      void refreshProjects();
    }
  });

  const clearButton = button("Clear", "secondary", () => {
    view.connection = clearConnection();
    view.notice = "Connection cleared.";
    view.projects = idle([]);
    view.sessions = idle([]);
    view.messages = idle([]);
    view.peers = idle([]);
    view.selectedProjectId = "";
    view.selectedSessionId = "";
    render();
    void refreshHealth();
  });

  const refreshButton = button("Refresh", "secondary", () => {
    view.notice = "";
    render();
    void refreshHealth();
    if (view.connection.token.length > 0) {
      void refreshProjects();
    }
  });

  return el("aside", { className: "sidebar", "aria-label": "Connection" },
    el("div", { className: "brand" },
      el("div", { className: "brand-mark", "aria-hidden": "true" }, "M"),
      el("div", {},
        el("h1", {}, "Mindory"),
        el("p", {}, "Memory workspace")
      )
    ),
    el("form", { className: "connection-form" },
      hiddenInput("username", "mindory-api-token"),
      field("API URL", apiInput),
      field("Bearer token", tokenInput),
      el("div", { className: "button-row" }, saveButton, clearButton, refreshButton)
    ),
    el("dl", { className: "connection-summary" },
      el("div", {}, el("dt", {}, "Token"), el("dd", {}, maskToken(view.connection.token))),
      el("div", {}, el("dt", {}, "Projects"), el("dd", {}, countLabel(view.projects))),
      el("div", {}, el("dt", {}, "Sessions"), el("dd", {}, countLabel(view.sessions)))
    ),
    view.notice ? el("p", { className: "notice" }, view.notice) : el("p", { className: "notice muted" }, "Ready")
  );
}

function renderHealthBanner(): HTMLElement {
  const health = view.health;
  if (health.state === "loading") {
    return banner("checking", "Checking API health", "Waiting for /health.");
  }
  if (health.state === "error") {
    return banner("error", health.error.title, health.error.message);
  }
  if (health.state === "ready") {
    const status = health.data.status ?? "ok";
    const service = health.data.service ?? "mindory-api";
    return banner("ok", `${service} ${status}`, health.data.uptime_ms !== undefined ? `Uptime ${formatDuration(health.data.uptime_ms)}.` : "Health endpoint is reachable.");
  }
  return banner("idle", "API health not checked", "Save or refresh the connection.");
}

function renderWorkspaceHeader(): HTMLElement {
  const selectedProject = view.projects.data.find((project) => project.id === view.selectedProjectId);
  const selectedSession = view.sessions.data.find((session) => session.id === view.selectedSessionId);
  return el("header", { className: "workspace-header" },
    el("div", {},
      el("p", { className: "eyebrow" }, selectedProject ? selectedProject.id : "No project selected"),
      el("h2", {}, selectedSession?.title || selectedProject?.name || "Workspace")
    ),
    el("div", { className: "header-actions" },
      button("Reload", "secondary", () => {
        void refreshHealth();
        if (view.connection.token.length > 0) {
          void refreshProjects();
        }
      })
    )
  );
}

function renderProjectsPanel(): HTMLElement {
  return panel("Projects", view.projects, {
    empty: "No readable projects for this token.",
    loading: "Loading projects.",
    render: (projects) => el("div", { className: "list" }, ...projects.map((project) => {
      const selected = project.id === view.selectedProjectId;
      return rowButton(project.name, project.id, selected, () => {
        view.selectedProjectId = project.id;
        view.selectedSessionId = "";
        view.sessions = idle([]);
        view.messages = idle([]);
        view.peers = idle([]);
        render();
        void refreshProjectDetail(project.id);
      });
    }))
  });
}

function renderSessionsPanel(): HTMLElement {
  const subtitle = view.selectedProjectId ? `${view.peers.data.length} peers` : "Select a project";
  return panel(`Sessions · ${subtitle}`, view.sessions, {
    empty: view.selectedProjectId ? "No sessions found for this project." : "Choose a project to list sessions.",
    loading: "Loading sessions.",
    render: (sessions) => el("div", { className: "list" }, ...sessions.map((session) => {
      const selected = session.id === view.selectedSessionId;
      return rowButton(session.title || session.id, session.status || session.id, selected, () => {
        view.selectedSessionId = session.id;
        view.messages = idle([]);
        render();
        void refreshMessages(session.project_id, session.id);
      });
    }))
  });
}

function renderMessagesPanel(): HTMLElement {
  return panel("Messages", view.messages, {
    empty: view.selectedSessionId ? "No messages in this session." : "Choose a session to inspect messages.",
    loading: "Loading messages.",
    render: (messages) => el("div", { className: "message-list" }, ...messages.map(renderMessage))
  });
}

function renderMessage(message: Message): HTMLElement {
  return el("article", { className: "message" },
    el("div", { className: "message-meta" },
      el("span", {}, message.role),
      el("span", {}, message.author_peer_id),
      el("time", { dateTime: message.created_at ?? "" }, formatDate(message.created_at))
    ),
    el("p", {}, message.content)
  );
}

async function refreshHealth(): Promise<void> {
  view.health = loading(view.health.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const health = await client.health();
    if (health.status !== "ok" && health.status !== "ready") {
      view.health = failed(emptyHealth, {
        title: "API health is unavailable",
        message: health.message ?? `Health status is ${health.status ?? "unknown"}.`
      });
    } else {
      view.health = ready(health);
    }
  } catch (error) {
    view.health = failed(emptyHealth, toDisplayError(error, "API health is unavailable"));
  }
  render();
}

async function refreshProjects(): Promise<void> {
  if (view.connection.token.length === 0) {
    view.projects = failed([], { title: "Token required", message: "Enter a bearer token to load projects.", status: 401 });
    render();
    return;
  }
  view.projects = loading(view.projects.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const projects = await client.listProjects();
    view.projects = ready(projects);
    if (projects.length > 0 && view.selectedProjectId.length === 0) {
      view.selectedProjectId = projects[0].id;
      void refreshProjectDetail(projects[0].id);
    }
  } catch (error) {
    view.projects = failed([], toDisplayError(error, "Projects could not be loaded"));
  }
  render();
}

async function refreshProjectDetail(projectId: string): Promise<void> {
  view.peers = loading(view.peers.data);
  view.sessions = loading(view.sessions.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const [peers, sessions] = await Promise.all([
      client.listPeers(projectId),
      client.listSessions(projectId)
    ]);
    view.peers = ready(peers);
    view.sessions = ready(sessions);
    if (sessions.length > 0) {
      view.selectedSessionId = sessions[0].id;
      void refreshMessages(projectId, sessions[0].id);
    }
  } catch (error) {
    const displayError = toDisplayError(error, "Project details could not be loaded");
    view.peers = failed([], displayError);
    view.sessions = failed([], displayError);
  }
  render();
}

async function refreshMessages(projectId: string, sessionId: string): Promise<void> {
  view.messages = loading(view.messages.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    view.messages = ready(await client.listMessages(projectId, sessionId));
  } catch (error) {
    view.messages = failed([], toDisplayError(error, "Messages could not be loaded"));
  }
  render();
}

function panel<T>(title: string, loadable: Loadable<T[]>, options: { empty: string; loading: string; render: (items: T[]) => HTMLElement }): HTMLElement {
  let body: HTMLElement;
  if (loadable.state === "loading") {
    body = el("div", { className: "state loading" }, options.loading);
  } else if (loadable.state === "error") {
    body = renderError(loadable.error);
  } else if (loadable.data.length === 0) {
    body = el("div", { className: "state empty" }, options.empty);
  } else {
    body = options.render(loadable.data);
  }
  return el("section", { className: "panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, title),
      el("span", {}, loadable.state === "ready" ? `${loadable.data.length}` : loadable.state)
    ),
    body
  );
}

function renderError(error: DisplayError): HTMLElement {
  return el("div", { className: "state error" },
    el("strong", {}, error.title),
    el("span", {}, error.message),
    error.status === 401 ? el("span", {}, "Check the bearer token.") : null,
    error.status === 403 ? el("span", {}, "Check project access scopes.") : null
  );
}

function banner(tone: "ok" | "error" | "idle" | "checking", title: string, message: string): HTMLElement {
  return el("section", { className: `health-banner ${tone}`, "aria-live": "polite" },
    el("strong", {}, title),
    el("span", {}, message)
  );
}

function rowButton(title: string, detail: string, selected: boolean, onClick: () => void): HTMLButtonElement {
  const item = button("", selected ? "row selected" : "row", onClick);
  item.replaceChildren(
    el("span", { className: "row-title" }, title),
    el("span", { className: "row-detail" }, detail)
  );
  return item;
}

function field(labelText: string, control: HTMLInputElement): HTMLElement {
  return el("label", { className: "field" },
    el("span", {}, labelText),
    control
  );
}

function input(label: string, value: string, type: string): HTMLInputElement {
  const node = document.createElement("input");
  node.type = type;
  node.setAttribute("aria-label", label);
  node.value = value;
  return node;
}

function hiddenInput(name: string, value: string): HTMLInputElement {
  const node = document.createElement("input");
  node.type = "text";
  node.name = name;
  node.value = value;
  node.hidden = true;
  node.setAttribute("autocomplete", "username");
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `button ${className}`;
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<HTMLElement | string | null>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") {
      node.className = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child === null) {
      continue;
    }
    node.append(child);
  }
  return node;
}

function idle<T>(data: T): Loadable<T> {
  return { state: "idle", data };
}

function loading<T>(data: T): Loadable<T> {
  return { state: "loading", data };
}

function ready<T>(data: T): Loadable<T> {
  return { state: "ready", data };
}

function failed<T>(data: T, error: DisplayError): Loadable<T> {
  return { state: "error", data, error };
}

function toDisplayError(error: unknown, fallbackTitle: string): DisplayError {
  if (error instanceof MindoryUiApiError) {
    return {
      title: error.status === 401 ? "Authentication failed" : error.status === 403 ? "Access denied" : fallbackTitle,
      message: error.message,
      status: error.status
    };
  }
  return {
    title: fallbackTitle,
    message: error instanceof Error ? error.message : String(error)
  };
}

function countLabel<T>(loadable: Loadable<T[]>): string {
  return loadable.state === "ready" ? String(loadable.data.length) : loadable.state;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.round(seconds / 60)}m`;
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
