import {
  configAllowedValues,
  configDefaultBoolean,
  configDefaultNumber,
  configDefaultValue,
  llmRoleProviderSupportStatus,
  llmRoleSupportStatus
} from "./catalog.js";

export * from "./catalog.js";

export type StorageProvider = "local-fs" | "s3";
export type VectorProvider = "pgvector" | "qdrant";
export type AntivirusMode = "disabled" | "async_quarantine" | "sync_scan";
export type LlmProvider = "disabled" | "openai-compatible" | "ollama" | "local-http" | "local-command";
export type LlmOpenAiAuthMode = "none" | "api-key" | "oauth-bearer";
export type McpTransport = "stdio";
export type InstallProfile = "local-quickstart" | "persistent-local" | "server-domain" | "dev-test";
export type InstallDependencyPolicy = "ask" | "manual" | "auto";
export type VideoKeyframeProvider = "manifest" | "local-command";

export const PGVECTOR_EMBEDDING_DIMENSIONS = 1536;

export interface LlmCapabilityConfig {
  enabled: boolean;
  provider: LlmProvider;
  model: string;
  required: boolean;
  timeoutMs: number;
  concurrency: number;
}

export interface LlmEmbeddingCapabilityConfig extends LlmCapabilityConfig {
  dimensions: number | null;
}

export interface DocumentProcessingModalityConfig {
  enabled: boolean;
  required: boolean;
}

export interface DocumentProcessingVideoConfig extends DocumentProcessingModalityConfig {
  maxKeyframes: number;
  keyframeProvider: VideoKeyframeProvider;
  keyframeCommand: string;
  keyframeCommandArgs: string[];
  keyframeTimeoutMs: number;
}

export interface DoclingServiceConfig {
  enabled: boolean;
  url: string;
  timeoutMs: number;
  port: number;
}

export interface MindoryConfig {
  install: {
    home: string;
    profile: InstallProfile;
    releaseChannel: string;
    allowExperimental: boolean;
    dependencyPolicy: InstallDependencyPolicy;
    rollbackOnFailure: boolean;
    devMode: boolean;
  };
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
  docling: DoclingServiceConfig;
  llm: {
    chat: LlmCapabilityConfig;
    textEmbedding: LlmEmbeddingCapabilityConfig;
    imageEmbedding: LlmEmbeddingCapabilityConfig;
    visionCaptioning: LlmCapabilityConfig;
    ocr: LlmCapabilityConfig;
    asr: LlmCapabilityConfig;
    faceDetection: LlmCapabilityConfig;
    faceRecognition: LlmCapabilityConfig;
    imageGeneration: LlmCapabilityConfig;
    audioGeneration: LlmCapabilityConfig;
    openaiCompatible: {
      baseUrl: string;
      authMode: LlmOpenAiAuthMode;
      apiKey: string;
      oauthAccessToken: string;
    };
    ollama: {
      baseUrl: string;
    };
    localHttp: {
      baseUrl: string;
    };
    localCommand: {
      timeoutMs: number;
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

function readStringArray(env: EnvSource, name: string, defaultValue: string): string[] {
  const value = readString(env, name, defaultValue);
  if (value.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      throw new Error("expected a JSON array of strings");
    }
    return parsed;
  } catch (error) {
    throw new Error(`${name} must be a JSON array of strings: ${error instanceof Error ? error.message : "invalid JSON"}.`);
  }
}

function readNullableNumber(env: EnvSource, name: string, defaultValue: string): number | null {
  const value = readString(env, name, defaultValue);
  if (value === "") {
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

function catalogString(name: string): string {
  return configDefaultValue(name);
}

function catalogNumber(name: string): number {
  return configDefaultNumber(name);
}

function catalogBoolean(name: string): boolean {
  return configDefaultBoolean(name);
}

function catalogEnum<T extends string>(name: string): T {
  return configDefaultValue(name) as T;
}

function catalogEnumValues<T extends string>(name: string): readonly T[] {
  return configAllowedValues(name) as readonly T[];
}

function readLlmCapabilityConfig(
  env: EnvSource,
  key: string
): LlmCapabilityConfig {
  const prefix = `MINDORY_LLM_${key}`;
  return {
    enabled: readBoolean(env, `${prefix}_ENABLED`, catalogBoolean(`${prefix}_ENABLED`)),
    provider: readEnum(env, `${prefix}_PROVIDER`, catalogEnum<LlmProvider>(`${prefix}_PROVIDER`), catalogEnumValues<LlmProvider>(`${prefix}_PROVIDER`)),
    model: readString(env, `${prefix}_MODEL`, catalogString(`${prefix}_MODEL`)),
    required: readBoolean(env, `${prefix}_REQUIRED`, catalogBoolean(`${prefix}_REQUIRED`)),
    timeoutMs: readNumber(env, `${prefix}_TIMEOUT_MS`, catalogNumber(`${prefix}_TIMEOUT_MS`)),
    concurrency: readNumber(env, `${prefix}_CONCURRENCY`, catalogNumber(`${prefix}_CONCURRENCY`))
  };
}

function readLlmEmbeddingCapabilityConfig(
  env: EnvSource,
  key: string
): LlmEmbeddingCapabilityConfig {
  const capability = readLlmCapabilityConfig(env, key);
  return {
    ...capability,
    dimensions: readNullableNumber(env, `MINDORY_LLM_${key}_DIMENSIONS`, catalogString(`MINDORY_LLM_${key}_DIMENSIONS`))
  };
}

function readDocumentProcessingModalityConfig(
  env: EnvSource,
  key: string
): DocumentProcessingModalityConfig {
  const prefix = `MINDORY_DOCUMENT_PROCESSING_${key}`;
  return {
    enabled: readBoolean(env, `${prefix}_ENABLED`, catalogBoolean(`${prefix}_ENABLED`)),
    required: readBoolean(env, `${prefix}_REQUIRED`, catalogBoolean(`${prefix}_REQUIRED`))
  };
}

export function loadMindoryConfig(env: EnvSource = process.env): MindoryConfig {
  const config: MindoryConfig = {
    install: {
      home: readString(env, "MINDORY_HOME", catalogString("MINDORY_HOME")),
      profile: readEnum(env, "MINDORY_INSTALL_PROFILE", catalogEnum<InstallProfile>("MINDORY_INSTALL_PROFILE"), catalogEnumValues<InstallProfile>("MINDORY_INSTALL_PROFILE")),
      releaseChannel: readString(env, "MINDORY_INSTALL_RELEASE_CHANNEL", catalogString("MINDORY_INSTALL_RELEASE_CHANNEL")),
      allowExperimental: readBoolean(env, "MINDORY_INSTALL_ALLOW_EXPERIMENTAL", catalogBoolean("MINDORY_INSTALL_ALLOW_EXPERIMENTAL")),
      dependencyPolicy: readEnum(env, "MINDORY_INSTALL_DEPENDENCY_POLICY", catalogEnum<InstallDependencyPolicy>("MINDORY_INSTALL_DEPENDENCY_POLICY"), catalogEnumValues<InstallDependencyPolicy>("MINDORY_INSTALL_DEPENDENCY_POLICY")),
      rollbackOnFailure: readBoolean(env, "MINDORY_INSTALL_ROLLBACK_ON_FAILURE", catalogBoolean("MINDORY_INSTALL_ROLLBACK_ON_FAILURE")),
      devMode: readBoolean(env, "MINDORY_INSTALL_DEV_MODE", catalogBoolean("MINDORY_INSTALL_DEV_MODE"))
    },
    log: {
      level: readString(env, "MINDORY_LOG_LEVEL", catalogString("MINDORY_LOG_LEVEL"))
    },
    api: {
      host: readString(env, "MINDORY_API_HOST", catalogString("MINDORY_API_HOST")),
      port: readNumber(env, "MINDORY_API_PORT", catalogNumber("MINDORY_API_PORT")),
      publicUrl: readString(env, "MINDORY_PUBLIC_URL", catalogString("MINDORY_PUBLIC_URL")),
      rateLimit: {
        enabled: readBoolean(env, "MINDORY_API_RATE_LIMIT_ENABLED", catalogBoolean("MINDORY_API_RATE_LIMIT_ENABLED")),
        windowMs: readNumber(env, "MINDORY_API_RATE_LIMIT_WINDOW_MS", catalogNumber("MINDORY_API_RATE_LIMIT_WINDOW_MS")),
        maxRequests: readNumber(env, "MINDORY_API_RATE_LIMIT_MAX", catalogNumber("MINDORY_API_RATE_LIMIT_MAX"))
      }
    },
    database: {
      url: readString(env, "MINDORY_DATABASE_URL", catalogString("MINDORY_DATABASE_URL"))
    },
    redis: {
      url: readString(env, "MINDORY_REDIS_URL", catalogString("MINDORY_REDIS_URL")),
      queuePrefix: readString(env, "MINDORY_QUEUE_PREFIX", catalogString("MINDORY_QUEUE_PREFIX")),
      cachePrefix: readString(env, "MINDORY_CACHE_PREFIX", catalogString("MINDORY_CACHE_PREFIX"))
    },
    storage: {
      provider: readEnum(env, "MINDORY_STORAGE_PROVIDER", catalogEnum<StorageProvider>("MINDORY_STORAGE_PROVIDER"), catalogEnumValues<StorageProvider>("MINDORY_STORAGE_PROVIDER")),
      localPath: readString(env, "MINDORY_STORAGE_LOCAL_PATH", catalogString("MINDORY_STORAGE_LOCAL_PATH")),
      s3: {
        endpoint: readString(env, "MINDORY_S3_ENDPOINT", catalogString("MINDORY_S3_ENDPOINT")),
        region: readString(env, "MINDORY_S3_REGION", catalogString("MINDORY_S3_REGION")),
        bucket: readString(env, "MINDORY_S3_BUCKET", catalogString("MINDORY_S3_BUCKET")),
        accessKeyId: readString(env, "MINDORY_S3_ACCESS_KEY_ID", catalogString("MINDORY_S3_ACCESS_KEY_ID")),
        secretAccessKey: readString(env, "MINDORY_S3_SECRET_ACCESS_KEY", catalogString("MINDORY_S3_SECRET_ACCESS_KEY")),
        forcePathStyle: readBoolean(env, "MINDORY_S3_FORCE_PATH_STYLE", catalogBoolean("MINDORY_S3_FORCE_PATH_STYLE"))
      }
    },
    vector: {
      provider: readEnum(env, "MINDORY_VECTOR_PROVIDER", catalogEnum<VectorProvider>("MINDORY_VECTOR_PROVIDER"), catalogEnumValues<VectorProvider>("MINDORY_VECTOR_PROVIDER")),
      qdrantUrl: readString(env, "MINDORY_QDRANT_URL", catalogString("MINDORY_QDRANT_URL")),
      qdrantCollectionPrefix: readString(env, "MINDORY_QDRANT_COLLECTION_PREFIX", catalogString("MINDORY_QDRANT_COLLECTION_PREFIX"))
    },
    antivirus: {
      enabled: readBoolean(env, "MINDORY_AV_ENABLED", catalogBoolean("MINDORY_AV_ENABLED")),
      provider: readString(env, "MINDORY_AV_PROVIDER", catalogString("MINDORY_AV_PROVIDER")),
      mode: readEnum(env, "MINDORY_AV_MODE", catalogEnum<AntivirusMode>("MINDORY_AV_MODE"), catalogEnumValues<AntivirusMode>("MINDORY_AV_MODE")),
      requiredBeforeRead: readBoolean(env, "MINDORY_AV_REQUIRED_BEFORE_READ", catalogBoolean("MINDORY_AV_REQUIRED_BEFORE_READ")),
      requiredBeforeExtraction: readBoolean(env, "MINDORY_AV_REQUIRED_BEFORE_EXTRACTION", catalogBoolean("MINDORY_AV_REQUIRED_BEFORE_EXTRACTION")),
      requiredBeforeIndexing: readBoolean(env, "MINDORY_AV_REQUIRED_BEFORE_INDEXING", catalogBoolean("MINDORY_AV_REQUIRED_BEFORE_INDEXING")),
      onScanFailure: readEnum(env, "MINDORY_AV_ON_SCAN_FAILURE", catalogEnum<"block" | "allow_with_warning">("MINDORY_AV_ON_SCAN_FAILURE"), catalogEnumValues<"block" | "allow_with_warning">("MINDORY_AV_ON_SCAN_FAILURE")),
      onInfected: readEnum(env, "MINDORY_AV_ON_INFECTED", catalogEnum<"quarantine" | "delete">("MINDORY_AV_ON_INFECTED"), catalogEnumValues<"quarantine" | "delete">("MINDORY_AV_ON_INFECTED")),
      clamavHost: readString(env, "MINDORY_CLAMAV_HOST", catalogString("MINDORY_CLAMAV_HOST")),
      clamavPort: readNumber(env, "MINDORY_CLAMAV_PORT", catalogNumber("MINDORY_CLAMAV_PORT"))
    },
    workers: {
      type: readString(env, "MINDORY_WORKER_TYPE", catalogString("MINDORY_WORKER_TYPE")),
      concurrency: readNumber(env, "MINDORY_WORKER_CONCURRENCY", catalogNumber("MINDORY_WORKER_CONCURRENCY"))
    },
    documentProcessing: {
      routingEnabled: readBoolean(env, "MINDORY_DOCUMENT_PROCESSING_ROUTING_ENABLED", catalogBoolean("MINDORY_DOCUMENT_PROCESSING_ROUTING_ENABLED")),
      text: readDocumentProcessingModalityConfig(env, "TEXT"),
      pdf: readDocumentProcessingModalityConfig(env, "PDF"),
      image: readDocumentProcessingModalityConfig(env, "IMAGE"),
      audio: readDocumentProcessingModalityConfig(env, "AUDIO"),
      video: {
        ...readDocumentProcessingModalityConfig(env, "VIDEO"),
        maxKeyframes: readNumber(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES", catalogNumber("MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES")),
        keyframeProvider: readEnum(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER", catalogEnum<VideoKeyframeProvider>("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER"), catalogEnumValues<VideoKeyframeProvider>("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_PROVIDER")),
        keyframeCommand: readString(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND", catalogString("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND")),
        keyframeCommandArgs: readStringArray(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_ARGS", catalogString("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_ARGS")),
        keyframeTimeoutMs: readNumber(env, "MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS", catalogNumber("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS"))
      }
    },
    docling: {
      enabled: readBoolean(env, "MINDORY_DOCLING_ENABLED", catalogBoolean("MINDORY_DOCLING_ENABLED")),
      url: readString(env, "MINDORY_DOCLING_URL", catalogString("MINDORY_DOCLING_URL")),
      timeoutMs: readNumber(env, "MINDORY_DOCLING_TIMEOUT_MS", catalogNumber("MINDORY_DOCLING_TIMEOUT_MS")),
      port: readNumber(env, "MINDORY_DOCLING_PORT", catalogNumber("MINDORY_DOCLING_PORT"))
    },
    llm: {
      chat: readLlmCapabilityConfig(env, "CHAT"),
      textEmbedding: readLlmEmbeddingCapabilityConfig(env, "TEXT_EMBEDDING"),
      imageEmbedding: readLlmEmbeddingCapabilityConfig(env, "IMAGE_EMBEDDING"),
      visionCaptioning: readLlmCapabilityConfig(env, "VISION_CAPTIONING"),
      ocr: readLlmCapabilityConfig(env, "OCR"),
      asr: readLlmCapabilityConfig(env, "ASR"),
      faceDetection: readLlmCapabilityConfig(env, "FACE_DETECTION"),
      faceRecognition: readLlmCapabilityConfig(env, "FACE_RECOGNITION"),
      imageGeneration: readLlmCapabilityConfig(env, "IMAGE_GENERATION"),
      audioGeneration: readLlmCapabilityConfig(env, "AUDIO_GENERATION"),
      openaiCompatible: {
        baseUrl: readString(env, "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL", catalogString("MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL")),
        authMode: readEnum(env, "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE", catalogEnum<LlmOpenAiAuthMode>("MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE"), catalogEnumValues<LlmOpenAiAuthMode>("MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE")),
        apiKey: readString(env, "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY", catalogString("MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY")),
        oauthAccessToken: readString(env, "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN", catalogString("MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN"))
      },
      ollama: {
        baseUrl: readString(env, "MINDORY_LLM_OLLAMA_BASE_URL", catalogString("MINDORY_LLM_OLLAMA_BASE_URL"))
      },
      localHttp: {
        baseUrl: readString(env, "MINDORY_LLM_LOCAL_HTTP_BASE_URL", catalogString("MINDORY_LLM_LOCAL_HTTP_BASE_URL"))
      },
      localCommand: {
        timeoutMs: readNumber(env, "MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS", catalogNumber("MINDORY_LLM_LOCAL_COMMAND_TIMEOUT_MS"))
      }
    },
    mcp: {
      enabled: readBoolean(env, "MINDORY_MCP_ENABLED", catalogBoolean("MINDORY_MCP_ENABLED")),
      transport: readEnum(env, "MINDORY_MCP_TRANSPORT", catalogEnum<McpTransport>("MINDORY_MCP_TRANSPORT"), catalogEnumValues<McpTransport>("MINDORY_MCP_TRANSPORT")),
      apiUrl: readString(env, "MINDORY_MCP_API_URL", catalogString("MINDORY_MCP_API_URL")),
      apiToken: readString(env, "MINDORY_MCP_API_TOKEN", catalogString("MINDORY_MCP_API_TOKEN"))
    },
    cli: {
      apiUrl: readString(env, "MINDORY_CLI_API_URL", catalogString("MINDORY_CLI_API_URL")),
      apiToken: readString(env, "MINDORY_CLI_API_TOKEN", catalogString("MINDORY_CLI_API_TOKEN"))
    },
    hermes: {
      adapterEnabled: readBoolean(env, "MINDORY_HERMES_ADAPTER_ENABLED", catalogBoolean("MINDORY_HERMES_ADAPTER_ENABLED")),
      apiUrl: readString(env, "MINDORY_HERMES_API_URL", catalogString("MINDORY_HERMES_API_URL")),
      apiToken: readString(env, "MINDORY_HERMES_API_TOKEN", catalogString("MINDORY_HERMES_API_TOKEN")),
      defaultProject: readString(env, "MINDORY_HERMES_DEFAULT_PROJECT", catalogString("MINDORY_HERMES_DEFAULT_PROJECT")),
      defaultUserPeer: readString(env, "MINDORY_HERMES_DEFAULT_USER_PEER", catalogString("MINDORY_HERMES_DEFAULT_USER_PEER")),
      defaultAgentPeer: readString(env, "MINDORY_HERMES_DEFAULT_AGENT_PEER", catalogString("MINDORY_HERMES_DEFAULT_AGENT_PEER")),
      contextTokenBudget: readNumber(env, "MINDORY_HERMES_CONTEXT_TOKEN_BUDGET", catalogNumber("MINDORY_HERMES_CONTEXT_TOKEN_BUDGET"))
    }
  };

  validateMindoryConfig(config);
  return config;
}

export function validateMindoryConfig(config: MindoryConfig): void {
  validateApiConfig(config);
  validateDocumentProcessingConfig(config);
  validateDoclingConfig(config);
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

function validateDocumentProcessingConfig(config: MindoryConfig): void {
  if (config.documentProcessing.video.maxKeyframes <= 0) {
    throw new Error("MINDORY_DOCUMENT_PROCESSING_VIDEO_MAX_KEYFRAMES must be greater than zero.");
  }
  if (config.documentProcessing.video.keyframeTimeoutMs <= 0) {
    throw new Error("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_TIMEOUT_MS must be greater than zero.");
  }
  if (config.documentProcessing.video.keyframeProvider === "local-command" && config.documentProcessing.video.keyframeCommand.trim() === "") {
    throw new Error("MINDORY_DOCUMENT_PROCESSING_VIDEO_KEYFRAME_COMMAND is required when local-command video keyframe extraction is enabled.");
  }
}

function validateDoclingConfig(config: MindoryConfig): void {
  if (config.docling.timeoutMs <= 0) {
    throw new Error("MINDORY_DOCLING_TIMEOUT_MS must be greater than zero.");
  }
  if (config.docling.port <= 0 || config.docling.port > 65535) {
    throw new Error("MINDORY_DOCLING_PORT must be a valid TCP port.");
  }
  if (!config.docling.enabled) {
    return;
  }
  try {
    const parsed = new URL(config.docling.url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("protocol");
    }
  } catch {
    throw new Error("MINDORY_DOCLING_URL must be a valid http or https URL when Docling is enabled.");
  }
}

function validateLlmConfig(config: MindoryConfig): void {
  const capabilities = [
    ["CHAT", config.llm.chat],
    ["TEXT_EMBEDDING", config.llm.textEmbedding],
    ["IMAGE_EMBEDDING", config.llm.imageEmbedding],
    ["VISION_CAPTIONING", config.llm.visionCaptioning],
    ["OCR", config.llm.ocr],
    ["ASR", config.llm.asr],
    ["FACE_DETECTION", config.llm.faceDetection],
    ["FACE_RECOGNITION", config.llm.faceRecognition],
    ["IMAGE_GENERATION", config.llm.imageGeneration],
    ["AUDIO_GENERATION", config.llm.audioGeneration]
  ] as const;

  for (const [envKey, capability] of capabilities) {
    if (!capability.enabled) {
      continue;
    }
    if (llmRoleSupportStatus(envKey) !== "supported" && !config.install.allowExperimental) {
      throw new Error(`MINDORY_LLM_${envKey}_ENABLED requires MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true because the role is ${llmRoleSupportStatus(envKey)}.`);
    }
    if (capability.provider === "disabled") {
      throw new Error(`MINDORY_LLM_${envKey}_PROVIDER cannot be disabled when the capability is enabled.`);
    }
    if (llmRoleProviderSupportStatus(envKey, capability.provider) !== "supported" && !config.install.allowExperimental) {
      throw new Error(`MINDORY_LLM_${envKey}_PROVIDER=${capability.provider} requires MINDORY_INSTALL_ALLOW_EXPERIMENTAL=true because it is ${llmRoleProviderSupportStatus(envKey, capability.provider)} for this role.`);
    }
    if (capability.model.trim() === "") {
      throw new Error(`MINDORY_LLM_${envKey}_MODEL is required when the capability is enabled.`);
    }
    if (capability.timeoutMs <= 0) {
      throw new Error(`MINDORY_LLM_${envKey}_TIMEOUT_MS must be greater than zero.`);
    }
    if (capability.concurrency <= 0) {
      throw new Error(`MINDORY_LLM_${envKey}_CONCURRENCY must be greater than zero.`);
    }
  }

  if (config.llm.textEmbedding.enabled && config.vector.provider === "pgvector") {
    const dimensions = config.llm.textEmbedding.dimensions ?? PGVECTOR_EMBEDDING_DIMENSIONS;
    if (dimensions !== PGVECTOR_EMBEDDING_DIMENSIONS) {
      throw new Error(`MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS must be ${PGVECTOR_EMBEDDING_DIMENSIONS} for the current pgvector MVP schema.`);
    }
  }

  if (usesLlmProvider(config, "openai-compatible")) {
    if (config.llm.openaiCompatible.baseUrl.trim() === "") {
      throw new Error("MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL is required when an OpenAI-compatible capability is enabled.");
    }
    if (config.llm.openaiCompatible.authMode === "api-key" && config.llm.openaiCompatible.apiKey.trim() === "") {
      throw new Error("MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY is required when MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=api-key.");
    }
    if (config.llm.openaiCompatible.authMode === "oauth-bearer" && config.llm.openaiCompatible.oauthAccessToken.trim() === "") {
      throw new Error("MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN is required when MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=oauth-bearer.");
    }
  }

  if (usesLlmProvider(config, "ollama") && config.llm.ollama.baseUrl.trim() === "") {
    throw new Error("MINDORY_LLM_OLLAMA_BASE_URL is required when an Ollama capability is enabled.");
  }

  if (usesLlmProvider(config, "local-http") && config.llm.localHttp.baseUrl.trim() === "") {
    throw new Error("MINDORY_LLM_LOCAL_HTTP_BASE_URL is required when a local HTTP capability is enabled.");
  }
}

function usesLlmProvider(config: MindoryConfig, provider: LlmProvider): boolean {
  return [
    config.llm.chat,
    config.llm.textEmbedding,
    config.llm.imageEmbedding,
    config.llm.visionCaptioning,
    config.llm.ocr,
    config.llm.asr,
    config.llm.faceDetection,
    config.llm.faceRecognition,
    config.llm.imageGeneration,
    config.llm.audioGeneration
  ].some((capability) => capability.enabled && capability.provider === provider);
}
