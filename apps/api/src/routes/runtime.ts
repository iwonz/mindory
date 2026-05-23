import type { FastifyInstance } from "fastify";
import type { MindoryConfig } from "@mindory/config";
import { requireProjectPermission } from "../auth.js";

interface RuntimeDiagnosticsQuery {
  projectId: string;
}

export async function registerRuntimeRoutes(app: FastifyInstance, config: MindoryConfig): Promise<void> {
  app.get<{ Querystring: RuntimeDiagnosticsQuery }>("/v1/runtime/diagnostics", {
    schema: {
      querystring: {
        type: "object",
        required: ["projectId"],
        additionalProperties: false,
        properties: {
          projectId: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request) => {
    requireProjectPermission(request, request.query.projectId, "project:read");

    return {
      request_id: request.id,
      project_id: request.query.projectId,
      config: redactedRuntimeConfig(config),
      provider_health: providerHealth(config),
      metrics_links: metricsLinks(config),
      generated_at: new Date().toISOString()
    };
  });
}

function redactedRuntimeConfig(config: MindoryConfig): Record<string, unknown> {
  return {
    install: {
      home: config.install.home,
      profile: config.install.profile,
      release_channel: config.install.releaseChannel,
      allow_experimental: config.install.allowExperimental,
      dev_mode: config.install.devMode
    },
    api: {
      public_url: config.api.publicUrl,
      host: config.api.host,
      port: config.api.port,
      rate_limit: config.api.rateLimit
    },
    storage: {
      provider: config.storage.provider,
      local_path: config.storage.provider === "local-fs" ? config.storage.localPath : null,
      s3: {
        endpoint: config.storage.s3.endpoint,
        region: config.storage.s3.region,
        bucket: config.storage.s3.bucket,
        access_key_configured: config.storage.s3.accessKeyId.length > 0,
        secret_key_configured: config.storage.s3.secretAccessKey.length > 0,
        force_path_style: config.storage.s3.forcePathStyle
      }
    },
    vector: {
      provider: config.vector.provider,
      qdrant_url: config.vector.qdrantUrl,
      qdrant_collection_prefix: config.vector.qdrantCollectionPrefix
    },
    antivirus: {
      enabled: config.antivirus.enabled,
      provider: config.antivirus.provider,
      mode: config.antivirus.mode,
      required_before_read: config.antivirus.requiredBeforeRead,
      required_before_extraction: config.antivirus.requiredBeforeExtraction,
      required_before_indexing: config.antivirus.requiredBeforeIndexing,
      on_scan_failure: config.antivirus.onScanFailure,
      on_infected: config.antivirus.onInfected,
      clamav_host: config.antivirus.clamavHost,
      clamav_port: config.antivirus.clamavPort
    },
    document_processing: {
      routing_enabled: config.documentProcessing.routingEnabled,
      text: config.documentProcessing.text,
      pdf: config.documentProcessing.pdf,
      image: config.documentProcessing.image,
      audio: config.documentProcessing.audio,
      video: {
        enabled: config.documentProcessing.video.enabled,
        required: config.documentProcessing.video.required,
        max_keyframes: config.documentProcessing.video.maxKeyframes,
        keyframe_provider: config.documentProcessing.video.keyframeProvider,
        ffmpeg_command: config.documentProcessing.video.ffmpegCommand,
        ffprobe_command: config.documentProcessing.video.ffprobeCommand
      },
      docling: {
        enabled: config.docling.enabled,
        url: config.docling.url,
        timeout_ms: config.docling.timeoutMs,
        port: config.docling.port
      }
    },
    llm: llmRoleSummary(config),
    interfaces: {
      mcp: {
        enabled: config.mcp.enabled,
        transport: config.mcp.transport,
        api_url: config.mcp.apiUrl,
        token_configured: config.mcp.apiToken.length > 0
      },
      cli: {
        api_url: config.cli.apiUrl,
        token_configured: config.cli.apiToken.length > 0
      },
      hermes: {
        enabled: config.hermes.adapterEnabled,
        api_url: config.hermes.apiUrl,
        token_configured: config.hermes.apiToken.length > 0,
        default_project: config.hermes.defaultProject
      }
    },
    telemetry: {
      metrics_enabled: config.metrics.enabled,
      metrics_path: config.metrics.path,
      worker_metrics_host: config.metrics.workerHost,
      worker_metrics_port: config.metrics.workerPort,
      traces_enabled: config.telemetry.tracesEnabled,
      log_export_enabled: config.telemetry.logExportEnabled,
      service_name: config.telemetry.serviceName
    }
  };
}

function llmRoleSummary(config: MindoryConfig): Record<string, unknown> {
  return {
    chat: summarizeLlmCapability(config.llm.chat),
    text_embedding: summarizeLlmCapability(config.llm.textEmbedding),
    image_embedding: summarizeLlmCapability(config.llm.imageEmbedding),
    vision_captioning: summarizeLlmCapability(config.llm.visionCaptioning),
    ocr: summarizeLlmCapability(config.llm.ocr),
    asr: summarizeLlmCapability(config.llm.asr),
    face_detection: summarizeLlmCapability(config.llm.faceDetection),
    face_recognition: summarizeLlmCapability(config.llm.faceRecognition),
    image_generation: summarizeLlmCapability(config.llm.imageGeneration),
    audio_generation: summarizeLlmCapability(config.llm.audioGeneration),
    providers: {
      openai_compatible: {
        base_url: config.llm.openaiCompatible.baseUrl,
        auth_mode: config.llm.openaiCompatible.authMode,
        api_key_configured: config.llm.openaiCompatible.apiKey.length > 0,
        oauth_token_configured: config.llm.openaiCompatible.oauthAccessToken.length > 0
      },
      ollama: {
        base_url: config.llm.ollama.baseUrl
      },
      local_http: {
        base_url: config.llm.localHttp.baseUrl
      },
      local_command: {
        healthcheck_configured: config.llm.localCommand.healthcheckCommand.length > 0,
        operation_configured: config.llm.localCommand.operationCommand.length > 0,
        timeout_ms: config.llm.localCommand.timeoutMs
      }
    }
  };
}

function summarizeLlmCapability(capability: { enabled: boolean; provider: string; model: string; required: boolean; timeoutMs: number; concurrency: number; dimensions?: number | null }): Record<string, unknown> {
  return {
    enabled: capability.enabled,
    provider: capability.provider,
    model: capability.model,
    model_configured: capability.model.length > 0,
    required: capability.required,
    timeout_ms: capability.timeoutMs,
    concurrency: capability.concurrency,
    ...(capability.dimensions === undefined ? {} : { dimensions: capability.dimensions })
  };
}

function providerHealth(config: MindoryConfig): Record<string, unknown> {
  return {
    storage: healthState(config.storage.provider, true),
    vector: healthState(config.vector.provider, true),
    antivirus: healthState(config.antivirus.provider, config.antivirus.enabled),
    docling: healthState("docling", config.docling.enabled),
    llm_roles: Object.fromEntries(Object.entries(llmRoleSummary(config)).filter(([key]) => key !== "providers").map(([key, value]) => {
      const role = value as { enabled?: boolean; provider?: string; model_configured?: boolean };
      return [key, healthState(role.provider ?? "disabled", Boolean(role.enabled) && role.provider !== "disabled" && Boolean(role.model_configured))];
    }))
  };
}

function healthState(provider: string, configured: boolean): Record<string, unknown> {
  return {
    provider,
    configured,
    status: configured ? "configured" : "disabled"
  };
}

function metricsLinks(config: MindoryConfig): Record<string, unknown> {
  return {
    enabled: config.metrics.enabled,
    api_metrics_url: config.metrics.enabled ? `${trimTrailingSlash(config.api.publicUrl)}${config.metrics.path}` : null,
    worker_metrics_url: config.metrics.enabled ? `http://${config.metrics.workerHost}:${config.metrics.workerPort}${config.metrics.path}` : null,
    bearer_token_configured: config.metrics.bearerToken.length > 0
  };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
