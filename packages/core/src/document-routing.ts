import path from "node:path";
import type { DocumentRecord } from "./documents.js";
import type { ProcessingJobType } from "./queue.js";

export type DocumentFileKind = "text" | "pdf" | "image" | "audio" | "video" | "unknown";

export interface DocumentProcessingModalityConfig {
  enabled: boolean;
  required: boolean;
}

export interface DocumentProcessingVideoConfig extends DocumentProcessingModalityConfig {
  maxKeyframes: number;
}

export interface DocumentProcessingRouteConfig {
  routingEnabled: boolean;
  text: DocumentProcessingModalityConfig;
  pdf: DocumentProcessingModalityConfig;
  image: DocumentProcessingModalityConfig;
  audio: DocumentProcessingModalityConfig;
  video: DocumentProcessingVideoConfig;
}

export interface DocumentFileClassification {
  kind: DocumentFileKind;
  mimeType: string;
  extension: string;
  magicMatched: boolean;
  supported: boolean;
}

export interface DocumentRouteJobPlan {
  type: Extract<ProcessingJobType, "document.extract">;
  processorVersion: string;
  reason: "text_extraction" | "pdf_extraction" | "image_semantic_extraction" | "audio_transcription" | "video_keyframes";
  metadata: Record<string, unknown>;
}

export interface DocumentRouteSkip {
  kind: DocumentFileKind;
  reason: "routing_disabled" | "disabled" | "processor_not_implemented" | "unsupported_document_type";
  required: boolean;
}

export interface DocumentRoutePlan {
  classification: DocumentFileClassification;
  jobs: DocumentRouteJobPlan[];
  skipped: DocumentRouteSkip[];
  metadata: Record<string, unknown>;
}

export interface ClassifyDocumentFileInput {
  document: Pick<DocumentRecord, "originalFilename" | "mimeType">;
  magicBytes?: Uint8Array;
}

export interface PlanDocumentProcessingRouteInput extends ClassifyDocumentFileInput {
  config: DocumentProcessingRouteConfig;
}

const textExtensions = new Set([".txt", ".md", ".markdown"]);
const pdfExtensions = new Set([".pdf"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff"]);
const audioExtensions = new Set([".aac", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"]);
const videoExtensions = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm"]);

export function classifyDocumentFile(input: ClassifyDocumentFileInput): DocumentFileClassification {
  const mimeType = input.document.mimeType.toLowerCase();
  const extension = path.extname(input.document.originalFilename).toLowerCase();
  const magicKind = classifyMagicBytes(input.magicBytes);
  if (magicKind) {
    return buildClassification(magicKind, mimeType, extension, true);
  }

  if (mimeType.startsWith("text/") || textExtensions.has(extension)) {
    return buildClassification("text", mimeType, extension, false);
  }
  if (mimeType === "application/pdf" || pdfExtensions.has(extension)) {
    return buildClassification("pdf", mimeType, extension, false);
  }
  if (mimeType.startsWith("image/") || imageExtensions.has(extension)) {
    return buildClassification("image", mimeType, extension, false);
  }
  if (mimeType.startsWith("audio/") || audioExtensions.has(extension)) {
    return buildClassification("audio", mimeType, extension, false);
  }
  if (mimeType.startsWith("video/") || videoExtensions.has(extension)) {
    return buildClassification("video", mimeType, extension, false);
  }

  return buildClassification("unknown", mimeType, extension, false);
}

export function planDocumentProcessingRoute(input: PlanDocumentProcessingRouteInput): DocumentRoutePlan {
  const classification = classifyDocumentFile(input);
  const modalityConfig = configForKind(input.config, classification.kind);
  const skipped: DocumentRouteSkip[] = [];
  const jobs: DocumentRouteJobPlan[] = [];

  if (!input.config.routingEnabled) {
    skipped.push({ kind: classification.kind, reason: "routing_disabled", required: modalityConfig?.required ?? false });
  } else if (classification.kind === "unknown") {
    skipped.push({ kind: classification.kind, reason: "unsupported_document_type", required: false });
  } else if (!modalityConfig?.enabled) {
    skipped.push({ kind: classification.kind, reason: "disabled", required: modalityConfig?.required ?? false });
  } else if (classification.kind === "text" || classification.kind === "pdf" || classification.kind === "image" || classification.kind === "audio" || classification.kind === "video") {
    const reason = routeReasonForKind(classification.kind);
    jobs.push({
      type: "document.extract",
      processorVersion: "document-extract-v1",
      reason,
      metadata: {
        route_kind: classification.kind,
        route_reason: reason,
        route_magic_matched: classification.magicMatched
      }
    });
  } else {
    skipped.push({ kind: classification.kind, reason: "processor_not_implemented", required: modalityConfig.required });
  }

  return {
    classification,
    jobs,
    skipped,
    metadata: {
      routing: {
        enabled: input.config.routingEnabled,
        classification,
        planned_jobs: jobs.map((job) => ({
          type: job.type,
          processor_version: job.processorVersion,
          reason: job.reason
        })),
        skipped
      }
    }
  };
}

function configForKind(config: DocumentProcessingRouteConfig, kind: DocumentFileKind): DocumentProcessingModalityConfig | undefined {
  switch (kind) {
    case "text":
      return config.text;
    case "pdf":
      return config.pdf;
    case "image":
      return config.image;
    case "audio":
      return config.audio;
    case "video":
      return config.video;
    case "unknown":
      return undefined;
  }
}

function routeReasonForKind(kind: Extract<DocumentFileKind, "text" | "pdf" | "image" | "audio" | "video">): DocumentRouteJobPlan["reason"] {
  if (kind === "pdf") {
    return "pdf_extraction";
  }
  if (kind === "image") {
    return "image_semantic_extraction";
  }
  if (kind === "audio") {
    return "audio_transcription";
  }
  if (kind === "video") {
    return "video_keyframes";
  }
  return "text_extraction";
}

function buildClassification(kind: DocumentFileKind, mimeType: string, extension: string, magicMatched: boolean): DocumentFileClassification {
  return {
    kind,
    mimeType,
    extension,
    magicMatched,
    supported: kind !== "unknown"
  };
}

function classifyMagicBytes(bytes: Uint8Array | undefined): DocumentFileKind | null {
  if (!bytes || bytes.length === 0) {
    return null;
  }

  if (matchesAscii(bytes, "%PDF")) {
    return "pdf";
  }
  if (matchesBytes(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return "image";
  }
  if (matchesBytes(bytes, [0xff, 0xd8, 0xff])) {
    return "image";
  }
  if (matchesAscii(bytes, "GIF87a") || matchesAscii(bytes, "GIF89a")) {
    return "image";
  }
  if (bytes.length >= 12 && matchesAscii(bytes.subarray(8), "WEBP")) {
    return "image";
  }
  if (matchesAscii(bytes, "ID3") || matchesAscii(bytes, "OggS")) {
    return "audio";
  }
  if (bytes.length >= 12 && matchesAscii(bytes.subarray(4), "ftyp")) {
    return "video";
  }

  return null;
}

function matchesBytes(bytes: Uint8Array, expected: number[]): boolean {
  if (bytes.length < expected.length) {
    return false;
  }

  return expected.every((value, index) => bytes[index] === value);
}

function matchesAscii(bytes: Uint8Array, expected: string): boolean {
  if (bytes.length < expected.length) {
    return false;
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[index] !== expected.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}
