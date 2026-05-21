export type StorageProvider = "local-fs" | "s3";
export type VectorProvider = "pgvector" | "qdrant";
export type AntivirusMode = "disabled" | "async_quarantine" | "sync_scan";
export type ModelRuntimeProvider = "disabled" | "openai-compatible" | "ollama" | "local";
export type ModelRuntimeOpenAiAuthMode = "none" | "api-key" | "oauth-bearer";
export type McpTransport = "stdio";

export const PGVECTOR_EMBEDDING_DIMENSIONS = 1536;

export interface ModelRuntimeCapabilityConfig {
  enabled: boolean;
  provider: ModelRuntimeProvider;
  model: string;
  required: boolean;
}

export interface ModelRuntimeEmbeddingCapabilityConfig extends ModelRuntimeCapabilityConfig {
  dimensions: number | null;
}

export interface DocumentProcessingModalityConfig {
  enabled: boolean;
  required: boolean;
}

export interface DocumentProcessingVideoConfig extends DocumentProcessingModalityConfig {
  maxKeyframes: number;
}

export interface MindoryConfig {
  log: {
    level: string;
  };
  api: {
    host: string;
    port: number;
    publicUrl: string;
    rateLimit: {
      enabled: boolean;
      windowMs: number;
      maxRequests: number;
    };
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
    queuePrefix: string;
    cachePrefix: string;
  };
  storage: {
    provider: StorageProvider;
    localPath: string;
    s3: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    };
  };
  vector: {
    provider: VectorProvider;
    qdrantUrl: string;
    qdrantCollectionPrefix: string;
  };
  antivirus: {
    enabled: boolean;
    provider: string;
    mode: AntivirusMode;
    requiredBeforeRead: boolean;
    requiredBeforeExtraction: boolean;
    requiredBeforeIndexing: boolean;
    onScanFailure: "block" | "allow_with_warning";
    onInfected: "quarantine" | "delete";
    clamavHost: string;
    clamavPort: number;
  };
  workers: {
    type: string;
    concurrency: number;
  };
  documentProcessing: {
    routingEnabled: boolean;
    text: DocumentProcessingModalityConfig;
    pdf: DocumentProcessingModalityConfig;
    image: DocumentProcessingModalityConfig;
    audio: DocumentProcessingModalityConfig;
    video: DocumentProcessingVideoConfig;
  };
  modelRuntime: {
    textEmbedding: ModelRuntimeEmbeddingCapabilityConfig;
    imageEmbedding: ModelRuntimeEmbeddingCapabilityConfig;
    imageCaptioning: ModelRuntimeCapabilityConfig;
    ocr: ModelRuntimeCapabilityConfig;
    asr: ModelRuntimeCapabilityConfig;
    faceDetection: ModelRuntimeCapabilityConfig;
    faceRecognition: ModelRuntimeCapabilityConfig;
    openaiCompatible: {
      baseUrl: string;
      authMode: ModelRuntimeOpenAiAuthMode;
      apiKey: string;
      oauthAccessToken: string;
    };
    ollama: {
      baseUrl: string;
    };
    local: {
      baseUrl: string;
    };
  };
  mcp: {
    enabled: boolean;
    transport: McpTransport;
    apiUrl: string;
    apiToken: string;
  };
  cli: {
    apiUrl: string;
    apiToken: string;
  };
  hermes: {
    adapterEnabled: boolean;
    apiUrl: string;
    apiToken: string;
    defaultProject: string;
    defaultUserPeer: string;
    defaultAgentPeer: string;
    contextTokenBudget: number;
  };
}

export type EnvSource = Record<string, string | undefined>;

function readString(env: EnvSource, name: string, defaultValue: string): string {
  const value = env[name];
  return value === undefined || value === "" ? defaultValue : value;
}

function readNumber(env: EnvSource, name: string, defaultValue: number): number {
  const rawValue = readString(env, name, String(defaultValue));
  const value = Number.parseInt(rawValue, 10);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be a number.`);
  }
  return value;
}

function readNullableNumber(env: EnvSource, name: string): number | null {
  const value = env[name];
  if (value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a number when set.`);
  }
  if (parsed <= 0) {
    throw new Error(`${name} must be greater than zero when set.`);
  }
  return parsed;
}

function readBoolean(env: EnvSource, name: string, defaultValue: boolean): boolean {
  const value = readString(env, name, String(defaultValue));
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}

function readEnum<T extends string>(env: EnvSource, name: string, defaultValue: T, values: readonly T[]): T {
  const value = readString(env, name, defaultValue);
  if (values.includes(value as T)) {
    return value as T;
  }
  throw new Error(`${name} must be one of: ${values.join(", ")}.`);
}

function readModelCapabilityConfig(
  env: EnvSource,
  key: string,
  defaults: {
    enabled?: boolean;
    provider?: ModelRuntimeProvider;
    model?: string;
    required?: boolean;
  } = {}
): ModelRuntimeCapabilityConfig {
  const prefix = `MINDORY_MODEL_RUNTIME_${key}`;
  return {
    enabled: readBoolean(env, `${prefix}_ENABLED`, defaults.enabled ?? false),
    provider: readEnum(env, `${prefix}_PROVIDER`, defaults.provider ?? "disabled", ["disabled", "openai-compatible", "ollama", "local"]),
    model: readString(env, `${prefix}_MODEL`, defaults.model ?? ""),
    required: readBoolean(env, `${prefix}_REQUIRED`, defaults.required ?? false)
  };
}

function readModelEmbeddingCapabilityConfig(
  env: EnvSource,
  key: string,
  defaults: {
    enabled?: boolean;
    provider?: ModelRuntimeProvider;
    model?: string;
    dimensions?: number | null;
    required?: boolean;
  } = {}
): ModelRuntimeEmbeddingCapabilityConfig {
  const capability = readModelCapabilityConfig(env, key, defaults);
  return {
    ...capability,
    dimensions: readNullableNumber(env, `MINDORY_MODEL_RUNTIME_${key}_DIMENSIONS`) ?? defaults.dimensions ?? null
  };
}

function readDocumentProcessingModalityConfig(
  env: EnvSource,
  key: string,
  defaults: {
    enabled?: boolean;
    required?: boolean;
  } = {}
): DocumentProcessingModalityConfig {
  const prefix = `MINDORY_DOCUMENT_PROCESSING_${key}`;
  return {
    enabled: readBoolean(env, `${prefix}_ENABLED`, defaults.enabled ?? false),
    required: readBoolean(env, `${prefix}_REQUIRED`, defaults.required ?? false)
  };
}

export function loadMindoryConfig(env: EnvSource = process.env): MindoryConfig {
  const config: MindoryConfig = {
    log: {
      level: readString(env, "MINDORY_LOG_LEVEL", "info")
    },
    api: {
      host: readString(env, "MINDORY_API_HOST", "0.0.0.0"),
      port: readNumber(env, "MINDORY_API_PORT", 3000),
      publicUrl: readString(env, "MINDORY_PUBLIC_URL", "http://localhost:3000"),
      rateLimit: {
        enabled: readBoolean(env, "MINDORY_API_RATE_LIMIT_ENABLED", true),
        windowMs: readNumber(env, "MINDORY_API_RATE_LIMIT_WINDOW_MS", 60000),
        maxRequests: readNumber(env, "MINDORY_API_RATE_LIMIT_MAX", 600)
      }
    },
    database: {
      url: readString(env, "MINDORY_DATABASE_URL", "postgresql://mindory:mindory@postgres:5432/mindory")
    },
    redis: {
      url: readString(env, "MINDORY_REDIS_URL", "redis://redis:6379"),
      queuePrefix: readString(env, "MINDORY_QUEUE_PREFIX", "mindory:queue"),
      cachePrefix: readString(env, "MINDORY_CACHE_PREFIX", "mindory:cache")
    },
    storage: {
      provider: readEnum(env, "MINDORY_STORAGE_PROVIDER", "local-fs", ["local-fs", "s3"]),
      localPath: readString(env, "MINDORY_STORAGE_LOCAL_PATH", "/data/mindory/objects"),
      s3: {
        endpoint: readString(env, "MINDORY_S3_ENDPOINT", "http://minio:9000"),
        region: readString(env, "MINDORY_S3_REGION", "us-east-1"),
        bucket: readString(env, "MINDORY_S3_BUCKET", "mindory"),
        accessKeyId: readString(env, "MINDORY_S3_ACCESS_KEY_ID", "mindory"),
        secretAccessKey: readString(env, "MINDORY_S3_SECRET_ACCESS_KEY", "mindory-secret"),
        forcePathStyle: readBoolean(env, "MINDORY_S3_FORCE_PATH_STYLE", true)
      }
    },
    vector: {
      provider: readEnum(env, "MINDORY_VECTOR_PROVIDER", "pgvector", ["pgvector", "qdrant"]),
      qdrantUrl: readString(env, "MINDORY_QDRANT_URL", "http://qdrant:6333"),
      qdrantCollectionPrefix: readString(env, "MINDORY_QDRANT_COLLECTION_PREFIX", "mindory")
    },
    antivirus: {
      enabled: readBoolean(env, "MINDORY_AV_ENABLED", true),
      provider: readString(env, "MINDORY_AV_PROVIDER", "clamav"),
      mode: readEnum(env, "MINDORY_AV_MODE", "async_quarantine", ["disabled", "async_quarantine", "sync_scan"]),
      requiredBeforeRead: readBoolean(env, "MINDORY_AV_REQUIRED_BEFORE_READ", true),
      requiredBeforeExtraction: readBoolean(env, "MINDORY_AV_REQUIRED_BEFORE_EXTRACTION", true),
      requiredBeforeIndexing: readBoolean(env, "MINDORY_AV_REQUIRED_BEFORE_INDEXING", true),
      onScanFailure: readEnum(env, "MINDORY_AV_ON_SCAN_FAILURE", "block", ["block", "allow_with_warning"]),
      onInfected: readEnum(env, "MINDORY_AV_ON_INFECTED", "quarantine", ["quarantine", "delete"]),
      clamavHost: readString(env, "MINDORY_CLAMAV_HOST", "clamav"),
      clamavPort: readNumber(env, "MINDORY_CLAMAV_PORT", 3310)
    },
    workers: {
      type: readString(env, "MINDORY_WORKER_TYPE", "all"),
      concurrency: readNumber(env, "MINDORY_WORKER_CONCURRENCY", 2)
    },
    documentProcessing: {
      routingEnabled: readBoolean(env, "MINDORY_DOCUMENT_PROCESSING_ROUTING_ENABLED", true),
      text: readDocumentProcessingModalityConfig(env, "TEXT", {
        enabled: true
      }),
      pdf: readDocumentProcessingModalityConfig(env, "PDF"),
      image: readDocumentProcessingModalityConfig(env, "IMAGE"),
      audio: readDocumentProcessingModalityConfig(env, "AUDIO"),
      video: {
        ...readDocumentProcessingModalityConfig(env, "VIDEO"),
        maxKeyframes: readNumber(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", 10)
      }
    },
    modelRuntime: {
      textEmbedding: readModelEmbeddingCapabilityConfig(env, "TEXT_EMBEDDING"),
      imageEmbedding: readModelEmbeddingCapabilityConfig(env, "IMAGE_EMBEDDING", {
        provider: "local",
        model: "CLIP ViT-L-16-SigLIP2-256__webli"
      }),
      imageCaptioning: readModelCapabilityConfig(env, "IMAGE_CAPTIONING"),
      ocr: readModelCapabilityConfig(env, "OCR", {
        provider: "local",
        model: "ESLAV__PP-OCRv5_mobile"
      }),
      asr: readModelCapabilityConfig(env, "ASR"),
      faceDetection: readModelCapabilityConfig(env, "FACE_DETECTION", {
        provider: "local",
        model: "buffalo_l"
      }),
      faceRecognition: readModelCapabilityConfig(env, "FACE_RECOGNITION", {
        provider: "local",
        model: "buffalo_l"
      }),
      openaiCompatible: {
        baseUrl: readString(env, "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL", ""),
        authMode: readEnum(env, "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE", "none", ["none", "api-key", "oauth-bearer"]),
        apiKey: readString(env, "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY", ""),
        oauthAccessToken: readString(env, "MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN", "")
      },
      ollama: {
        baseUrl: readString(env, "MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL", "http://ollama:11434")
      },
      local: {
        baseUrl: readString(env, "MINDORY_MODEL_RUNTIME_LOCAL_BASE_URL", "http://model-runtime:8080")
      }
    },
    mcp: {
      enabled: readBoolean(env, "MINDORY_MCP_ENABLED", true),
      transport: readEnum(env, "MINDORY_MCP_TRANSPORT", "stdio", ["stdio"]),
      apiUrl: readString(env, "MINDORY_MCP_API_URL", "http://localhost:3000"),
      apiToken: readString(env, "MINDORY_MCP_API_TOKEN", "")
    },
    cli: {
      apiUrl: readString(env, "MINDORY_CLI_API_URL", "http://localhost:3000"),
      apiToken: readString(env, "MINDORY_CLI_API_TOKEN", "")
    },
    hermes: {
      adapterEnabled: readBoolean(env, "MINDORY_HERMES_ADAPTER_ENABLED", false),
      apiUrl: readString(env, "MINDORY_HERMES_API_URL", "http://localhost:3000"),
      apiToken: readString(env, "MINDORY_HERMES_API_TOKEN", ""),
      defaultProject: readString(env, "MINDORY_HERMES_DEFAULT_PROJECT", "default"),
      defaultUserPeer: readString(env, "MINDORY_HERMES_DEFAULT_USER_PEER", "default-user"),
      defaultAgentPeer: readString(env, "MINDORY_HERMES_DEFAULT_AGENT_PEER", "hermes"),
      contextTokenBudget: readNumber(env, "MINDORY_HERMES_CONTEXT_TOKEN_BUDGET", 3000)
    }
  };

  validateMindoryConfig(config);
  return config;
}

export function validateMindoryConfig(config: MindoryConfig): void {
  validateApiConfig(config);
  validateDocumentProcessingConfig(config);
  validateModelRuntimeConfig(config);
}

function validateApiConfig(config: MindoryConfig): void {
  if (!config.api.rateLimit.enabled) {
    return;
  }

  if (config.api.rateLimit.windowMs <= 0) {
    throw new Error("MINDORY_API_RATE_LIMIT_WINDOW_MS must be greater than zero when rate limits are enabled.");
  }

  if (config.api.rateLimit.maxRequests <= 0) {
    throw new Error("MINDORY_API_RATE_LIMIT_MAX must be greater than zero when rate limits are enabled.");
  }
}

function validateDocumentProcessingConfig(config: MindoryConfig): void {
  if (config.documentProcessing.video.maxKeyframes <= 0) {
    throw new Error("MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES must be greater than zero.");
  }
}

function validateModelRuntimeConfig(config: MindoryConfig): void {
  const capabilities = [
    ["TEXT_EMBEDDING", config.modelRuntime.textEmbedding],
    ["IMAGE_EMBEDDING", config.modelRuntime.imageEmbedding],
    ["IMAGE_CAPTIONING", config.modelRuntime.imageCaptioning],
    ["OCR", config.modelRuntime.ocr],
    ["ASR", config.modelRuntime.asr],
    ["FACE_DETECTION", config.modelRuntime.faceDetection],
    ["FACE_RECOGNITION", config.modelRuntime.faceRecognition]
  ] as const;

  for (const [envKey, capability] of capabilities) {
    if (!capability.enabled) {
      continue;
    }
    if (capability.provider === "disabled") {
      throw new Error(`MINDORY_MODEL_RUNTIME_${envKey}_PROVIDER cannot be disabled when the capability is enabled.`);
    }
    if (capability.model.trim() === "") {
      throw new Error(`MINDORY_MODEL_RUNTIME_${envKey}_MODEL is required when the capability is enabled.`);
    }
  }

  if (config.modelRuntime.textEmbedding.enabled && config.vector.provider === "pgvector") {
    const dimensions = config.modelRuntime.textEmbedding.dimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS;
    if (dimensions !== PGVECTOR_EMBEDDING_DIMENSIONS) {
      throw new Error(`MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS must be ${PGVECTOR_EMBEDDING_DIMENSIONS} for the current pgvector MVP schema.`);
    }
  }

  if (usesModelRuntimeProvider(config, "openai-compatible")) {
    if (config.modelRuntime.openaiCompatible.baseUrl.trim() === "") {
      throw new Error("MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL is required when an OpenAI-compatible capability is enabled.");
    }
    if (config.modelRuntime.openaiCompatible.authMode === "api-key" && config.modelRuntime.openaiCompatible.apiKey.trim() === "") {
      throw new Error("MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY is required when MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE=api-key.");
    }
    if (config.modelRuntime.openaiCompatible.authMode === "oauth-bearer" && config.modelRuntime.openaiCompatible.oauthAccessToken.trim() === "") {
      throw new Error("MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN is required when MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE=oauth-bearer.");
    }
  }

  if (usesModelRuntimeProvider(config, "ollama") && config.modelRuntime.ollama.baseUrl.trim() === "") {
    throw new Error("MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL is required when an Ollama capability is enabled.");
  }
}

function usesModelRuntimeProvider(config: MindoryConfig, provider: ModelRuntimeProvider): boolean {
  return [
    config.modelRuntime.textEmbedding,
    config.modelRuntime.imageEmbedding,
    config.modelRuntime.imageCaptioning,
    config.modelRuntime.ocr,
    config.modelRuntime.asr,
    config.modelRuntime.faceDetection,
    config.modelRuntime.faceRecognition
  ].some((capability) => capability.enabled && capability.provider === provider);
}
