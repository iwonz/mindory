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

export type LocalModelRunnerStatus = "supported" | "experimental";
export type LocalModelRunnerProvider = "local-http" | "ollama" | "local-command";
export type LocalModelRunnerHealthcheckKind = "http" | "ollama-tags" | "command";

export interface LocalModelRunnerPort {
  name: string;
  containerPort: number;
  defaultHostPort: number;
  envName?: string;
}

export interface LocalModelFileCatalogEntry {
  name: string;
  sourceUrl: string;
  sizeHint: string;
  targetPath: string;
}

export interface LocalModelRunnerHealthcheck {
  kind: LocalModelRunnerHealthcheckKind;
  endpoint?: string;
  command?: readonly string[];
  timeoutMs: number;
}

export interface LocalModelRunnerCatalogEntry {
  id: string;
  title: string;
  status: LocalModelRunnerStatus;
  provider: LocalModelRunnerProvider;
  roles: readonly LlmRoleCatalogKey[];
  composeProfile: string;
  serviceName: string;
  containerImage?: string;
  sourceUrl: string;
  modelNames: readonly string[];
  modelFiles: readonly LocalModelFileCatalogEntry[];
  license: string;
  ports: readonly LocalModelRunnerPort[];
  healthcheck: LocalModelRunnerHealthcheck;
  resourceHint: Required<ConfigResourceHint>;
  notes: string;
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
    "local-command": "supported"
  }),
  llmRoleSupport("TEXT_EMBEDDING", "supported", "disabled", "", {
    "openai-compatible": "supported",
    "ollama": "supported",
    "local-http": "supported",
    "local-command": "supported"
  }),
  llmRoleSupport("IMAGE_EMBEDDING", "experimental", "local-http", "CLIP ViT-L-16-SigLIP2-256__webli", {
    "openai-compatible": "future",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "experimental"
  }),
  llmRoleSupport("VISION_CAPTIONING", "experimental", "disabled", "", {
    "openai-compatible": "experimental",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "experimental"
  }),
  llmRoleSupport("OCR", "experimental", "local-http", "ESLAV__PP-OCRv5_mobile", {
    "openai-compatible": "experimental",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "experimental"
  }),
  llmRoleSupport("ASR", "experimental", "disabled", "", {
    "openai-compatible": "experimental",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "experimental"
  }),
  llmRoleSupport("FACE_DETECTION", "experimental", "local-http", "buffalo_l", {
    "openai-compatible": "future",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "experimental"
  }),
  llmRoleSupport("FACE_RECOGNITION", "experimental", "local-http", "buffalo_l", {
    "openai-compatible": "future",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "experimental"
  }),
  llmRoleSupport("IMAGE_GENERATION", "experimental", "disabled", "", {
    "openai-compatible": "experimental",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "experimental"
  }),
  llmRoleSupport("AUDIO_GENERATION", "experimental", "disabled", "", {
    "openai-compatible": "experimental",
    "ollama": "future",
    "local-http": "experimental",
    "local-command": "experimental"
  })
] as const satisfies readonly LlmRoleSupportCatalogEntry[];

export const LOCAL_MODEL_RUNNER_CATALOG = [
  localModelRunner({
    id: "mindory-deterministic-local-http",
    title: "Mindory deterministic local HTTP runner",
    status: "supported",
    provider: "local-http",
    roles: [
      "TEXT_EMBEDDING",
      "IMAGE_EMBEDDING",
      "OCR",
      "ASR",
      "VISION_CAPTIONING",
      "FACE_DETECTION",
      "FACE_RECOGNITION"
    ],
    composeProfile: "local-models",
    serviceName: "llm",
    containerImage: "mindory release image",
    sourceUrl: "repo://scripts/local-model-server.mjs",
    modelNames: [
      "mindory-local-text-embedding",
      "mindory-local-image-embedding",
      "mindory-local-ocr",
      "mindory-local-asr",
      "mindory-local-vision",
      "mindory-local-face"
    ],
    modelFiles: [
      {
        name: "local-model-server.mjs",
        sourceUrl: "repo://scripts/local-model-server.mjs",
        sizeHint: "<1MB",
        targetPath: "$MINDORY_HOME/install/current/scripts/local-model-server.mjs"
      }
    ],
    license: "Apache-2.0, same as the Mindory repository",
    ports: [
      {
        name: "http",
        containerPort: 8080,
        defaultHostPort: 8080,
        envName: "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
      }
    ],
    healthcheck: {
      kind: "http",
      endpoint: "GET /health",
      timeoutMs: 30000
    },
    resourceHint: {
      cpu: "1 core",
      memory: "256MB",
      disk: "<100MB",
      gpu: "not required"
    },
    notes: "Deterministic runner used for local acceptance and self-contained indexed search checks."
  }),
  localModelRunner({
    id: "ollama-nomic-embed-text",
    title: "Ollama Nomic text embeddings",
    status: "supported",
    provider: "ollama",
    roles: ["TEXT_EMBEDDING"],
    composeProfile: "ollama",
    serviceName: "ollama",
    containerImage: "ollama/ollama:latest",
    sourceUrl: "https://ollama.com/library/nomic-embed-text",
    modelNames: ["nomic-embed-text"],
    modelFiles: [
      {
        name: "nomic-embed-text",
        sourceUrl: "ollama://nomic-embed-text",
        sizeHint: "300MB-1GB",
        targetPath: "$MINDORY_HOME/data/ollama"
      }
    ],
    license: "Apache-2.0 model family; verify upstream model card before redistribution",
    ports: [
      {
        name: "http",
        containerPort: 11434,
        defaultHostPort: 11434,
        envName: "MINDORY_LLM_OLLAMA_BASE_URL"
      }
    ],
    healthcheck: {
      kind: "ollama-tags",
      endpoint: "GET /api/tags",
      timeoutMs: 60000
    },
    resourceHint: {
      cpu: "2+ cores",
      memory: "4GB+",
      disk: "1GB+",
      gpu: "optional"
    },
    notes: "Local text embedding runner for users who already operate Ollama or choose the Ollama profile."
  }),
  localModelRunner({
    id: "openclip-siglip2-image-embedding",
    title: "OpenCLIP SigLIP2 image embeddings",
    status: "experimental",
    provider: "local-http",
    roles: ["IMAGE_EMBEDDING"],
    composeProfile: "local-models-vision",
    serviceName: "clip",
    sourceUrl: "https://github.com/mlfoundations/open_clip",
    modelNames: ["ViT-L-16-SigLIP2-256__webli"],
    modelFiles: [
      {
        name: "ViT-L-16-SigLIP2-256__webli",
        sourceUrl: "https://huggingface.co/timm/ViT-L-16-SigLIP2-256",
        sizeHint: "2GB-4GB",
        targetPath: "$MINDORY_HOME/data/models/openclip"
      }
    ],
    license: "MIT runtime; verify upstream model card before redistribution",
    ports: [
      {
        name: "http",
        containerPort: 8082,
        defaultHostPort: 8082,
        envName: "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
      }
    ],
    healthcheck: {
      kind: "http",
      endpoint: "GET /health",
      timeoutMs: 120000
    },
    resourceHint: {
      cpu: "4+ cores",
      memory: "8GB+",
      disk: "5GB+",
      gpu: "recommended"
    },
    notes: "Image embedding runner aligned with the default CLIP/SigLIP2 model name in the LLM role catalog."
  }),
  localModelRunner({
    id: "paddleocr-pp-ocrv5-mobile",
    title: "PaddleOCR PP-OCRv5 mobile OCR",
    status: "experimental",
    provider: "local-http",
    roles: ["OCR"],
    composeProfile: "local-models-ocr",
    serviceName: "ocr",
    sourceUrl: "https://github.com/PaddlePaddle/PaddleOCR",
    modelNames: ["ESLAV__PP-OCRv5_mobile"],
    modelFiles: [
      {
        name: "PP-OCRv5_mobile_det",
        sourceUrl: "https://github.com/PaddlePaddle/PaddleOCR",
        sizeHint: "50MB-200MB",
        targetPath: "$MINDORY_HOME/data/models/paddleocr"
      },
      {
        name: "PP-OCRv5_mobile_rec",
        sourceUrl: "https://github.com/PaddlePaddle/PaddleOCR",
        sizeHint: "50MB-200MB",
        targetPath: "$MINDORY_HOME/data/models/paddleocr"
      }
    ],
    license: "Apache-2.0",
    ports: [
      {
        name: "http",
        containerPort: 8083,
        defaultHostPort: 8083,
        envName: "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
      }
    ],
    healthcheck: {
      kind: "http",
      endpoint: "GET /health",
      timeoutMs: 120000
    },
    resourceHint: {
      cpu: "2+ cores",
      memory: "4GB+",
      disk: "1GB+",
      gpu: "optional"
    },
    notes: "OCR runner for image and scanned-PDF page artifacts."
  }),
  localModelRunner({
    id: "faster-whisper-small-asr",
    title: "Faster Whisper small ASR",
    status: "experimental",
    provider: "local-http",
    roles: ["ASR"],
    composeProfile: "local-models-asr",
    serviceName: "asr",
    sourceUrl: "https://github.com/SYSTRAN/faster-whisper",
    modelNames: ["whisper-small"],
    modelFiles: [
      {
        name: "openai/whisper-small",
        sourceUrl: "https://huggingface.co/openai/whisper-small",
        sizeHint: "1GB-2GB",
        targetPath: "$MINDORY_HOME/data/models/whisper"
      }
    ],
    license: "MIT",
    ports: [
      {
        name: "http",
        containerPort: 8084,
        defaultHostPort: 8084,
        envName: "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
      }
    ],
    healthcheck: {
      kind: "http",
      endpoint: "GET /health",
      timeoutMs: 120000
    },
    resourceHint: {
      cpu: "4+ cores",
      memory: "6GB+",
      disk: "3GB+",
      gpu: "recommended for long audio"
    },
    notes: "ASR runner for time-coded audio and video transcript artifacts."
  }),
  localModelRunner({
    id: "moondream2-vision-captioning",
    title: "Moondream2 vision captioning",
    status: "experimental",
    provider: "local-http",
    roles: ["VISION_CAPTIONING"],
    composeProfile: "local-models-vision",
    serviceName: "vision",
    sourceUrl: "https://huggingface.co/vikhyatk/moondream2",
    modelNames: ["moondream2"],
    modelFiles: [
      {
        name: "vikhyatk/moondream2",
        sourceUrl: "https://huggingface.co/vikhyatk/moondream2",
        sizeHint: "4GB-6GB",
        targetPath: "$MINDORY_HOME/data/models/moondream2"
      }
    ],
    license: "Apache-2.0",
    ports: [
      {
        name: "http",
        containerPort: 8085,
        defaultHostPort: 8085,
        envName: "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
      }
    ],
    healthcheck: {
      kind: "http",
      endpoint: "GET /health",
      timeoutMs: 120000
    },
    resourceHint: {
      cpu: "4+ cores",
      memory: "8GB+",
      disk: "8GB+",
      gpu: "recommended"
    },
    notes: "Vision captioning runner for image and keyframe descriptions, labels and object hints."
  }),
  localModelRunner({
    id: "compreface-face-services",
    title: "CompreFace face detection and recognition",
    status: "experimental",
    provider: "local-http",
    roles: ["FACE_DETECTION", "FACE_RECOGNITION"],
    composeProfile: "local-models-face",
    serviceName: "faces",
    containerImage: "exadel/compreface:latest",
    sourceUrl: "https://github.com/exadel-inc/CompreFace",
    modelNames: ["buffalo_l"],
    modelFiles: [
      {
        name: "CompreFace recognition bundle",
        sourceUrl: "https://github.com/exadel-inc/CompreFace",
        sizeHint: "2GB-4GB",
        targetPath: "$MINDORY_HOME/data/models/compreface"
      }
    ],
    license: "Apache-2.0 runtime; verify bundled model licenses before redistribution",
    ports: [
      {
        name: "http",
        containerPort: 8086,
        defaultHostPort: 8086,
        envName: "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
      }
    ],
    healthcheck: {
      kind: "http",
      endpoint: "GET /health",
      timeoutMs: 180000
    },
    resourceHint: {
      cpu: "4+ cores",
      memory: "8GB+",
      disk: "8GB+",
      gpu: "optional"
    },
    notes: "Workspace-scoped face observation and identity matching runner."
  })
] as const satisfies readonly LocalModelRunnerCatalogEntry[];

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

function localModelRunner(entry: LocalModelRunnerCatalogEntry): LocalModelRunnerCatalogEntry {
  return entry;
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
    id: "metrics",
    title: "Metrics Exporter",
    description: "Prometheus-compatible API and worker metrics settings."
  },
  {
    id: "telemetry",
    title: "OpenTelemetry Export",
    description: "OTLP trace and structured log export settings."
  },
  {
    id: "backups",
    title: "Backups",
    description: "Local, scheduled, PITR and encrypted remote backup settings."
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

  entry("MINDORY_METRICS_ENABLED", "metrics", "boolean", "false", "Enable Prometheus-compatible metrics endpoints.", "both", "supported"),
  entry("MINDORY_METRICS_PATH", "metrics", "string", "/metrics", "HTTP path for metrics scraping.", "both", "supported"),
  entry("MINDORY_METRICS_BEARER_TOKEN", "metrics", "string", "", "Optional bearer token required by metrics endpoints.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_METRICS_WORKER_HOST", "metrics", "string", "0.0.0.0", "Worker metrics HTTP listen host.", "runtime", "supported"),
  entry("MINDORY_METRICS_WORKER_PORT", "metrics", "number", "3001", "Worker metrics HTTP listen port.", "both", "supported"),

  entry("MINDORY_OTEL_TRACES_ENABLED", "telemetry", "boolean", "false", "Enable OTLP trace export for API, worker, storage, vector, jobs and model operations.", "both", "supported"),
  entry("MINDORY_OTEL_SERVICE_NAME", "telemetry", "string", "mindory", "OpenTelemetry service.name prefix used by Mindory runtimes.", "both", "supported"),
  entry("MINDORY_OTEL_EXPORTER_OTLP_ENDPOINT", "telemetry", "string", "http://localhost:4318/v1/traces", "OTLP HTTP traces endpoint.", "both", "supported"),
  entry("MINDORY_OTEL_EXPORTER_OTLP_HEADERS", "telemetry", "string", "", "Comma-separated OTLP trace exporter headers.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_OTEL_EXPORT_TIMEOUT_MS", "telemetry", "number", "5000", "OTLP trace export timeout in milliseconds.", "both", "supported"),
  entry("MINDORY_OTEL_SAMPLE_RATE", "telemetry", "number", "1", "Trace sample rate from 0 to 1.", "both", "supported"),
  entry("MINDORY_OTEL_LOG_EXPORT_ENABLED", "telemetry", "boolean", "false", "Enable OTLP structured log export.", "both", "supported"),
  entry("MINDORY_OTEL_LOG_EXPORT_ENDPOINT", "telemetry", "string", "http://localhost:4318/v1/logs", "OTLP HTTP logs endpoint.", "both", "supported"),
  entry("MINDORY_OTEL_LOG_EXPORT_HEADERS", "telemetry", "string", "", "Comma-separated OTLP log exporter headers.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_OTEL_LOG_EXPORT_TIMEOUT_MS", "telemetry", "number", "5000", "OTLP structured log export timeout in milliseconds.", "both", "supported"),

  entry("MINDORY_BACKUP_SCHEDULE_ENABLED", "backups", "boolean", "false", "Enable scheduled local runtime backups.", "both", "supported"),
  entry("MINDORY_BACKUP_SCHEDULE_INTERVAL_MINUTES", "backups", "number", "1440", "Scheduled backup interval in minutes.", "both", "supported"),
  entry("MINDORY_BACKUP_RETENTION_COUNT", "backups", "number", "7", "Maximum scheduled backup sets to retain.", "both", "supported"),
  entry("MINDORY_BACKUP_RETENTION_DAYS", "backups", "number", "30", "Maximum scheduled backup age in days.", "both", "supported"),
  entry("MINDORY_BACKUP_INCLUDE_CONFIG", "backups", "boolean", "true", "Include config and installer state in scheduled backups.", "both", "supported"),
  entry("MINDORY_BACKUP_INCLUDE_POSTGRES", "backups", "boolean", "true", "Include PostgreSQL dumps in scheduled backups.", "both", "supported"),
  entry("MINDORY_BACKUP_INCLUDE_OBJECTS", "backups", "boolean", "true", "Include local object storage data in scheduled backups.", "both", "supported"),

  entry("MINDORY_POSTGRES_WAL_ARCHIVE_ENABLED", "backups", "boolean", "true", "Enable local PostgreSQL WAL archiving for PITR-capable Compose deployments.", "both", "supported"),
  entry("MINDORY_POSTGRES_WAL_ARCHIVE_TIMEOUT_SECONDS", "backups", "number", "60", "Maximum seconds before PostgreSQL rotates WAL for archiving.", "both", "supported"),
  entry("MINDORY_REMOTE_BACKUP_ENABLED", "backups", "boolean", "false", "Enable encrypted remote backup upload/download settings.", "both", "supported"),
  entry("MINDORY_BACKUP_ENCRYPTION_KEY_ID", "backups", "string", "local", "Non-secret identifier for the backup encryption key.", "both", "supported"),
  entry("MINDORY_BACKUP_ENCRYPTION_KEY", "backups", "string", "", "Secret passphrase or base64 32-byte key for encrypted backup archives.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_REMOTE_BACKUP_S3_ENDPOINT", "backups", "string", "http://librefs:9000", "S3-compatible endpoint for encrypted remote backup archives.", "both", "supported"),
  entry("MINDORY_REMOTE_BACKUP_S3_REGION", "backups", "string", "us-east-1", "S3-compatible region for encrypted remote backup archives.", "both", "supported"),
  entry("MINDORY_REMOTE_BACKUP_S3_BUCKET", "backups", "string", "mindory-backups", "S3-compatible bucket for encrypted remote backup archives.", "both", "supported"),
  entry("MINDORY_REMOTE_BACKUP_S3_ACCESS_KEY_ID", "backups", "string", "", "S3-compatible access key id for encrypted remote backups.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_REMOTE_BACKUP_S3_SECRET_ACCESS_KEY", "backups", "string", "", "S3-compatible secret access key for encrypted remote backups.", "both", "supported", {
    secret: true
  }),
  entry("MINDORY_REMOTE_BACKUP_S3_FORCE_PATH_STYLE", "backups", "boolean", "true", "Use path-style S3 requests for encrypted remote backup archives.", "both", "supported"),
  entry("MINDORY_REMOTE_BACKUP_S3_PREFIX", "backups", "string", "mindory", "Object key prefix for encrypted remote backup archives.", "both", "supported"),

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
  entry("MINDORY_CLAMAV_HEALTH_RETRIES", "antivirus", "number", "12", "Installer ClamAV health retry attempts.", "installer", "supported"),
  entry("MINDORY_CLAMAV_HEALTH_TIMEOUT_MS", "antivirus", "number", "120000", "Installer ClamAV health timeout.", "installer", "supported"),

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
    allowedValues: ["manifest", "local-command", "ffmpeg"]
  }),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND", "document-processing", "string", "", "Executable for local-command video keyframe extraction.", "runtime", "experimental"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_ARGS", "document-processing", "string", "", "JSON string array of local-command keyframe extraction arguments.", "runtime", "experimental"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS", "document-processing", "number", "120000", "Timeout for local-command video keyframe extraction.", "runtime", "experimental"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_FFMPEG_COMMAND", "document-processing", "string", "ffmpeg", "Executable for bundled ffmpeg video keyframe extraction.", "runtime", "supported"),
  entry("MINDORY_DOCUMENT_PROCESSING_VIDEO_FFPROBE_COMMAND", "document-processing", "string", "ffprobe", "Executable for optional ffprobe video metadata probing.", "runtime", "supported"),

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
  entry("MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS", "llm", "number", "120000", "Default timeout for local-command provider healthchecks and operations.", "both", "experimental"),
  entry("MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND", "llm", "string", "", "Executable used for local-command provider healthchecks.", "both", "experimental", {
    prompt: {
      label: "Local-command healthcheck executable",
      help: "Absolute path or PATH-resolved executable that prints the healthcheck JSON contract to stdout."
    }
  }),
  entry("MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS", "llm", "string", "[\"healthcheck\",\"--role\",\"{role}\",\"--model\",\"{model}\"]", "JSON array of arguments for local-command provider healthchecks. {role} and {model} are replaced per configured role.", "both", "experimental", {
    prompt: {
      label: "Local-command healthcheck args",
      help: "JSON string array passed to the executable. Use {role} and {model} tokens for per-role validation."
    }
  }),
  entry("MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND", "llm", "string", "", "Executable used for local-command model operations.", "both", "experimental", {
    prompt: {
      label: "Local-command operation executable",
      help: "Absolute path or PATH-resolved executable that reads operation JSON from stdin and prints operation JSON to stdout."
    }
  }),
  entry("MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS", "llm", "string", "[\"operate\",\"--role\",\"{role}\",\"--model\",\"{model}\",\"--operation\",\"{operation}\"]", "JSON array of arguments for local-command model operations. {role}, {model} and {operation} are replaced per call.", "both", "experimental", {
    prompt: {
      label: "Local-command operation args",
      help: "JSON string array passed to the executable. Use {role}, {model} and {operation} tokens for per-call validation."
    }
  }),
  entry("MINDORY_LLM_LOCAL_COMMAND_MAX_INPUT_BYTES", "llm", "number", "16777216", "Maximum JSON stdin size for local-command model operations.", "both", "experimental"),
  entry("MINDORY_LLM_LOCAL_COMMAND_MAX_OUTPUT_BYTES", "llm", "number", "67108864", "Maximum combined stdout/stderr size for local-command healthchecks and operations.", "both", "experimental"),

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
  entry("MINDORY_TEST_FFMPEG_BIN", "integration-tests", "string", "ffmpeg", "ffmpeg binary path for integration video fixture tests.", "test", "supported"),
  entry("MINDORY_TEST_FFPROBE_BIN", "integration-tests", "string", "ffprobe", "ffprobe binary path for integration video extraction tests.", "test", "supported"),

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
