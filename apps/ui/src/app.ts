import { MindoryUiApiClient, MindoryUiApiError } from "./api.js";
import { clearConnection, loadConnection, maskToken, saveConnection } from "./state.js";
import type {
  DocumentArtifact,
  DocumentRecord,
  HealthResponse,
  Message,
  Peer,
  ProcessingJob,
  ProcessingRun,
  Project,
  Session,
  StoredConnection
} from "./types.js";

interface ViewState {
  connection: StoredConnection;
  activeView: "sessions" | "documents";
  health: Loadable<HealthResponse>;
  projects: Loadable<Project[]>;
  peers: Loadable<Peer[]>;
  sessions: Loadable<Session[]>;
  messages: Loadable<Message[]>;
  documents: Loadable<DocumentRecord[]>;
  selectedDocument: Loadable<DocumentRecord | null>;
  processingRuns: Loadable<ProcessingRun[]>;
  documentJobs: Loadable<ProcessingJob[]>;
  artifacts: Loadable<DocumentArtifact[]>;
  selectedProjectId: string;
  selectedSessionId: string;
  selectedDocumentId: string;
  upload: {
    state: "idle" | "uploading" | "error";
    message: string;
  };
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
  activeView: "sessions",
  health: idle(emptyHealth),
  projects: idle([]),
  peers: idle([]),
  sessions: idle([]),
  messages: idle([]),
  documents: idle([]),
  selectedDocument: idle(null),
  processingRuns: idle([]),
  documentJobs: idle([]),
  artifacts: idle([]),
  selectedProjectId: "",
  selectedSessionId: "",
  selectedDocumentId: "",
  upload: {
    state: "idle",
    message: ""
  },
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
        view.activeView === "sessions" ? renderSessionWorkspace() : renderDocumentWorkspace()
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
    resetProjectScopedState();
    render();
    void refreshHealth();
    if (view.connection.token.length > 0) {
      void refreshProjects();
    }
  });

  const clearButton = button("Clear", "secondary", () => {
    view.connection = clearConnection();
    view.notice = "Connection cleared.";
    resetProjectScopedState();
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
      el("div", {}, el("dt", {}, "Documents"), el("dd", {}, countLabel(view.documents))),
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
  const selectedProject = currentProject();
  const selectedSession = view.sessions.data.find((session) => session.id === view.selectedSessionId);
  const selectedDocument = view.selectedDocument.data;
  const title = view.activeView === "documents"
    ? selectedDocument?.title || selectedDocument?.original_filename || selectedProject?.name || "Documents"
    : selectedSession?.title || selectedProject?.name || "Workspace";
  return el("header", { className: "workspace-header" },
    el("div", {},
      el("p", { className: "eyebrow" }, selectedProject ? selectedProject.id : "No project selected"),
      el("h2", {}, title)
    ),
    el("div", { className: "header-actions" },
      tabButton("Sessions", view.activeView === "sessions", () => {
        view.activeView = "sessions";
        render();
        if (view.selectedProjectId.length > 0 && view.sessions.state === "idle") {
          void refreshProjectDetail(view.selectedProjectId);
        }
      }),
      tabButton("Documents", view.activeView === "documents", () => {
        view.activeView = "documents";
        render();
        if (view.selectedProjectId.length > 0) {
          void refreshDocuments(view.selectedProjectId);
        }
      }),
      button("Reload", "secondary", () => {
        void refreshHealth();
        if (view.connection.token.length > 0) {
          void refreshProjects();
        }
      })
    )
  );
}

function renderSessionWorkspace(): HTMLElement {
  return el("section", { className: "workspace-grid", "aria-label": "Mindory session workspace" },
    renderProjectsPanel(),
    renderSessionsPanel(),
    renderMessagesPanel()
  );
}

function renderDocumentWorkspace(): HTMLElement {
  return el("section", { className: "document-grid", "aria-label": "Mindory document pipeline workspace" },
    renderDocumentListPanel(),
    renderDocumentDetailPanel(),
    renderArtifactPanel()
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
        resetSelectedProjectState();
        render();
        void refreshProjectDetail(project.id);
        if (view.activeView === "documents") {
          void refreshDocuments(project.id);
        }
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

function renderDocumentListPanel(): HTMLElement {
  const fileInput = input("Document file", "", "file");
  const titleInput = input("Document title", "", "text");
  const uploadButton = button(view.upload.state === "uploading" ? "Uploading" : "Upload", "primary", () => {
    const file = fileInput.files?.[0];
    void uploadSelectedDocument(file, titleInput.value);
  }, view.upload.state === "uploading");

  let listBody: HTMLElement;
  if (view.documents.state === "loading") {
    listBody = el("div", { className: "state loading" }, "Loading documents.");
  } else if (view.documents.state === "error") {
    listBody = renderError(view.documents.error);
  } else if (view.selectedProjectId.length === 0) {
    listBody = el("div", { className: "state empty" }, "Choose a project to list documents.");
  } else if (view.documents.data.length === 0) {
    listBody = el("div", { className: "state empty" }, "No documents uploaded for this project.");
  } else {
    listBody = el("div", { className: "list" }, ...view.documents.data.map((document) => {
      const selected = document.id === view.selectedDocumentId;
      return rowButton(document.title || document.original_filename, `${document.status} · ${formatBytes(document.size_bytes)}`, selected, () => {
        view.selectedDocumentId = document.id;
        view.selectedDocument = ready(document);
        view.processingRuns = idle([]);
        view.documentJobs = idle([]);
        view.artifacts = idle([]);
        render();
        void refreshSelectedDocument(document.project_id, document.id);
      });
    }));
  }

  return el("section", { className: "panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Documents"),
      el("span", {}, view.documents.state === "ready" ? `${view.documents.data.length}` : view.documents.state)
    ),
    el("form", { className: "upload-form" },
      field("File", fileInput),
      field("Title", titleInput),
      el("div", { className: "button-row" }, uploadButton, button("Refresh", "secondary light", () => {
        if (view.selectedProjectId.length > 0) {
          void refreshDocuments(view.selectedProjectId);
        }
      })),
      view.upload.message ? el("p", { className: view.upload.state === "error" ? "upload-message error-text" : "upload-message" }, view.upload.message) : null
    ),
    listBody
  );
}

function renderDocumentDetailPanel(): HTMLElement {
  const document = view.selectedDocument.data;
  if (view.selectedDocument.state === "loading") {
    return staticPanel("Pipeline", el("div", { className: "state loading" }, "Loading document pipeline."));
  }
  if (view.selectedDocument.state === "error") {
    return staticPanel("Pipeline", renderError(view.selectedDocument.error));
  }
  if (!document) {
    return staticPanel("Pipeline", el("div", { className: "state empty" }, "Choose a document to inspect processing state."));
  }

  const jobsBody = renderDocumentJobs(document);
  const runsBody = renderProcessingRuns();

  return el("section", { className: "panel wide-panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Pipeline"),
      statusPill(document.status)
    ),
    el("div", { className: "detail-stack" },
      el("dl", { className: "detail-list" },
        detailRow("Filename", document.original_filename),
        detailRow("MIME", document.mime_type),
        detailRow("Size", formatBytes(document.size_bytes)),
        detailRow("Storage", document.storage_key),
        detailRow("Updated", formatDate(document.updated_at))
      ),
      el("div", { className: "button-row" },
        button("Reprocess", "primary", () => {
          void recomputeSelectedDocument(document);
        }),
        button("Refresh", "secondary light", () => {
          void refreshSelectedDocument(document.project_id, document.id);
        })
      ),
      el("section", { className: "subsection" },
        el("div", { className: "subsection-heading" },
          el("h4", {}, "Jobs"),
          el("span", {}, view.documentJobs.state === "ready" ? `${view.documentJobs.data.length}` : view.documentJobs.state)
        ),
        jobsBody
      ),
      el("section", { className: "subsection" },
        el("div", { className: "subsection-heading" },
          el("h4", {}, "Processing runs"),
          el("span", {}, view.processingRuns.state === "ready" ? `${view.processingRuns.data.length}` : view.processingRuns.state)
        ),
        runsBody
      )
    )
  );
}

function renderArtifactPanel(): HTMLElement {
  if (view.artifacts.state === "loading") {
    return staticPanel("Artifacts", el("div", { className: "state loading" }, "Loading artifacts."));
  }
  if (view.artifacts.state === "error") {
    return staticPanel("Artifacts", renderError(view.artifacts.error));
  }
  if (!view.selectedDocument.data) {
    return staticPanel("Artifacts", el("div", { className: "state empty" }, "Choose a document to list derived artifacts."));
  }
  if (view.artifacts.data.length === 0) {
    return staticPanel("Artifacts", el("div", { className: "state empty" }, "No derived artifacts available yet."));
  }

  return el("section", { className: "panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Artifacts"),
      el("span", {}, `${view.artifacts.data.length}`)
    ),
    el("div", { className: "artifact-list" }, ...view.artifacts.data.map(renderArtifact))
  );
}

function renderDocumentJobs(document: DocumentRecord): HTMLElement {
  if (view.documentJobs.state === "loading") {
    return el("div", { className: "state loading" }, "Loading jobs.");
  }
  if (view.documentJobs.state === "error") {
    return renderError(view.documentJobs.error);
  }
  if (view.documentJobs.data.length === 0) {
    return el("div", { className: "state empty" }, "No document jobs found in the recent job window.");
  }
  return el("div", { className: "card-list" }, ...view.documentJobs.data.map((job) => {
    const retry = isRetryableJob(job)
      ? button("Retry", "secondary light", () => {
        void retryDocumentJob(document.project_id, job.id);
      })
      : null;
    return el("article", { className: `job-card ${job.status}` },
      el("div", { className: "card-title-row" },
        el("strong", {}, job.type),
        statusPill(job.status)
      ),
      el("dl", { className: "compact-list" },
        detailRow("Attempts", `${job.attempts}/${job.max_attempts}`),
        detailRow("Target", `${job.target_type}:${job.target_id}`),
        detailRow("Updated", formatDate(job.updated_at))
      ),
      job.last_error ? el("p", { className: "error-text" }, job.last_error) : null,
      renderDetails(job.details),
      retry
    );
  }));
}

function renderProcessingRuns(): HTMLElement {
  if (view.processingRuns.state === "loading") {
    return el("div", { className: "state loading" }, "Loading processing runs.");
  }
  if (view.processingRuns.state === "error") {
    return renderError(view.processingRuns.error);
  }
  if (view.processingRuns.data.length === 0) {
    return el("div", { className: "state empty" }, "No processing runs recorded.");
  }
  return el("div", { className: "card-list" }, ...view.processingRuns.data.map((run) =>
    el("article", { className: `run-card ${run.status}` },
      el("div", { className: "card-title-row" },
        el("strong", {}, run.reason),
        statusPill(run.status)
      ),
      el("dl", { className: "compact-list" },
        detailRow("Run", run.id),
        detailRow("Processor", run.processor_version),
        detailRow("Started", formatDate(run.started_at)),
        detailRow("Finished", formatDate(run.finished_at ?? undefined))
      ),
      renderDetails(run.metadata)
    )
  ));
}

function renderArtifact(artifact: DocumentArtifact): HTMLElement {
  return el("article", { className: "artifact-card" },
    el("div", { className: "card-title-row" },
      el("strong", {}, artifact.artifact_type),
      el("span", { className: "row-detail" }, `#${artifact.artifact_index}`)
    ),
    artifact.content ? el("p", { className: "artifact-content" }, shortText(artifact.content, 280)) : null,
    el("dl", { className: "compact-list" },
      detailRow("Artifact", artifact.id),
      detailRow("Run", artifact.processing_run_id),
      detailRow("Model", [artifact.model_provider, artifact.model_name].filter(Boolean).join(" / ") || "none"),
      detailRow("Storage", artifact.storage_key ?? "none")
    ),
    el("div", { className: "source-refs" },
      el("strong", {}, "Source refs"),
      artifact.source_refs.length > 0
        ? el("ul", {}, ...artifact.source_refs.map((ref) => el("li", {}, `${ref.type}:${ref.id}`)))
        : el("span", { className: "muted" }, "none")
    ),
    renderDetails({
      source_position: artifact.source_position ?? {},
      metadata: artifact.metadata ?? {}
    })
  );
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
      if (view.activeView === "documents") {
        void refreshDocuments(projects[0].id);
      }
    } else if (view.selectedProjectId.length > 0) {
      void refreshProjectDetail(view.selectedProjectId);
      if (view.activeView === "documents") {
        void refreshDocuments(view.selectedProjectId);
      }
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
    if (sessions.length > 0 && view.selectedSessionId.length === 0) {
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

async function refreshDocuments(projectId: string): Promise<void> {
  view.documents = loading(view.documents.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const documents = await client.listDocuments(projectId);
    view.documents = ready(documents);
    if (documents.length > 0 && view.selectedDocumentId.length === 0) {
      view.selectedDocumentId = documents[0].id;
      view.selectedDocument = ready(documents[0]);
      void refreshSelectedDocument(projectId, documents[0].id);
    } else if (view.selectedDocumentId.length > 0) {
      void refreshSelectedDocument(projectId, view.selectedDocumentId);
    }
  } catch (error) {
    view.documents = failed([], toDisplayError(error, "Documents could not be loaded"));
  }
  render();
}

async function refreshSelectedDocument(projectId: string, documentId: string): Promise<void> {
  view.selectedDocument = loading(view.selectedDocument.data);
  view.processingRuns = loading(view.processingRuns.data);
  view.documentJobs = loading(view.documentJobs.data);
  view.artifacts = loading(view.artifacts.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const [document, processingRuns, artifacts, jobs] = await Promise.all([
      client.getDocument(projectId, documentId),
      client.listProcessingRuns(projectId, documentId),
      client.listDocumentArtifacts(projectId, documentId),
      client.listJobs(projectId, 100)
    ]);
    view.selectedDocument = ready(document);
    view.processingRuns = ready(processingRuns);
    view.artifacts = ready(artifacts);
    view.documentJobs = ready(jobs.filter((job) => job.target_id === documentId || job.metadata?.document_id === documentId));
  } catch (error) {
    const displayError = toDisplayError(error, "Document pipeline could not be loaded");
    view.selectedDocument = failed(null, displayError);
    view.processingRuns = failed([], displayError);
    view.documentJobs = failed([], displayError);
    view.artifacts = failed([], displayError);
  }
  render();
}

async function uploadSelectedDocument(file: File | undefined, title: string): Promise<void> {
  if (view.selectedProjectId.length === 0) {
    view.upload = { state: "error", message: "Choose a project before upload." };
    render();
    return;
  }
  if (!file) {
    view.upload = { state: "error", message: "Choose a file to upload." };
    render();
    return;
  }

  view.upload = { state: "uploading", message: file.name };
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const result = await client.uploadDocument({
      projectId: view.selectedProjectId,
      file,
      title
    });
    view.upload = { state: "idle", message: `Uploaded ${result.document.original_filename}.` };
    view.selectedDocumentId = result.document.id;
    view.selectedDocument = ready(result.document);
    await refreshDocuments(view.selectedProjectId);
    await refreshSelectedDocument(view.selectedProjectId, result.document.id);
  } catch (error) {
    view.upload = {
      state: "error",
      message: toDisplayError(error, "Upload failed").message
    };
    render();
  }
}

async function recomputeSelectedDocument(document: DocumentRecord): Promise<void> {
  view.notice = `Reprocess requested for ${document.original_filename}.`;
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    await client.recomputeDocument(document.project_id, document.id);
    await refreshSelectedDocument(document.project_id, document.id);
  } catch (error) {
    view.selectedDocument = failed(document, toDisplayError(error, "Reprocess could not be started"));
    render();
  }
}

async function retryDocumentJob(projectId: string, jobId: string): Promise<void> {
  view.notice = `Retry requested for ${jobId}.`;
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    await client.retryJob(projectId, jobId);
    if (view.selectedDocumentId.length > 0) {
      await refreshSelectedDocument(projectId, view.selectedDocumentId);
    }
  } catch (error) {
    view.documentJobs = failed(view.documentJobs.data, toDisplayError(error, "Job retry could not be started"));
    render();
  }
}

function resetProjectScopedState(): void {
  view.projects = idle([]);
  view.selectedProjectId = "";
  resetSelectedProjectState();
}

function resetSelectedProjectState(): void {
  view.peers = idle([]);
  view.sessions = idle([]);
  view.messages = idle([]);
  view.documents = idle([]);
  view.selectedSessionId = "";
  view.selectedDocumentId = "";
  view.selectedDocument = idle(null);
  view.processingRuns = idle([]);
  view.documentJobs = idle([]);
  view.artifacts = idle([]);
}

function currentProject(): Project | undefined {
  return view.projects.data.find((project) => project.id === view.selectedProjectId);
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

function staticPanel(title: string, body: HTMLElement): HTMLElement {
  return el("section", { className: "panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, title),
      el("span", {}, "idle")
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

function tabButton(label: string, selected: boolean, onClick: () => void): HTMLButtonElement {
  const item = button(label, selected ? "tab selected" : "tab", onClick);
  item.setAttribute("aria-pressed", selected ? "true" : "false");
  return item;
}

function rowButton(title: string, detail: string, selected: boolean, onClick: () => void): HTMLButtonElement {
  const item = button("", selected ? "row selected" : "row", onClick);
  item.replaceChildren(
    el("span", { className: "row-title" }, title),
    el("span", { className: "row-detail" }, detail)
  );
  return item;
}

function statusPill(status: string): HTMLElement {
  return el("span", { className: `status-pill ${status}` }, status);
}

function field(labelText: string, control: HTMLInputElement): HTMLElement {
  return el("label", { className: "field" },
    el("span", {}, labelText),
    control
  );
}

function detailRow(label: string, value: string): HTMLElement {
  return el("div", {},
    el("dt", {}, label),
    el("dd", {}, value || "none")
  );
}

function renderDetails(value: Record<string, unknown> | undefined): HTMLElement | null {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }
  return el("details", { className: "json-details" },
    el("summary", {}, "Details"),
    el("pre", {}, JSON.stringify(value, null, 2))
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

function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `button ${className}`;
  node.textContent = label;
  node.disabled = disabled;
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

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  for (const unit of units) {
    if (current < 1024) {
      return `${current.toFixed(current >= 10 ? 1 : 2)} ${unit}`;
    }
    current /= 1024;
  }
  return `${current.toFixed(1)} PB`;
}

function shortText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

function isRetryableJob(job: ProcessingJob): boolean {
  return ["failed", "partial_failed", "blocked_by_scan"].includes(job.status);
}
