export type ConfigValueType = "string" | "number" | "boolean" | "enum";
export type ConfigSupportStatus = "supported" | "experimental" | "future" | "internal";
export type ConfigVisibility = "runtime" | "installer" | "both" | "test";

export interface ConfigCatalogSection {
  id: string;
  title: string;
  description: string;
}

export interface ConfigPromptMetadata {
  label: string;
  help: string;
}

export interface ConfigResourceHint {
  cpu?: string;
  memory?: string;
  disk?: string;
  gpu?: string;
}

export interface ConfigCatalogEntry {
  name: string;
  section: string;
  type: ConfigValueType;
  defaultValue: string;
  description: string;
  visibility: ConfigVisibility;
  supportStatus: ConfigSupportStatus;
  secret: boolean;
  required: boolean;
  allowedValues?: readonly string[];
  prompt?: ConfigPromptMetadata;
  resourceHint?: ConfigResourceHint;
}

export type LlmProviderCatalogValue = "disabled" | "openai-compatible" | "ollama" | "local-http" | "local-command";
export type LlmRoleCatalogKey =
  | "CHAT"
  | "TEXT_EMBEDDING"
  | "IMAGE_EMBEDDING"
  | "VISION_CAPTIONING"
  | "OCR"
  | "ASR"
  | "FACE_DETECTION"
  | "FACE_RECOGNITION"
  | "IMAGE_GENERATION"
  | "AUDIO_GENERATION";

export interface LlmRoleSupportCatalogEntry {
  key: LlmRoleCatalogKey;
  status: ConfigSupportStatus;
  defaultProvider: LlmProviderCatalogValue;
  defaultModel: string;
  providerSupport: Record<LlmProviderCatalogValue, ConfigSupportStatus>;
}

export const LLM_PROVIDER_VALUES = [
  "disabled",
  "openai-compatible",
  "ollama",
  "local-http",
  "local-command"
] as const satisfies readonly LlmProviderCatalogValue[];

export const LLM_ROLE_SUPPORT_CATALOG = [
  llmRoleSupport("CHAT", "supported", "disabled", "", {
    "openai-compatible": "supported",
    "ollama": "future",
    "local-http": "supported",
    "local-command": "future"
  }),
  llmRoleSupport("TEXT_EMBEDDING", "supported", "disabled", "", {
    "openai-compatible": "supported",
    "ollama": "supported",
    "local-http": "supported",
    "local-command": "future"
  }),
  llmRoleSupport("IMAGE_EMBEDDING", "experimental", "local-http", "CLIP ViT-L-16-SigLIP2-256__webli", {
    "openai-compatible": "future",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "future"
  }),
  llmRoleSupport("VISION_CAPTIONING", "experimental", "disabled", "", {
    "openai-compatible": "experimental",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "future"
  }),
  llmRoleSupport("OCR", "experimental", "local-http", "ESLAV__PP-OCRv5_mobile", {
    "openai-compatible": "experimental",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "future"
  }),
  llmRoleSupport("ASR", "experimental", "disabled", "", {
    "openai-compatible": "experimental",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "future"
  }),
  llmRoleSupport("FACE_DETECTION", "experimental", "local-http", "buffalo_l", {
    "openai-compatible": "future",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "future"
  }),
  llmRoleSupport("FACE_RECOGNITION", "experimental", "local-http", "buffalo_l", {
    "openai-compatible": "future",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "future"
  }),
  llmRoleSupport("IMAGE_GENERATION", "future", "disabled", "", {
    "openai-compatible": "future",
    "ollama": "future",
    "local-http": "future",
    "local-command": "future"
  }),
  llmRoleSupport("AUDIO_GENERATION", "future", "disabled", "", {
    "openai-compatible": "future",
    "ollama": "future",
    "local-http": "future",
    "local-command": "future"
  })
] as const satisfies readonly LlmRoleSupportCatalogEntry[];

const llmRoleSupportByKey = new Map(LLM_ROLE_SUPPORT_CATALOG.map((entry) => [entry.key, entry]));

export function requireLlmRoleSupportCatalogEntry(key: string): LlmRoleSupportCatalogEntry {
  const entry = llmRoleSupportByKey.get(key as LlmRoleCatalogKey);
  if (entry === undefined) {
    throw new Error(`${key} is not defined in the LLM role support catalog.`);
  }
  return entry;
}

export function llmRoleSupportStatus(key: string): ConfigSupportStatus {
  return requireLlmRoleSupportCatalogEntry(key).status;
}

export function llmRoleProviderSupportStatus(key: string, provider: string): ConfigSupportStatus {
  const entry = requireLlmRoleSupportCatalogEntry(key);
  const support = entry.providerSupport[provider as LlmProviderCatalogValue];
  if (support === undefined) {
    throw new Error(`${provider} is not valid for LLM role ${key}.`);
  }
  return support;
}

function llmRoleSupport(
  key: LlmRoleCatalogKey,
  status: ConfigSupportStatus,
  defaultProvider: LlmProviderCatalogValue,
  defaultModel: string,
  providerSupport: Omit<Record<LlmProviderCatalogValue, ConfigSupportStatus>, "disabled">
): LlmRoleSupportCatalogEntry {
  return {
    key,
    status,
    defaultProvider,
    defaultModel,
    providerSupport: {
      disabled: "supported",
      ...providerSupport
    }
  };
}

export const CONFIG_CATALOG_SECTIONS = [
  {
    id: "installer",
    title: "Mindory Installer",
    description: "Installer-owned state and one-folder deployment controls."
  },
  {
    id: "api",
    title: "Mindory API",
    description: "HTTP API listener, public URL and request guard settings."
  },
  {
    id: "database",
    title: "Database",
    description: "PostgreSQL connection settings."
  },
  {
    id: "redis",
    title: "Redis / BullMQ",
    description: "Redis queue and cache settings."
  },
  {
    id: "storage",
    title: "Object Storage",
    description: "Original object storage provider and backend settings."
  },
  {
    id: "vector",
    title: "Vector Index",
    description: "Document chunk vector search backend settings."
  },
  {
    id: "antivirus",
    title: "Antivirus",
    description: "Upload scanning policy and ClamAV connection settings."
  },
  {
    id: "workers",
    title: "Workers",
    description: "Background worker routing and concurrency settings."
  },
  {
    id: "document-processing",
    title: "Document Processing Router",
    description: "File-type routing and modality switches."
  },
  {
    id: "docling",
    title: "Docling Extraction Service",
    description: "Optional Docling-compatible PDF extraction service profile."
  },
  {
    id: "llm",
    title: "LLM SDK",
    description: "Central model-backed role and provider settings."
  },
  {
    id: "mcp",
    title: "MCP",
    description: "MCP stdio interface settings."
  },
  {
    id: "cli",
    title: "CLI",
    description: "CLI HTTP API defaults."
  },
  {
    id: "hermes",
    title: "Hermes Adapter",
    description: "Hermes runtime adapter defaults."
  },
  {
    id: "integration-tests",
    title: "Integration Tests",
    description: "Local integration test harness settings."
  },
  {
    id: "mvp-acceptance",
    title: "MVP Acceptance",
    description: "Demo and acceptance script settings."
  }
] as const satisfies readonly ConfigCatalogSection[];

export const CONFIG_CATALOG = [
  entry("MINDORY_HOME", "installer", "string", "~/.mindory", "Single Mindory-owned install root.", "installer", "supported", {
    prompt: {
      label: "Mindory home directory",
      help: "All generated config, compose files, data, logs, backups and install state live below this directory."
    }
  }),
  entry("MINDORY_INSTALL_PROFILE", "installer", "enum", "local-quickstart", "Installer profile selected by the wizard.", "installer", "supported", {
    allowedValues: ["local-quickstart", "persistent-local", "server-domain", "dev-test"],
    prompt: {
      label: "Install profile",
      help: "Controls the defaults used by the one-command installer."
    }
  }),
  entry("MINDORY_INSTALL_RELEASE_CHANNEL", "installer", "string", "stable", "Release channel used by the bootstrap installer.", "installer", "supported"),
  entry("MINDORY_INSTALL_ALLOW_EXPERIMENTAL", "installer", "boolean", "false", "Allow experimental choices in the installer wizard.", "installer", "supported"),
  entry("MINDORY_INSTALL_DEPENDENCY_POLICY", "installer", "enum", "ask", "How the installer handles missing host dependencies.", "installer", "supported", {
    allowedValues: ["ask", "manual", "auto"]
  }),
  entry("MINDORY_INSTALL_ROLLBACK_ON_FAILURE", "installer", "boolean", "true", "Rollback Mindory-created state when install fails.", "installer", "supported"),
  entry("MINDORY_INSTALL_DEV_MODE", "installer", "boolean", "false", "Enable installer dev/test matrix behavior.", "installer", "supported"),

  entry("MINDORY_LOG_LEVEL", "api", "string", "info", "Structured log level.", "runtime", "supported"),
  entry("MINDORY_API_HOST", "api", "string", "0.0.0.0", "API listen host.", "runtime", "supported"),
  entry("MINDORY_API_PORT", "api", "number", "3000", "API listen port.", "runtime", "supported"),
  entry("MINDORY_PUBLIC_URL", "api", "string", "http://localhost:3000", "Public API URL used by clients and adapters.", "both", "supported", {
    prompt: {
      label: "Public URL",
      help: "Use localhost for local installs or a full https:// domain URL for server installs."
    }
  }),
  entry("MINDORY_API_RATE_LIMIT_ENABLED", "api", "boolean", "true", "Enable the in-process API rate limit guard.", "runtime", "supported"),
  entry("MINDORY_API_RATE_LIMIT_WINDOW_MS", "api", "number", "60000", "Rate limit window length in milliseconds.", "runtime", "supported"),
  entry("MINDORY_API_RATE_LIMIT_MAX", "api", "number", "600", "Maximum requests allowed per rate limit window.", "runtime", "supported"),

  entry("MINDORY_DATABASE_URL", "database", "string", "postgresql://mindory:mindory@postgres:5432/mindory", "PostgreSQL database URL.", "both", "supported", {
    secret: true
  }),

  entry("MINDORY_REDIS_URL", "redis", "string", "redis://redis:6379", "Redis URL used by BullMQ and cache namespaces.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_QUEUE_PREFIX", "redis", "string", "mindory:queue", "BullMQ key prefix.", "runtime", "supported"),
  entry("MINDORY_CACHE_PREFIX", "redis", "string", "mindory:cache", "Cache key prefix.", "runtime", "supported"),

  entry("MINDORY_STORAGE_PROVIDER", "storage", "enum", "local-fs", "Object storage provider.", "both", "supported", {
    allowedValues: ["local-fs", "s3"],
    prompt: {
      label: "Object storage",
      help: "Use local-fs for simple local installs or s3 for LibreFS/external S3-compatible storage."
    }
  }),
  entry("MINDORY_STORAGE_LOCAL_PATH", "storage", "string", "/data/mindory/objects", "Local filesystem object root inside the runtime container.", "both", "supported"),
  entry("MINDORY_S3_ENDPOINT", "storage", "string", "http://librefs:9000", "S3-compatible endpoint URL.", "both", "supported"),
  entry("MINDORY_S3_REGION", "storage", "string", "us-east-1", "S3-compatible region.", "both", "supported"),
  entry("MINDORY_S3_BUCKET", "storage", "string", "mindory", "S3-compatible bucket name.", "both", "supported"),
  entry("MINDORY_S3_ACCESS_KEY_ID", "storage", "string", "mindory", "S3-compatible access key id.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_S3_SECRET_ACCESS_KEY", "storage", "string", "mindory-secret", "S3-compatible secret access key.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_S3_FORCE_PATH_STYLE", "storage", "boolean", "true", "Use path-style S3-compatible addressing.", "both", "supported"),

  entry("MINDORY_VECTOR_PROVIDER", "vector", "enum", "pgvector", "Vector index provider.", "both", "supported", {
    allowedValues: ["pgvector", "qdrant"]
  }),
  entry("MINDORY_QDRANT_URL", "vector", "string", "http://qdrant:6333", "Qdrant HTTP API URL.", "both", "supported"),
  entry("MINDORY_QDRANT_COLLECTION_PREFIX", "vector", "string", "mindory", "Qdrant collection prefix.", "both", "supported"),
  entry("MINDORY_QDRANT_HTTP_PORT", "vector", "number", "6333", "Host port published by the Qdrant Compose profile.", "installer", "supported"),
  entry("MINDORY_QDRANT_GRPC_PORT", "vector", "number", "6334", "Host gRPC port published by the Qdrant Compose profile.", "installer", "supported"),

  entry("MINDORY_AV_ENABLED", "antivirus", "boolean", "true", "Enable antivirus processing.", "both", "supported"),
  entry("MINDORY_AV_PROVIDER", "antivirus", "string", "clamav", "Antivirus provider name.", "both", "supported"),
  entry("MINDORY_AV_MODE", "antivirus", "enum", "async_quarantine", "Antivirus mode.", "both", "supported", {
    allowedValues: ["disabled", "async_quarantine", "sync_scan"],
    prompt: {
      label: "Antivirus mode",
      help: "Choose disabled, asynchronous quarantine or synchronous scan."
    }
  }),
  entry("MINDORY_AV_REQUIRED_BEFORE_READ", "antivirus", "boolean", "true", "Require scan before document read.", "runtime", "supported"),
  entry("MINDORY_AV_REQUIRED_BEFORE_EXTRACTION", "antivirus", "boolean", "true", "Require scan before extraction.", "runtime", "supported"),
  entry("MINDORY_AV_REQUIRED_BEFORE_INDEXING", "antivirus", "boolean", "true", "Require scan before indexing.", "runtime", "supported"),
  entry("MINDORY_AV_ON_SCAN_FAILURE", "antivirus", "enum", "block", "Policy for antivirus scan failures.", "runtime", "supported", {
    allowedValues: ["block", "allow_with_warning"]
  }),
  entry("MINDORY_AV_ON_INFECTED", "antivirus", "enum", "quarantine", "Policy for infected uploads.", "runtime", "supported", {
    allowedValues: ["quarantine", "delete"]
  }),
  entry("MINDORY_CLAMAV_HOST", "antivirus", "string", "clamav", "ClamAV host.", "runtime", "supported"),
  entry("MINDORY_CLAMAV_PORT", "antivirus", "number", "3310", "ClamAV port.", "runtime", "supported"),
  entry("MINDORY_CLAMAV_PLATFORM", "antivirus", "string", "linux/amd64", "Compose platform override for the ClamAV image.", "installer", "supported"),

  entry("MINDORY_WORKER_TYPE", "workers", "string", "all", "Worker type filter.", "runtime", "supported"),
  entry("MINDORY_WORKER_CONCURRENCY", "workers", "number", "2", "Worker concurrency.", "runtime", "supported"),

  entry("MINDORY_DOCUMENT_PROCESSING_ROUTING_ENABLED", "document-processing", "boolean", "true", "Enable post-upload file-type routing.", "both", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_TEXT_ENABLED", "document-processing", "boolean", "true", "Enable text document processing.", "both", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_TEXT_REQUIRED", "document-processing", "boolean", "false", "Treat text processing as required.", "runtime", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_PDF_ENABLED", "document-processing", "boolean", "true", "Enable PDF document processing.", "both", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_PDF_REQUIRED", "document-processing", "boolean", "false", "Treat PDF processing as required.", "runtime", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_IMAGE_ENABLED", "document-processing", "boolean", "true", "Enable image document processing.", "both", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_IMAGE_REQUIRED", "document-processing", "boolean", "false", "Treat image processing as required.", "runtime", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_AUDIO_ENABLED", "document-processing", "boolean", "true", "Enable audio document processing.", "both", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_AUDIO_REQUIRED", "document-processing", "boolean", "false", "Treat audio processing as required.", "runtime", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_ENABLED", "document-processing", "boolean", "true", "Enable video document processing.", "both", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_REQUIRED", "document-processing", "boolean", "false", "Treat video processing as required.", "runtime", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", "document-processing", "number", "10", "Maximum derived video keyframes.", "both", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER", "document-processing", "enum", "manifest", "Video keyframe extraction provider.", "runtime", "supported", {
    allowedValues: ["manifest", "local-command"]
  }),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND", "document-processing", "string", "", "Executable for local-command video keyframe extraction.", "runtime", "experimental"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_ARGS", "document-processing", "string", "", "JSON string array of local-command keyframe extraction arguments.", "runtime", "experimental"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS", "document-processing", "number", "120000", "Timeout for local-command video keyframe extraction.", "runtime", "experimental"),

  entry("MINDORY_DOCLING_ENABLED", "docling", "boolean", "false", "Route PDF extraction through the Docling-compatible HTTP service.", "both", "supported", {
    prompt: {
      label: "Enable Docling service",
      help: "Starts the Docling-compatible Compose profile and makes workers call it for PDF extraction."
    }
  }),
  entry("MINDORY_DOCLING_HOST", "docling", "string", "0.0.0.0", "Docling service listen host.", "runtime", "supported"),
  entry("MINDORY_DOCLING_URL", "docling", "string", "http://docling:8081", "Docling-compatible extraction service base URL.", "both", "supported"),
  entry("MINDORY_DOCLING_TIMEOUT_MS", "docling", "number", "120000", "Docling extraction request timeout in milliseconds.", "both", "supported"),
  entry("MINDORY_DOCLING_PORT", "docling", "number", "8081", "Docling service container and host HTTP port.", "both", "supported"),

  llmRoleEntries("CHAT", "Chat/completion calls for agent-facing LLM features."),
  llmRoleEntries("TEXT_EMBEDDING", "Text embeddings for semantic document search.", { dimensions: true }),
  llmRoleEntries("IMAGE_EMBEDDING", "CLIP/image embeddings for visual search.", {
    dimensions: true,
    resourceHint: { memory: "8GB+", disk: "3GB+", gpu: "recommended" }
  }),
  llmRoleEntries("VISION_CAPTIONING", "Vision captioning for image/video frames."),
  llmRoleEntries("OCR", "OCR for images and scanned PDFs.", {
    resourceHint: { memory: "4GB+", disk: "1GB+" }
  }),
  llmRoleEntries("ASR", "ASR for audio and video transcripts."),
  llmRoleEntries("FACE_DETECTION", "Face detection for workspace-scoped face observations.", {
    resourceHint: { memory: "4GB+", disk: "1GB+" }
  }),
  llmRoleEntries("FACE_RECOGNITION", "Face recognition for workspace-scoped face identity matching.", {
    resourceHint: { memory: "4GB+", disk: "1GB+" }
  }),
  llmRoleEntries("IMAGE_GENERATION", "Image generation for future agent outputs."),
  llmRoleEntries("AUDIO_GENERATION", "Audio generation for future agent outputs."),
  entry("MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL", "llm", "string", "", "OpenAI-compatible base URL.", "both", "supported"),
  entry("MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE", "llm", "enum", "none", "OpenAI-compatible auth mode.", "both", "supported", {
    allowedValues: ["none", "api-key", "oauth-bearer"]
  }),
  entry("MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY", "llm", "string", "", "OpenAI-compatible API key.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN", "llm", "string", "", "OpenAI-compatible OAuth bearer token.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_LLM_OLLAMA_BASE_URL", "llm", "string", "http://ollama:11434", "Ollama base URL.", "both", "supported"),
  entry("MINDORY_LLM_LOCAL_HTTP_BASE_URL", "llm", "string", "http://llm:8080", "Local HTTP model server base URL.", "both", "supported"),
  entry("MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS", "llm", "number", "120000", "Default timeout for local command providers.", "both", "future"),

  entry("MINDORY_MCP_ENABLED", "mcp", "boolean", "true", "Enable the MCP stdio server.", "runtime", "supported"),
  entry("MINDORY_MCP_TRANSPORT", "mcp", "enum", "stdio", "MCP transport.", "runtime", "supported", {
    allowedValues: ["stdio"]
  }),
  entry("MINDORY_MCP_API_URL", "mcp", "string", "http://localhost:3000", "MCP HTTP API URL.", "both", "supported"),
  entry("MINDORY_MCP_API_TOKEN", "mcp", "string", "", "MCP bearer token.", "both", "supported", {
    secret: true
  }),

  entry("MINDORY_CLI_API_URL", "cli", "string", "http://localhost:3000", "CLI HTTP API URL.", "both", "supported"),
  entry("MINDORY_CLI_API_TOKEN", "cli", "string", "", "CLI bearer token.", "both", "supported", {
    secret: true
  }),

  entry("MINDORY_HERMES_ADAPTER_ENABLED", "hermes", "boolean", "false", "Enable Hermes adapter defaults.", "both", "supported"),
  entry("MINDORY_HERMES_API_URL", "hermes", "string", "http://localhost:3000", "Hermes adapter HTTP API URL.", "both", "supported"),
  entry("MINDORY_HERMES_API_TOKEN", "hermes", "string", "", "Hermes adapter bearer token.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_HERMES_DEFAULT_PROJECT", "hermes", "string", "default", "Default Hermes project id.", "both", "supported"),
  entry("MINDORY_HERMES_DEFAULT_USER_PEER", "hermes", "string", "default-user", "Default Hermes user peer id.", "both", "supported"),
  entry("MINDORY_HERMES_DEFAULT_AGENT_PEER", "hermes", "string", "hermes", "Default Hermes agent peer id.", "both", "supported"),
  entry("MINDORY_HERMES_CONTEXT_TOKEN_BUDGET", "hermes", "number", "3000", "Default Hermes context token budget.", "both", "supported"),

  entry("MINDORY_TEST_POSTGRES_PORT", "integration-tests", "number", "55432", "Integration test PostgreSQL host port.", "test", "supported"),
  entry("MINDORY_TEST_REDIS_PORT", "integration-tests", "number", "56379", "Integration test Redis host port.", "test", "supported"),
  entry("MINDORY_TEST_QDRANT_PORT", "integration-tests", "number", "56333", "Integration test Qdrant HTTP host port.", "test", "supported"),
  entry("MINDORY_TEST_DATABASE_URL", "integration-tests", "string", "", "External integration test database URL.", "test", "supported", {
    secret: true
  }),
  entry("MINDORY_TEST_REDIS_URL", "integration-tests", "string", "", "External integration test Redis URL.", "test", "supported", {
    secret: true
  }),
  entry("MINDORY_TEST_QDRANT_URL", "integration-tests", "string", "", "External integration test Qdrant HTTP URL.", "test", "supported"),
  entry("MINDORY_TEST_SKIP_DOCKER", "integration-tests", "boolean", "false", "Skip Docker-managed integration test dependencies.", "test", "supported"),
  entry("MINDORY_TEST_SKIP_BUILD", "integration-tests", "boolean", "false", "Skip pre-test TypeScript build.", "test", "supported"),
  entry("MINDORY_TEST_DOCKER_BIN", "integration-tests", "string", "/usr/local/bin/docker", "Docker binary path for integration tests.", "test", "supported"),

  entry("MINDORY_E2E_LIVE", "mvp-acceptance", "boolean", "false", "Run MVP acceptance against a live API.", "test", "supported"),
  entry("MINDORY_E2E_API_URL", "mvp-acceptance", "string", "http://localhost:3000", "MVP acceptance API URL.", "test", "supported"),
  entry("MINDORY_E2E_REQUIRE_INDEXED", "mvp-acceptance", "boolean", "false", "Require indexed document status in MVP acceptance.", "test", "supported"),
  entry("MINDORY_E2E_MODEL_PROFILE", "mvp-acceptance", "enum", "disabled", "MVP demo model profile.", "test", "supported", {
    allowedValues: ["disabled", "local", "ollama"]
  }),
  entry("MINDORY_DEMO_PROJECT_ID", "mvp-acceptance", "string", "mindory-demo", "Deterministic demo project id.", "test", "supported"),
  entry("MINDORY_DEMO_TOKEN", "mvp-acceptance", "string", "mindory-demo-token", "Deterministic demo bearer token.", "test", "supported", {
    secret: true
  }),
  entry("MINDORY_DEMO_TOKEN_ID", "mvp-acceptance", "string", "tok_mindory_demo", "Deterministic demo token id.", "test", "supported")
] as const satisfies readonly (ConfigCatalogEntry | readonly ConfigCatalogEntry[])[];

export const FLAT_CONFIG_CATALOG = CONFIG_CATALOG.flat();

const catalogByName = new Map(FLAT_CONFIG_CATALOG.map((item) => [item.name, item]));

export function getConfigCatalogEntry(name: string): ConfigCatalogEntry | undefined {
  return catalogByName.get(name);
}

export function requireConfigCatalogEntry(name: string): ConfigCatalogEntry {
  const entry = getConfigCatalogEntry(name);
  if (entry === undefined) {
    throw new Error(`${name} is not defined in the Mindory config catalog.`);
  }
  return entry;
}

export function configDefaultValue(name: string): string {
  return requireConfigCatalogEntry(name).defaultValue;
}

export function configDefaultBoolean(name: string): boolean {
  const value = configDefaultValue(name);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} catalog default must be true or false.`);
}

export function configDefaultNumber(name: string): number {
  const value = Number.parseInt(configDefaultValue(name), 10);
  if (Number.isNaN(value)) {
    throw new Error(`${name} catalog default must be a number.`);
  }
  return value;
}

export function configAllowedValues(name: string): readonly string[] {
  const entry = requireConfigCatalogEntry(name);
  if (entry.type !== "enum" || entry.allowedValues === undefined) {
    throw new Error(`${name} is not an enum catalog entry.`);
  }
  return entry.allowedValues;
}

function llmRoleEntries(
  key: string,
  description: string,
  options: {
    dimensions?: boolean;
    resourceHint?: ConfigResourceHint;
  } = {}
): ConfigCatalogEntry[] {
  const prefix = `MINDORY_LLM_${key}`;
  const roleSupport = requireLlmRoleSupportCatalogEntry(key);
  const role = key.toLowerCase().replace(/_/g, " ");
  const enabledOptions: Parameters<typeof entry>[7] = {
    prompt: {
      label: `Enable ${role}`,
      help: description
    }
  };

  if (options.resourceHint !== undefined) {
    enabledOptions.resourceHint = options.resourceHint;
  }

  const entries = [
    entry(`${prefix}_ENABLED`, "llm", "boolean", "false", `Enable ${description}`, "both", roleSupport.status, enabledOptions),
    entry(`${prefix}_PROVIDER`, "llm", "enum", roleSupport.defaultProvider, `${description} provider.`, "both", roleSupport.status, {
      allowedValues: LLM_PROVIDER_VALUES
    }),
    entry(`${prefix}_MODEL`, "llm", "string", roleSupport.defaultModel, `${description} model name.`, "both", roleSupport.status),
    entry(`${prefix}_REQUIRED`, "llm", "boolean", "false", `Require ${description}`, "both", roleSupport.status),
    entry(`${prefix}_TIMEOUT_MS`, "llm", "number", "60000", `${description} timeout in milliseconds.`, "both", roleSupport.status),
    entry(`${prefix}_CONCURRENCY`, "llm", "number", "1", `${description} concurrency limit.`, "both", roleSupport.status)
  ];

  if (options.dimensions === true) {
    entries.splice(3, 0, entry(`${prefix}_DIMENSIONS`, "llm", "string", "", `${description} embedding dimensions.`, "both", roleSupport.status));
  }

  return entries;
}

function entry(
  name: string,
  section: string,
  type: ConfigValueType,
  defaultValue: string,
  description: string,
  visibility: ConfigVisibility,
  supportStatus: ConfigSupportStatus,
  options: {
    allowedValues?: readonly string[];
    secret?: boolean;
    required?: boolean;
    prompt?: ConfigPromptMetadata;
    resourceHint?: ConfigResourceHint;
  } = {}
): ConfigCatalogEntry {
  const catalogEntry: ConfigCatalogEntry = {
    name,
    section,
    type,
    defaultValue,
    description,
    visibility,
    supportStatus,
    secret: options.secret ?? false,
    required: options.required ?? false
  };
  if (options.allowedValues !== undefined) {
    catalogEntry.allowedValues = options.allowedValues;
  }
  if (options.prompt !== undefined) {
    catalogEntry.prompt = options.prompt;
  }
  if (options.resourceHint !== undefined) {
    catalogEntry.resourceHint = options.resourceHint;
  }
  return catalogEntry;
}
