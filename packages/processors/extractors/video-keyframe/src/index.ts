import {
  ProcessingError,
  type ExtractedSemanticArtifact,
  type ExtractedText,
  type ExtractTextInput,
  type TextExtractor
} from "@mindory/core/processing";

export interface VideoKeyframeExtractorOptions {
  maxKeyframes?: number;
}

interface VideoManifest {
  durationMs: number | null;
  codec: string | null;
  frames: VideoFrameManifest[];
}

interface VideoFrameManifest {
  timestampMs: number;
  description: string;
  labels?: string[];
}

const supportedMimePrefixes = ["video/"];
const supportedExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const manifestPrefix = "MINDORY_VIDEO_MANIFEST\n";

export class VideoKeyframeExtractor implements TextExtractor {
  readonly name = "video-keyframe";
  readonly version = "video-keyframe-v1";
  private readonly maxKeyframes: number;

  constructor(options: VideoKeyframeExtractorOptions = {}) {
    this.maxKeyframes = Math.max(1, options.maxKeyframes ?? 10);
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
    const manifest = readVideoManifest(bytes) ?? fallbackManifest(input.document.originalFilename);
    const frames = manifest.frames.slice(0, this.maxKeyframes);
    const text = frames.map((frame, index) => `Keyframe ${index + 1} at ${frame.timestampMs}ms: ${frame.description}`).join("\n");

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
          source: "embedded_video_manifest"
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
        max_keyframes: this.maxKeyframes
      }
    };
  }
}

export function readVideoManifest(bytes: Buffer): VideoManifest | null {
  const text = bytes.toString("utf8");
  const start = text.indexOf(manifestPrefix);
  if (start < 0) {
    return null;
  }
  const manifestText = text.slice(start + manifestPrefix.length).trim();
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
  return normalized;
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
