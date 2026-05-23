import { MindoryUiApiClient, MindoryUiApiError } from "./api.js";
import { clearConnection, loadConnection, maskToken, saveConnection } from "./state.js";
import type {
  ContextBuildResult,
  DocumentArtifact,
  DocumentRecord,
  FaceIdentity,
  FaceObservation,
  HealthResponse,
  Message,
  MemorySearchHit,
  MetadataFilter,
  Peer,
  ProcessingJob,
  ProcessingRun,
  Project,
  RuntimeDiagnostics,
  Session,
  SourceRef,
  StoredConnection,
  UnifiedSearchHit
} from "./types.js";

interface ViewState {
  connection: StoredConnection;
  activeView: "sessions" | "documents" | "search" | "diagnostics";
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
  searchHits: Loadable<UnifiedSearchHit[]>;
  contextResult: Loadable<ContextBuildResult | null>;
  memoryHits: Loadable<MemorySearchHit[]>;
  faceIdentities: Loadable<FaceIdentity[]>;
  faceObservations: Loadable<FaceObservation[]>;
  ready: Loadable<HealthResponse>;
  runtimeDiagnostics: Loadable<RuntimeDiagnostics | null>;
  diagnosticJobs: Loadable<ProcessingJob[]>;
  selectedProjectId: string;
  selectedSessionId: string;
  selectedDocumentId: string;
  selectedFaceIdentityId: string;
  selectedSourceRef: SourceRef | null;
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
  searchHits: idle([]),
  contextResult: idle(null),
  memoryHits: idle([]),
  faceIdentities: idle([]),
  faceObservations: idle([]),
  ready: idle(emptyHealth),
  runtimeDiagnostics: idle(null),
  diagnosticJobs: idle([]),
  selectedProjectId: "",
  selectedSessionId: "",
  selectedDocumentId: "",
  selectedFaceIdentityId: "",
  selectedSourceRef: null,
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
        renderActiveWorkspace()
      )
    )
  );
}

function renderActiveWorkspace(): HTMLElement {
  if (view.activeView === "documents") {
    return renderDocumentWorkspace();
  }
  if (view.activeView === "search") {
    return renderSearchWorkspace();
  }
  if (view.activeView === "diagnostics") {
    return renderDiagnosticsWorkspace();
  }
  return renderSessionWorkspace();
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
    : view.activeView === "search"
      ? selectedProject?.name || "Search"
      : view.activeView === "diagnostics"
        ? selectedProject?.name || "Diagnostics"
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
      tabButton("Search", view.activeView === "search", () => {
        view.activeView = "search";
        render();
        if (view.selectedProjectId.length > 0) {
          void refreshFaces(view.selectedProjectId);
        }
      }),
      tabButton("Diagnostics", view.activeView === "diagnostics", () => {
        view.activeView = "diagnostics";
        render();
        if (view.selectedProjectId.length > 0) {
          void refreshDiagnostics(view.selectedProjectId);
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

function renderSearchWorkspace(): HTMLElement {
  return el("section", { className: "insights-grid", "aria-label": "Mindory search context memory faces workspace" },
    renderUnifiedSearchPanel(),
    renderContextMemoryPanel(),
    renderFacesPanel()
  );
}

function renderDiagnosticsWorkspace(): HTMLElement {
  return el("section", { className: "diagnostics-grid", "aria-label": "Mindory runtime diagnostics workspace" },
    renderRuntimeDiagnosticsPanel(),
    renderProviderDiagnosticsPanel(),
    renderJobDiagnosticsPanel()
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
        } else if (view.activeView === "search") {
          void refreshFaces(project.id);
        } else if (view.activeView === "diagnostics") {
          void refreshDiagnostics(project.id);
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

function renderUnifiedSearchPanel(): HTMLElement {
  const queryInput = input("Search query", "", "search");
  const limitInput = input("Search limit", "10", "number");
  limitInput.min = "1";
  limitInput.max = "100";
  const documentsTarget = checkbox("Documents", true);
  const artifactsTarget = checkbox("Artifacts", true);
  const facesTarget = checkbox("Faces", true);
  const filterKeyInput = input("Metadata key", "", "text");
  const filterValueInput = input("Metadata value", "", "text");
  const runButton = button("Search", "primary", () => {
    const targets = selectedTargets(documentsTarget, artifactsTarget, facesTarget);
    const metadataFilters = readMetadataFilters(filterKeyInput.value, filterValueInput.value);
    void runUnifiedSearch({
      query: queryInput.value,
      limit: readPositiveInt(limitInput.value, 10),
      targets,
      metadataFilters
    });
  });

  return el("section", { className: "panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Unified search"),
      el("span", {}, view.searchHits.state === "ready" ? `${view.searchHits.data.length}` : view.searchHits.state)
    ),
    el("form", { className: "control-form" },
      field("Query", queryInput),
      field("Limit", limitInput),
      el("div", { className: "toggle-row" },
        toggleField(documentsTarget),
        toggleField(artifactsTarget),
        toggleField(facesTarget)
      ),
      field("Metadata key", filterKeyInput),
      field("Metadata value", filterValueInput),
      el("div", { className: "button-row" }, runButton)
    ),
    renderSearchResults()
  );
}

function renderContextMemoryPanel(): HTMLElement {
  const contextQueryInput = input("Context query", "", "search");
  const tokenBudgetInput = input("Token budget", "1200", "number");
  tokenBudgetInput.min = "1";
  const includeSummary = checkbox("Summary", true);
  const includeMessages = checkbox("Messages", true);
  const includeMemories = checkbox("Memories", true);
  const includeDocuments = checkbox("Documents", true);
  const memoryTextInput = textarea("Memory text", "");
  const memoryTypeSelect = select("Memory type", ["semantic", "episodic", "preference", "decision", "task", "artifact_reference", "derived"], "semantic");
  const memorySourceTypeSelect = select("Memory source type", sourceRefTypeOptions(), view.selectedSourceRef?.type ?? "document");
  const memorySourceIdInput = input("Memory source id", view.selectedSourceRef?.id ?? "", "text");
  const memorySearchInput = input("Memory search query", "", "search");

  return el("section", { className: "panel wide-panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Context and memory"),
      el("span", {}, view.contextResult.state === "ready" ? `${view.contextResult.data?.blocks.length ?? 0}` : view.contextResult.state)
    ),
    el("div", { className: "detail-stack" },
      el("form", { className: "control-form compact" },
        field("Context query", contextQueryInput),
        field("Token budget", tokenBudgetInput),
        el("div", { className: "toggle-row" },
          toggleField(includeSummary),
          toggleField(includeMessages),
          toggleField(includeMemories),
          toggleField(includeDocuments)
        ),
        el("div", { className: "button-row" }, button("Build context", "primary", () => {
          void buildContextPreview({
            query: contextQueryInput.value,
            tokenBudget: readPositiveInt(tokenBudgetInput.value, 1200),
            include: {
              sessionSummary: includeSummary.checked,
              recentMessages: includeMessages.checked,
              memories: includeMemories.checked,
              documents: includeDocuments.checked
            }
          });
        }))
      ),
      renderContextResult(),
      el("form", { className: "control-form compact" },
        field("Memory", memoryTextInput),
        field("Type", memoryTypeSelect),
        field("Source type", memorySourceTypeSelect),
        field("Source id", memorySourceIdInput),
        el("div", { className: "button-row" }, button("Remember", "primary", () => {
          void rememberManualMemory({
            text: memoryTextInput.value,
            type: memoryTypeSelect.value,
            sourceRef: {
              type: memorySourceTypeSelect.value,
              id: memorySourceIdInput.value.trim()
            }
          });
        }))
      ),
      el("form", { className: "control-form compact" },
        field("Memory search", memorySearchInput),
        el("div", { className: "button-row" }, button("Search memories", "secondary light", () => {
          void searchMemories(memorySearchInput.value);
        }))
      ),
      renderMemoryResults()
    )
  );
}

function renderFacesPanel(): HTMLElement {
  return el("section", { className: "panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Faces"),
      el("span", {}, view.faceIdentities.state === "ready" ? `${view.faceIdentities.data.length}` : view.faceIdentities.state)
    ),
    el("div", { className: "button-strip" },
      button("Refresh", "secondary light", () => {
        if (view.selectedProjectId.length > 0) {
          void refreshFaces(view.selectedProjectId);
        }
      })
    ),
    renderFaceIdentities(),
    renderFaceObservations()
  );
}

function renderRuntimeDiagnosticsPanel(): HTMLElement {
  const diagnostics = view.runtimeDiagnostics.data;
  const ready = view.ready.data;
  return el("section", { className: "panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Runtime"),
      el("span", {}, view.runtimeDiagnostics.state === "ready" ? "ready" : view.runtimeDiagnostics.state)
    ),
    el("div", { className: "button-strip" },
      button("Refresh", "secondary light", () => {
        if (view.selectedProjectId.length > 0) {
          void refreshDiagnostics(view.selectedProjectId);
        }
      })
    ),
    view.selectedProjectId.length === 0
      ? el("div", { className: "state empty" }, "Choose a project to load runtime diagnostics.")
      : view.runtimeDiagnostics.state === "loading"
        ? el("div", { className: "state loading" }, "Loading runtime diagnostics.")
        : view.runtimeDiagnostics.state === "error"
          ? renderError(view.runtimeDiagnostics.error)
          : el("div", { className: "detail-stack" },
            el("dl", { className: "detail-list" },
              detailRow("Ready", ready.status ?? "not checked"),
              detailRow("Generated", formatDate(diagnostics?.generated_at)),
              detailRow("Project", diagnostics?.project_id ?? view.selectedProjectId),
              detailRow("API metrics", diagnostics?.metrics_links.api_metrics_url ?? "disabled"),
              detailRow("Worker metrics", diagnostics?.metrics_links.worker_metrics_url ?? "disabled")
            ),
            renderConfigSection("Install", readRecordPath(diagnostics?.config, ["install"])),
            renderConfigSection("API", readRecordPath(diagnostics?.config, ["api"])),
            renderConfigSection("Metrics links", diagnostics?.metrics_links ?? {})
          )
  );
}

function renderProviderDiagnosticsPanel(): HTMLElement {
  const diagnostics = view.runtimeDiagnostics.data;
  return el("section", { className: "panel wide-panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Providers"),
      el("span", {}, view.ready.state === "ready" ? "ready" : view.ready.state)
    ),
    view.runtimeDiagnostics.state === "loading"
      ? el("div", { className: "state loading" }, "Loading provider diagnostics.")
      : view.runtimeDiagnostics.state === "error"
        ? renderError(view.runtimeDiagnostics.error)
        : !diagnostics
          ? el("div", { className: "state empty" }, "No provider diagnostics loaded.")
          : el("div", { className: "detail-stack" },
            renderConfigSection("Storage", readRecordPath(diagnostics.config, ["storage"])),
            renderConfigSection("Vector", readRecordPath(diagnostics.config, ["vector"])),
            renderConfigSection("Antivirus", readRecordPath(diagnostics.config, ["antivirus"])),
            renderConfigSection("Document processing", readRecordPath(diagnostics.config, ["document_processing"])),
            renderProviderHealth(diagnostics.provider_health),
            renderConfigSection("Model roles", readRecordPath(diagnostics.config, ["llm"]))
          )
  );
}

function renderJobDiagnosticsPanel(): HTMLElement {
  const jobs = view.diagnosticJobs;
  return el("section", { className: "panel" },
    el("div", { className: "panel-heading" },
      el("h3", {}, "Jobs and queues"),
      el("span", {}, jobs.state === "ready" ? `${jobs.data.length}` : jobs.state)
    ),
    jobs.state === "loading"
      ? el("div", { className: "state loading" }, "Loading recent jobs.")
      : jobs.state === "error"
        ? renderError(jobs.error)
        : view.selectedProjectId.length === 0
          ? el("div", { className: "state empty" }, "Choose a project to load job diagnostics.")
          : el("div", { className: "detail-stack" },
            renderJobStatusSummary(jobs.data),
            jobs.data.length === 0
              ? el("div", { className: "state empty" }, "No recent jobs found.")
              : el("div", { className: "card-list" }, ...jobs.data.map((job) =>
                el("article", { className: `job-card ${job.status}` },
                  el("div", { className: "card-title-row" },
                    el("strong", {}, job.type),
                    statusPill(job.status)
                  ),
                  el("dl", { className: "compact-list" },
                    detailRow("Job", job.id),
                    detailRow("Target", `${job.target_type}:${job.target_id}`),
                    detailRow("Attempts", `${job.attempts}/${job.max_attempts}`),
                    detailRow("Updated", formatDate(job.updated_at))
                  ),
                  job.last_error ? el("p", { className: "error-text" }, job.last_error) : null,
                  renderDetails(job.details)
                )
              ))
          )
  );
}

function renderConfigSection(title: string, value: Record<string, unknown>): HTMLElement {
  return el("section", { className: "subsection config-section" },
    el("div", { className: "subsection-heading" },
      el("h4", {}, title),
      el("span", {}, `${Object.keys(value).length}`)
    ),
    renderDetails(value) ?? el("div", { className: "state empty" }, "No values.")
  );
}

function renderProviderHealth(value: Record<string, unknown>): HTMLElement {
  const entries = Object.entries(value);
  return el("section", { className: "subsection" },
    el("div", { className: "subsection-heading" },
      el("h4", {}, "Provider health"),
      el("span", {}, `${entries.length}`)
    ),
    el("div", { className: "card-list" }, ...entries.map(([key, state]) =>
      el("article", { className: "result-card" },
        el("div", { className: "card-title-row" },
          el("strong", {}, key),
          statusPill(readProviderStatus(state))
        ),
        renderDetails(isRecordValue(state) ? state : { value: state })
      )
    ))
  );
}

function renderJobStatusSummary(jobs: ProcessingJob[]): HTMLElement {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  }
  return el("section", { className: "subsection" },
    el("div", { className: "subsection-heading" },
      el("h4", {}, "Recent job status"),
      el("span", {}, `${jobs.length}`)
    ),
    counts.size === 0
      ? el("div", { className: "state empty" }, "No job status counts.")
      : el("div", { className: "status-grid" }, ...Array.from(counts.entries()).map(([status, count]) =>
        el("div", { className: "status-metric" },
          statusPill(status),
          el("strong", {}, String(count))
        )
      ))
  );
}

function renderSearchResults(): HTMLElement {
  if (view.searchHits.state === "loading") {
    return el("div", { className: "state loading" }, "Searching.");
  }
  if (view.searchHits.state === "error") {
    return renderError(view.searchHits.error);
  }
  if (view.selectedProjectId.length === 0) {
    return el("div", { className: "state empty" }, "Choose a project to search.");
  }
  if (view.searchHits.data.length === 0) {
    return el("div", { className: "state empty" }, "No search results loaded.");
  }
  return el("div", { className: "card-list" }, ...view.searchHits.data.map((hit) =>
    el("article", { className: "result-card" },
      el("div", { className: "card-title-row" },
        el("strong", {}, hit.kind),
        el("span", { className: "row-detail" }, `score ${formatScore(hit.score)}`)
      ),
      el("p", { className: "artifact-content" }, shortText(hit.content, 320)),
      el("dl", { className: "compact-list" },
        detailRow("Document", hit.document_id),
        detailRow("Artifact", hit.artifact_id ?? "none"),
        detailRow("Face", hit.face_identity_id ?? "none")
      ),
      renderSourceRefs(hit.source_refs, () => {
        view.selectedSourceRef = hit.source_refs[0] ?? null;
        render();
      }),
      renderDetails({
        source_position: hit.source_position ?? {},
        metadata: hit.metadata ?? {}
      })
    )
  ));
}

function renderContextResult(): HTMLElement {
  if (view.contextResult.state === "loading") {
    return el("div", { className: "state loading" }, "Building context.");
  }
  if (view.contextResult.state === "error") {
    return renderError(view.contextResult.error);
  }
  if (!view.contextResult.data) {
    return el("div", { className: "state empty" }, "No context preview loaded.");
  }
  return el("section", { className: "subsection" },
    el("div", { className: "subsection-heading" },
      el("h4", {}, "Context preview"),
      el("span", {}, `${view.contextResult.data.debug.usedTokens}/${view.contextResult.data.debug.tokenBudget} tokens`)
    ),
    ...view.contextResult.data.blocks.map((block) =>
      el("article", { className: "result-card" },
        el("div", { className: "card-title-row" },
          el("strong", {}, block.type),
          el("span", { className: "row-detail" }, block.score === null ? "source" : `score ${formatScore(block.score)}`)
        ),
        el("p", { className: "artifact-content" }, shortText(block.content, 260)),
        renderSourceRefs(block.source_refs)
      )
    )
  );
}

function renderMemoryResults(): HTMLElement {
  if (view.memoryHits.state === "loading") {
    return el("div", { className: "state loading" }, "Loading memories.");
  }
  if (view.memoryHits.state === "error") {
    return renderError(view.memoryHits.error);
  }
  if (view.memoryHits.data.length === 0) {
    return el("div", { className: "state empty" }, "No memory results loaded.");
  }
  return el("section", { className: "subsection" },
    el("div", { className: "subsection-heading" },
      el("h4", {}, "Source-backed memories"),
      el("span", {}, `${view.memoryHits.data.length}`)
    ),
    ...view.memoryHits.data.map((hit) =>
      el("article", { className: "result-card" },
        el("div", { className: "card-title-row" },
          el("strong", {}, hit.memory.type),
          statusPill(hit.memory.status)
        ),
        el("p", { className: "artifact-content" }, shortText(hit.memory.text, 260)),
        el("dl", { className: "compact-list" },
          detailRow("Memory", hit.memory.id),
          detailRow("Score", formatScore(hit.score)),
          detailRow("Confidence", formatScore(hit.memory.confidence))
        ),
        renderSourceRefs(hit.memory.source_refs)
      )
    )
  );
}

function renderFaceIdentities(): HTMLElement {
  if (view.faceIdentities.state === "loading") {
    return el("div", { className: "state loading" }, "Loading face identities.");
  }
  if (view.faceIdentities.state === "error") {
    return renderError(view.faceIdentities.error);
  }
  if (view.selectedProjectId.length === 0) {
    return el("div", { className: "state empty" }, "Choose a project to list face identities.");
  }
  if (view.faceIdentities.data.length === 0) {
    return el("div", { className: "state empty" }, "No face identities found.");
  }
  return el("div", { className: "card-list" }, ...view.faceIdentities.data.map((identity) => {
    const labelInput = input("Face label", identity.label ?? "", "text");
    const mergeTargetInput = input("Merge target identity", "", "text");
    const selected = identity.id === view.selectedFaceIdentityId;
    return el("article", { className: selected ? "face-card selected" : "face-card" },
      el("div", { className: "card-title-row" },
        el("strong", {}, identity.label || identity.id),
        statusPill(identity.status)
      ),
      el("dl", { className: "compact-list" },
        detailRow("Identity", identity.id),
        detailRow("Representative", identity.representative_artifact_id ?? "none")
      ),
      field("Label", labelInput),
      el("div", { className: "button-row" },
        button("Observations", "secondary light", () => {
          view.selectedFaceIdentityId = identity.id;
          render();
          void refreshFaceObservations(identity.project_id, identity.id);
        }),
        button("Rename", "secondary light", () => {
          void renameFace(identity.project_id, identity.id, labelInput.value);
        })
      ),
      field("Merge target", mergeTargetInput),
      el("div", { className: "button-row" },
        button("Merge", "secondary light", () => {
          void mergeFace(identity.project_id, identity.id, mergeTargetInput.value);
        })
      )
    );
  }));
}

function renderFaceObservations(): HTMLElement {
  if (view.faceObservations.state === "loading") {
    return el("div", { className: "state loading" }, "Loading face observations.");
  }
  if (view.faceObservations.state === "error") {
    return renderError(view.faceObservations.error);
  }
  if (view.faceObservations.data.length === 0) {
    return el("div", { className: "state empty" }, "No face observations selected.");
  }
  return el("section", { className: "subsection observation-list" },
    el("div", { className: "subsection-heading" },
      el("h4", {}, "Observations"),
      el("span", {}, `${view.faceObservations.data.length}`)
    ),
    ...view.faceObservations.data.map((observation) =>
      el("article", { className: "result-card" },
        el("div", { className: "card-title-row" },
          el("strong", {}, observation.id),
          el("span", { className: "row-detail" }, observation.confidence === null ? "confidence none" : `confidence ${formatScore(observation.confidence)}`)
        ),
        el("dl", { className: "compact-list" },
          detailRow("Document", observation.document_id),
          detailRow("Artifact", observation.artifact_id),
          detailRow("Model", observation.model ?? "none")
        ),
        renderDetails({
          bounding_box: observation.bounding_box ?? {},
          metadata: observation.metadata ?? {}
        })
      )
    )
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
      } else if (view.activeView === "search") {
        void refreshFaces(projects[0].id);
      } else if (view.activeView === "diagnostics") {
        void refreshDiagnostics(projects[0].id);
      }
    } else if (view.selectedProjectId.length > 0) {
      void refreshProjectDetail(view.selectedProjectId);
      if (view.activeView === "documents") {
        void refreshDocuments(view.selectedProjectId);
      } else if (view.activeView === "search") {
        void refreshFaces(view.selectedProjectId);
      } else if (view.activeView === "diagnostics") {
        void refreshDiagnostics(view.selectedProjectId);
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

async function runUnifiedSearch(input: { query: string; limit: number; targets: Array<"documents" | "artifacts" | "faces">; metadataFilters: MetadataFilter[] }): Promise<void> {
  if (view.selectedProjectId.length === 0) {
    view.searchHits = failed([], { title: "Project required", message: "Choose a project before searching." });
    render();
    return;
  }
  view.searchHits = loading(view.searchHits.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const payload = {
      projectIds: [view.selectedProjectId],
      limit: input.limit,
      targets: input.targets
    };
    const query = input.query.trim();
    if (query.length > 0) {
      Object.assign(payload, { query });
    }
    if (input.metadataFilters.length > 0) {
      Object.assign(payload, { metadataFilters: input.metadataFilters });
    }
    const hits = await client.unifiedSearch(payload);
    view.searchHits = ready(hits);
    view.selectedSourceRef = hits[0]?.source_refs[0] ?? view.selectedSourceRef;
  } catch (error) {
    view.searchHits = failed([], toDisplayError(error, "Unified search failed"));
  }
  render();
}

async function buildContextPreview(input: {
  query: string;
  tokenBudget: number;
  include: {
    sessionSummary: boolean;
    recentMessages: boolean;
    memories: boolean;
    documents: boolean;
  };
}): Promise<void> {
  if (view.selectedProjectId.length === 0) {
    view.contextResult = failed(null, { title: "Project required", message: "Choose a project before building context." });
    render();
    return;
  }
  view.contextResult = loading(view.contextResult.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const payload = {
      projectIds: [view.selectedProjectId],
      tokenBudget: input.tokenBudget,
      include: input.include
    };
    const query = input.query.trim();
    if (query.length > 0) {
      Object.assign(payload, { query });
    }
    if (view.selectedSessionId.length > 0) {
      Object.assign(payload, { sessionId: view.selectedSessionId });
    }
    view.contextResult = ready(await client.buildContext(payload));
  } catch (error) {
    view.contextResult = failed(null, toDisplayError(error, "Context preview failed"));
  }
  render();
}

async function rememberManualMemory(input: { text: string; type: string; sourceRef: SourceRef }): Promise<void> {
  if (view.selectedProjectId.length === 0) {
    view.memoryHits = failed(view.memoryHits.data, { title: "Project required", message: "Choose a project before saving memory." });
    render();
    return;
  }
  const text = input.text.trim();
  if (text.length === 0 || input.sourceRef.id.length === 0) {
    view.memoryHits = failed(view.memoryHits.data, { title: "Memory requires evidence", message: "Memory text and source id are required." });
    render();
    return;
  }
  view.memoryHits = loading(view.memoryHits.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const memory = await client.rememberMemory({
      projectId: view.selectedProjectId,
      type: input.type,
      text,
      status: "active",
      sourceRefs: [input.sourceRef],
      metadata: {
        source: "mindory-ui"
      }
    });
    view.selectedSourceRef = memory.source_refs[0] ?? view.selectedSourceRef;
    await searchMemories(text);
  } catch (error) {
    view.memoryHits = failed(view.memoryHits.data, toDisplayError(error, "Memory could not be saved"));
    render();
  }
}

async function searchMemories(query: string): Promise<void> {
  if (view.selectedProjectId.length === 0) {
    view.memoryHits = failed([], { title: "Project required", message: "Choose a project before memory search." });
    render();
    return;
  }
  view.memoryHits = loading(view.memoryHits.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const payload = {
      projectIds: [view.selectedProjectId],
      statuses: ["active", "candidate"],
      limit: 20
    };
    const normalizedQuery = query.trim();
    if (normalizedQuery.length > 0) {
      Object.assign(payload, { query: normalizedQuery });
    }
    view.memoryHits = ready(await client.searchMemories(payload));
  } catch (error) {
    view.memoryHits = failed([], toDisplayError(error, "Memories could not be loaded"));
  }
  render();
}

async function refreshFaces(projectId: string): Promise<void> {
  view.faceIdentities = loading(view.faceIdentities.data);
  view.faceObservations = view.selectedFaceIdentityId ? loading(view.faceObservations.data) : view.faceObservations;
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const identities = await client.listFaceIdentities(projectId);
    view.faceIdentities = ready(identities);
    if (view.selectedFaceIdentityId.length > 0) {
      await refreshFaceObservations(projectId, view.selectedFaceIdentityId);
    }
  } catch (error) {
    view.faceIdentities = failed([], toDisplayError(error, "Face identities could not be loaded"));
  }
  render();
}

async function refreshFaceObservations(projectId: string, identityId: string): Promise<void> {
  view.faceObservations = loading(view.faceObservations.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    view.faceObservations = ready(await client.listFaceObservations(projectId, identityId));
  } catch (error) {
    view.faceObservations = failed([], toDisplayError(error, "Face observations could not be loaded"));
  }
  render();
}

async function renameFace(projectId: string, identityId: string, label: string): Promise<void> {
  try {
    const client = new MindoryUiApiClient(view.connection);
    await client.renameFaceIdentity(projectId, identityId, label.trim() || null);
    await refreshFaces(projectId);
  } catch (error) {
    view.faceIdentities = failed(view.faceIdentities.data, toDisplayError(error, "Face identity could not be renamed"));
    render();
  }
}

async function mergeFace(projectId: string, sourceIdentityId: string, targetIdentityId: string): Promise<void> {
  const target = targetIdentityId.trim();
  if (target.length === 0) {
    view.faceIdentities = failed(view.faceIdentities.data, { title: "Merge target required", message: "Enter a target face identity id." });
    render();
    return;
  }
  try {
    const client = new MindoryUiApiClient(view.connection);
    await client.mergeFaceIdentity(projectId, sourceIdentityId, target);
    view.selectedFaceIdentityId = target;
    await refreshFaces(projectId);
  } catch (error) {
    view.faceIdentities = failed(view.faceIdentities.data, toDisplayError(error, "Face identities could not be merged"));
    render();
  }
}

async function refreshDiagnostics(projectId: string): Promise<void> {
  view.ready = loading(view.ready.data);
  view.runtimeDiagnostics = loading(view.runtimeDiagnostics.data);
  view.diagnosticJobs = loading(view.diagnosticJobs.data);
  render();
  try {
    const client = new MindoryUiApiClient(view.connection);
    const [readyStatus, diagnostics, jobs] = await Promise.all([
      client.ready(),
      client.runtimeDiagnostics(projectId),
      client.listJobs(projectId, 100)
    ]);
    view.ready = ready(readyStatus);
    view.runtimeDiagnostics = ready(diagnostics);
    view.diagnosticJobs = ready(jobs);
  } catch (error) {
    const displayError = toDisplayError(error, "Runtime diagnostics could not be loaded");
    view.ready = failed(emptyHealth, displayError);
    view.runtimeDiagnostics = failed(null, displayError);
    view.diagnosticJobs = failed([], displayError);
  }
  render();
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
  view.searchHits = idle([]);
  view.contextResult = idle(null);
  view.memoryHits = idle([]);
  view.faceIdentities = idle([]);
  view.faceObservations = idle([]);
  view.ready = idle(emptyHealth);
  view.runtimeDiagnostics = idle(null);
  view.diagnosticJobs = idle([]);
  view.selectedFaceIdentityId = "";
  view.selectedSourceRef = null;
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

function field(labelText: string, control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): HTMLElement {
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

function readRecordPath(value: Record<string, unknown> | undefined, path: string[]): Record<string, unknown> {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecordValue(current)) {
      return {};
    }
    current = current[segment];
  }
  return isRecordValue(current) ? current : {};
}

function readProviderStatus(value: unknown): string {
  if (!isRecordValue(value)) {
    return "unknown";
  }
  const status = value.status;
  return typeof status === "string" ? status : "unknown";
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderSourceRefs(sourceRefs: SourceRef[], onUse?: () => void): HTMLElement {
  return el("div", { className: "source-refs" },
    el("div", { className: "card-title-row" },
      el("strong", {}, "Source refs"),
      onUse && sourceRefs.length > 0 ? button("Use source", "secondary light", onUse) : null
    ),
    sourceRefs.length > 0
      ? el("ul", {}, ...sourceRefs.map((ref) => el("li", {}, `${ref.type}:${ref.id}`)))
      : el("span", { className: "muted" }, "none")
  );
}

function selectedTargets(
  documentsTarget: HTMLInputElement,
  artifactsTarget: HTMLInputElement,
  facesTarget: HTMLInputElement
): Array<"documents" | "artifacts" | "faces"> {
  const targets: Array<"documents" | "artifacts" | "faces"> = [];
  if (documentsTarget.checked) {
    targets.push("documents");
  }
  if (artifactsTarget.checked) {
    targets.push("artifacts");
  }
  if (facesTarget.checked) {
    targets.push("faces");
  }
  return targets.length > 0 ? targets : ["documents", "artifacts", "faces"];
}

function readMetadataFilters(key: string, value: string): MetadataFilter[] {
  const normalizedKey = key.trim();
  const normalizedValue = value.trim();
  if (normalizedKey.length === 0) {
    return [];
  }
  const numericValue = Number(normalizedValue);
  if (Number.isFinite(numericValue) && normalizedValue.length > 0) {
    return [{ key: normalizedKey, operator: "eq", valueNumber: numericValue }];
  }
  return [{ key: normalizedKey, operator: "eq", valueText: normalizedValue }];
}

function input(label: string, value: string, type: string): HTMLInputElement {
  const node = document.createElement("input");
  node.type = type;
  node.setAttribute("aria-label", label);
  node.value = value;
  return node;
}

function checkbox(label: string, checked: boolean): HTMLInputElement {
  const node = input(label, "", "checkbox");
  node.checked = checked;
  return node;
}

function toggleField(control: HTMLInputElement): HTMLElement {
  return el("label", { className: "toggle-field" },
    control,
    el("span", {}, control.getAttribute("aria-label") ?? "")
  );
}

function textarea(label: string, value: string): HTMLTextAreaElement {
  const node = document.createElement("textarea");
  node.setAttribute("aria-label", label);
  node.value = value;
  node.rows = 3;
  return node;
}

function select(label: string, options: string[], selectedValue: string): HTMLSelectElement {
  const node = document.createElement("select");
  node.setAttribute("aria-label", label);
  for (const option of options) {
    const optionNode = document.createElement("option");
    optionNode.value = option;
    optionNode.textContent = option;
    optionNode.selected = option === selectedValue;
    node.append(optionNode);
  }
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

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
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

function readPositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sourceRefTypeOptions(): string[] {
  return ["session", "message", "document", "chunk", "artifact", "processing_run", "face_identity", "face_observation", "memory"];
}
