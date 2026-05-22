import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ProcessingError,
  type ExtractedSemanticArtifact,
  type ExtractedText,
  type ExtractTextInput,
  type TextExtractor
} from "@mindory/core/processing";
import type { LlmOcrProvider, LlmRoleDescriptor, LlmVisionProvider } from "@mindory/llm";

export interface VideoKeyframeExtractorOptions {
  maxKeyframes?: number;
  keyframeProvider?: VideoKeyframeProviderKind;
  keyframeCommand?: string;
  keyframeCommandArgs?: string[];
  keyframeTimeoutMs?: number;
  ocr?: ModelCapabilityState;
  visionCaptioning?: ModelCapabilityState;
  ocrProvider?: LlmOcrProvider;
  ocrRole?: LlmRoleDescriptor;
  visionProvider?: LlmVisionProvider;
  visionRole?: LlmRoleDescriptor;
}

export type VideoKeyframeProviderKind = "manifest" | "local-command";

export interface ModelCapabilityState {
  enabled: boolean;
  provider: string;
  model: string;
  required: boolean;
}

export interface VideoManifest {
  durationMs: number | null;
  codec: string | null;
  frames: VideoFrameManifest[];
}

export interface VideoFrameManifest {
  timestampMs: number;
  description: string;
  labels?: string[];
  imageDataBase64?: string;
  mimeType?: string;
  caption?: string;
  ocrText?: string;
  source?: string;
  ocrStatus?: string;
  visionStatus?: string;
}

const supportedMimePrefixes = ["video/"];
const supportedExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const manifestPrefix = "MINDORY_VIDEO_MANIFEST\n";

export class VideoKeyframeExtractor implements TextExtractor {
  readonly name = "video-keyframe";
  readonly version = "video-keyframe-v2";
  private readonly maxKeyframes: number;
  private readonly keyframeProvider: VideoKeyframeProviderKind;
  private readonly keyframeCommand: string;
  private readonly keyframeCommandArgs: string[];
  private readonly keyframeTimeoutMs: number;
  private readonly ocr: ModelCapabilityState;
  private readonly visionCaptioning: ModelCapabilityState;
  private readonly ocrProvider: LlmOcrProvider | undefined;
  private readonly ocrRole: LlmRoleDescriptor | undefined;
  private readonly visionProvider: LlmVisionProvider | undefined;
  private readonly visionRole: LlmRoleDescriptor | undefined;

  constructor(options: VideoKeyframeExtractorOptions = {}) {
    this.maxKeyframes = Math.max(1, options.maxKeyframes ?? 10);
    this.keyframeProvider = options.keyframeProvider ?? "manifest";
    this.keyframeCommand = options.keyframeCommand ?? "";
    this.keyframeCommandArgs = options.keyframeCommandArgs ?? [];
    this.keyframeTimeoutMs = Math.max(1, options.keyframeTimeoutMs ?? 120_000);
    this.ocr = options.ocr ?? disabledCapability();
    this.visionCaptioning = options.visionCaptioning ?? disabledCapability();
    this.ocrProvider = options.ocrProvider;
    this.ocrRole = options.ocrRole;
    this.visionProvider = options.visionProvider;
    this.visionRole = options.visionRole;
  }

  supports(document: { originalFilename: string; mimeType: string }): boolean {
    const mimeType = normalizeMimeType(document.mimeType);
    return supportedMimePrefixes.some((prefix) => mimeType.startsWith(prefix)) || supportedExtensions.has(fileExtension(document.originalFilename));
  }

  async extract(input: ExtractTextInput): Promise<ExtractedText> {
    if (!this.supports(input.document)) {
      throw new ProcessingError(
        "unsupported_document_type",
        `Video keyframe extractor does not support ${input.document.mimeType} (${input.document.originalFilename}).`
      );
    }

    const bytes = await readAllBytes(input.body);
    const manifest = await this.extractManifest(bytes, input);
    const frames = await this.enrichFrames(manifest.frames.slice(0, this.maxKeyframes), input);
    const text = frames.map((frame, index) => frameText(frame, index)).join("\n");

    return {
      projectId: input.document.projectId,
      documentId: input.document.id,
      text,
      mimeType: input.document.mimeType,
      semanticArtifacts: frames.map((frame, index): ExtractedSemanticArtifact => ({
        artifactType: "video_keyframe",
        content: frame.description,
        spanType: "video_keyframe_description",
        artifactIndex: index,
        sourcePosition: {
          frame_index: index,
          timestamp_ms: frame.timestampMs
        },
        metadata: {
          frame_index: index,
          timestamp_ms: frame.timestampMs,
          labels: frame.labels ?? [],
          source: frame.source ?? "embedded_video_manifest",
          caption: frame.caption ?? null,
          ocr_text: frame.ocrText ?? null,
          image_mime_type: frame.mimeType ?? null,
          capabilities: {
            ocr: capabilitySnapshot(this.ocr, frame.ocrStatus ?? (this.ocr.enabled ? "skipped_no_frame_image" : "disabled")),
            vision_captioning: capabilitySnapshot(this.visionCaptioning, frame.visionStatus ?? (this.visionCaptioning.enabled ? "skipped_no_frame_image" : "disabled"))
          }
        }
      })),
      metadata: {
        extractor: this.name,
        extractor_version: this.version,
        original_filename: input.document.originalFilename,
        video_keyframes: true,
        duration_ms: manifest.durationMs,
        codec: manifest.codec,
        frame_count: frames.length,
        manifest_frame_count: manifest.frames.length,
        max_keyframes: this.maxKeyframes,
        keyframe_provider: this.keyframeProvider,
        keyframe_command: this.keyframeProvider === "local-command" ? this.keyframeCommand : "",
        capabilities: {
          ocr: capabilitySnapshot(this.ocr, frames.some((frame) => frame.ocrStatus === "provider_ocr") ? "provider_ocr" : this.ocr.enabled ? "skipped_no_frame_image" : "disabled"),
          vision_captioning: capabilitySnapshot(this.visionCaptioning, frames.some((frame) => frame.visionStatus === "provider_caption") ? "provider_caption" : this.visionCaptioning.enabled ? "skipped_no_frame_image" : "disabled")
        }
      }
    };
  }

  private async extractManifest(bytes: Buffer, input: ExtractTextInput): Promise<VideoManifest> {
    if (this.keyframeProvider === "local-command") {
      if (this.keyframeCommand.trim() === "") {
        throw new ProcessingError("text_extraction_failed", "Video local-command keyframe extraction is enabled, but no command is configured.");
      }
      return new LocalCommandVideoKeyframeProvider({
        command: this.keyframeCommand,
        args: this.keyframeCommandArgs,
        timeoutMs: this.keyframeTimeoutMs
      }).extract({
        bytes,
        filename: input.document.originalFilename,
        mimeType: input.document.mimeType,
        maxKeyframes: this.maxKeyframes
      });
    }
    return readVideoManifest(bytes) ?? fallbackManifest(input.document.originalFilename);
  }

  private async enrichFrames(frames: VideoFrameManifest[], input: ExtractTextInput): Promise<VideoFrameManifest[]> {
    const enriched: VideoFrameManifest[] = [];
    for (const [index, frame] of frames.entries()) {
      enriched.push(await this.enrichFrame(frame, index, input));
    }
    return enriched;
  }

  private async enrichFrame(frame: VideoFrameManifest, index: number, input: ExtractTextInput): Promise<VideoFrameManifest> {
    const imageBytes = frame.imageDataBase64 === undefined ? null : Buffer.from(frame.imageDataBase64, "base64");
    const mimeType = frame.mimeType ?? "image/png";
    const enriched: VideoFrameManifest = {
      ...frame,
      source: frame.source ?? (this.keyframeProvider === "local-command" ? "local_command_keyframes" : "embedded_video_manifest")
    };

    if (imageBytes === null) {
      if ((this.ocr.enabled && this.ocr.required) || (this.visionCaptioning.enabled && this.visionCaptioning.required)) {
        throw new ProcessingError("text_extraction_failed", `Video frame ${index} has no image bytes for required OCR or vision processing.`);
      }
      return enriched;
    }

    if (this.ocr.enabled && this.ocrProvider !== undefined && this.ocrRole !== undefined) {
      const result = await this.ocrProvider.recognizeText({
        bytes: imageBytes,
        mimeType
      }, {
        role: this.ocrRole,
        refs: {
          projectId: input.document.projectId,
          documentId: input.document.id
        }
      });
      if (result.status === "success" && result.value !== undefined && result.value.text.trim().length > 0) {
        enriched.ocrText = result.value.text.trim();
        enriched.ocrStatus = "provider_ocr";
      } else if (this.ocr.required) {
        throw new ProcessingError("text_extraction_failed", result.audit.errorMessage ?? `Video frame ${index} OCR provider returned no text.`);
      } else if (result.status === "failed") {
        enriched.ocrStatus = "provider_failed";
      }
    }

    if (this.visionCaptioning.enabled && this.visionProvider !== undefined && this.visionRole !== undefined) {
      const result = await this.visionProvider.captionImage({
        bytes: imageBytes,
        mimeType
      }, {
        role: this.visionRole,
        refs: {
          projectId: input.document.projectId,
          documentId: input.document.id
        }
      });
      if (result.status === "success" && result.value !== undefined && result.value.caption.trim().length > 0) {
        enriched.caption = result.value.caption.trim();
        enriched.description = enriched.caption;
        enriched.labels = mergeLabels(enriched.labels ?? [], result.value.labels ?? []);
        enriched.visionStatus = "provider_caption";
      } else if (this.visionCaptioning.required) {
        throw new ProcessingError("text_extraction_failed", result.audit.errorMessage ?? `Video frame ${index} vision provider returned no caption.`);
      } else if (result.status === "failed") {
        enriched.visionStatus = "provider_failed";
      }
    }

    return enriched;
  }
}

export class LocalCommandVideoKeyframeProvider {
  constructor(private readonly options: { command: string; args: string[]; timeoutMs: number }) {}

  async extract(input: { bytes: Buffer; filename: string; mimeType: string; maxKeyframes: number }): Promise<VideoManifest> {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mindory-video-keyframes-"));
    const inputPath = path.join(tempDir, `input${fileExtension(input.filename) || ".video"}`);
    try {
      await writeFile(inputPath, input.bytes);
      const args = this.options.args.map((arg) => replaceCommandToken(arg, {
        inputPath,
        filename: input.filename,
        mimeType: input.mimeType,
        maxKeyframes: input.maxKeyframes
      }));
      const output = await runLocalCommand(this.options.command, args, this.options.timeoutMs);
      const manifest = parseVideoManifestText(output);
      if (manifest === null) {
        throw new ProcessingError("text_extraction_failed", "Video keyframe local-command output did not include a valid manifest.");
      }
      return {
        ...manifest,
        frames: manifest.frames.map((frame) => ({
          ...frame,
          source: "local_command_keyframes"
        }))
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export function readVideoManifest(bytes: Buffer): VideoManifest | null {
  const text = bytes.toString("utf8");
  const start = text.indexOf(manifestPrefix);
  if (start < 0) {
    return null;
  }
  return parseVideoManifestText(text.slice(start + manifestPrefix.length).trim());
}

function parseVideoManifestText(manifestText: string): VideoManifest | null {
  try {
    const parsed = JSON.parse(manifestText) as Partial<VideoManifest>;
    const frames = Array.isArray(parsed.frames)
      ? parsed.frames.map(normalizeFrame).filter((frame): frame is VideoFrameManifest => frame !== null)
      : [];
    if (frames.length === 0) {
      return null;
    }
    return {
      durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : null,
      codec: typeof parsed.codec === "string" ? parsed.codec : null,
      frames
    };
  } catch {
    return null;
  }
}

function normalizeFrame(frame: unknown): VideoFrameManifest | null {
  if (typeof frame !== "object" || frame === null) {
    return null;
  }
  const record = frame as Record<string, unknown>;
  if (typeof record.timestampMs !== "number" || typeof record.description !== "string" || record.description.trim() === "") {
    return null;
  }
  const normalized: VideoFrameManifest = {
    timestampMs: record.timestampMs,
    description: record.description.trim()
  };
  if (Array.isArray(record.labels)) {
    normalized.labels = record.labels.filter((label): label is string => typeof label === "string");
  }
  if (typeof record.imageDataBase64 === "string") {
    normalized.imageDataBase64 = record.imageDataBase64;
  } else if (typeof record.data_base64 === "string") {
    normalized.imageDataBase64 = record.data_base64;
  }
  if (typeof record.mimeType === "string") {
    normalized.mimeType = record.mimeType;
  } else if (typeof record.mime_type === "string") {
    normalized.mimeType = record.mime_type;
  }
  return normalized;
}

function frameText(frame: VideoFrameManifest, index: number): string {
  return [
    `Keyframe ${index + 1} at ${frame.timestampMs}ms: ${frame.description}`,
    frame.ocrText === undefined ? "" : `Frame OCR text: ${frame.ocrText}`,
    frame.labels === undefined || frame.labels.length === 0 ? "" : `Frame labels: ${frame.labels.join(", ")}`
  ].filter((line) => line.length > 0).join("\n");
}

function mergeLabels(left: string[], right: string[]): string[] {
  const labels = new Set<string>();
  for (const label of left.concat(right)) {
    const normalized = label.trim().toLowerCase();
    if (normalized.length > 0) {
      labels.add(normalized);
    }
  }
  return Array.from(labels);
}

function replaceCommandToken(arg: string, values: { inputPath: string; filename: string; mimeType: string; maxKeyframes: number }): string {
  return arg
    .replaceAll("{input}", values.inputPath)
    .replaceAll("{filename}", values.filename)
    .replaceAll("{mimeType}", values.mimeType)
    .replaceAll("{maxKeyframes}", String(values.maxKeyframes));
}

function runLocalCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new ProcessingError("text_extraction_failed", `Video keyframe local-command timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new ProcessingError("text_extraction_failed", `Video keyframe local-command failed to start: ${error.message}`));
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new ProcessingError("text_extraction_failed", `Video keyframe local-command exited with ${code}: ${stderr.trim()}`));
          return;
        }
        resolve(stdout);
      }
    });
  });
}

function capabilitySnapshot(capability: ModelCapabilityState, status: string): Record<string, unknown> {
  return {
    enabled: capability.enabled,
    provider: capability.provider,
    model: capability.model,
    required: capability.required,
    status
  };
}

function disabledCapability(): ModelCapabilityState {
  return {
    enabled: false,
    provider: "disabled",
    model: "",
    required: false
  };
}

function fallbackManifest(filename: string): VideoManifest {
  const description = filename
    .replace(/\.[^.]+$/, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && !/^\d+$/.test(part))
    .join(" ");
  return {
    durationMs: null,
    codec: null,
    frames: [{
      timestampMs: 0,
      description: description || "video keyframe"
    }]
  };
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function fileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : "";
}

async function readAllBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
