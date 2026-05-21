export type StorageProvider = "local-fs" | "s3";
export type VectorProvider = "pgvector" | "qdrant";
export type AntivirusMode = "disabled" | "async_quarantine" | "sync_scan";
export type LlmProvider = "openai-compatible" | "ollama" | "disabled";
export type LlmOpenAiAuthMode = "none" | "api-key" | "oauth-bearer";
export type McpTransport = "stdio";

export const PGVECTOR_EMBEDDING_DIMENSIONS = 1536;

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
  llm: {
    provider: LlmProvider;
    embeddingModel: string;
    chatModel: string;
    embeddingDimensions: number | null;
    openaiCompatible: {
      baseUrl: string;
      authMode: LlmOpenAiAuthMode;
      apiKey: string;
      oauthAccessToken: string;
    };
    ollama: {
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
    llm: {
      provider: readEnum(env, "MINDORY_LLM_PROVIDER", "disabled", ["openai-compatible", "ollama", "disabled"]),
      embeddingModel: readString(env, "MINDORY_LLM_EMBEDDING_MODEL", ""),
      chatModel: readString(env, "MINDORY_LLM_CHAT_MODEL", ""),
      embeddingDimensions: readNullableNumber(env, "MINDORY_LLM_EMBEDDING_DIMENSIONS"),
      openaiCompatible: {
        baseUrl: readString(env, "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL", ""),
        authMode: readEnum(env, "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE", "none", ["none", "api-key", "oauth-bearer"]),
        apiKey: readString(env, "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY", ""),
        oauthAccessToken: readString(env, "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN", "")
      },
      ollama: {
        baseUrl: readString(env, "MINDORY_LLM_OLLAMA_BASE_URL", "http://ollama:11434")
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
  validateLlmConfig(config);
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

function validateLlmConfig(config: MindoryConfig): void {
  if (config.llm.provider === "disabled") {
    return;
  }

  if (config.llm.embeddingModel.trim() === "") {
    throw new Error("MINDORY_LLM_EMBEDDING_MODEL is required when LLM embeddings are enabled.");
  }

  if (config.vector.provider === "pgvector") {
    const dimensions = config.llm.embeddingDimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS;
    if (dimensions !== PGVECTOR_EMBEDDING_DIMENSIONS) {
      throw new Error(`MINDORY_LLM_EMBEDDING_DIMENSIONS must be ${PGVECTOR_EMBEDDING_DIMENSIONS} for the current pgvector MVP schema.`);
    }
  }

  if (config.llm.provider === "openai-compatible") {
    if (config.llm.openaiCompatible.baseUrl.trim() === "") {
      throw new Error("MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL is required when MINDORY_LLM_PROVIDER=openai-compatible.");
    }
    if (config.llm.openaiCompatible.authMode === "api-key" && config.llm.openaiCompatible.apiKey.trim() === "") {
      throw new Error("MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY is required when MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=api-key.");
    }
    if (config.llm.openaiCompatible.authMode === "oauth-bearer" && config.llm.openaiCompatible.oauthAccessToken.trim() === "") {
      throw new Error("MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN is required when MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=oauth-bearer.");
    }
  }

  if (config.llm.provider === "ollama" && config.llm.ollama.baseUrl.trim() === "") {
    throw new Error("MINDORY_LLM_OLLAMA_BASE_URL is required when MINDORY_LLM_PROVIDER=ollama.");
  }
}
