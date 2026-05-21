import { createHash } from "node:crypto";
import {
  ProcessingError,
  type ExtractedFaceObservation,
  type ExtractedSemanticArtifact,
  type ExtractedText,
  type ExtractTextInput,
  type TextExtractor
} from "@mindory/core/processing";

export interface ImageSemanticExtractorOptions {
  faceDetection?: ModelCapabilityState;
  faceRecognition?: ModelCapabilityState;
  imageCaptioning?: ModelCapabilityState;
  imageEmbedding?: ModelCapabilityState;
  ocr?: ModelCapabilityState;
}

export interface ModelCapabilityState {
  enabled: boolean;
  provider: string;
  model: string;
  required: boolean;
}

interface ImageMetadata {
  mimeType: string;
  extension: string;
  width: number | null;
  height: number | null;
  orientation: "landscape" | "portrait" | "square" | "unknown";
  embeddedText: string[];
  filenameLabels: string[];
}

const supportedMimePrefixes = ["image/"];
const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff"]);

export class ImageSemanticExtractor implements TextExtractor {
  readonly name = "image-semantic";
  readonly version = "image-semantic-v1";
  private readonly faceDetection: ModelCapabilityState;
  private readonly faceRecognition: ModelCapabilityState;
  private readonly imageCaptioning: ModelCapabilityState;
  private readonly imageEmbedding: ModelCapabilityState;
  private readonly ocr: ModelCapabilityState;

  constructor(options: ImageSemanticExtractorOptions = {}) {
    this.faceDetection = options.faceDetection ?? disabledCapability();
    this.faceRecognition = options.faceRecognition ?? disabledCapability();
    this.imageCaptioning = options.imageCaptioning ?? disabledCapability();
    this.imageEmbedding = options.imageEmbedding ?? disabledCapability();
    this.ocr = options.ocr ?? disabledCapability();
  }

  supports(document: { originalFilename: string; mimeType: string }): boolean {
    const mimeType = normalizeMimeType(document.mimeType);
    return supportedMimePrefixes.some((prefix) => mimeType.startsWith(prefix)) || supportedExtensions.has(fileExtension(document.originalFilename));
  }

  async extract(input: ExtractTextInput): Promise<ExtractedText> {
    if (!this.supports(input.document)) {
      throw new ProcessingError(
        "unsupported_document_type",
        `Image semantic extractor does not support ${input.document.mimeType} (${input.document.originalFilename}).`
      );
    }

    const bytes = await readAllBytes(input.body);
    const metadata = extractImageMetadata(bytes, input.document.originalFilename, input.document.mimeType);
    const ocrText = metadata.embeddedText.join("\n").trim();
    if (this.ocr.enabled && this.ocr.required && ocrText.length === 0) {
      throw new ProcessingError("text_extraction_failed", "Image OCR is required, but no concrete OCR adapter produced text.");
    }

    const labels = buildImageLabels(metadata);
    const faceCount = this.faceDetection.enabled ? readPeopleCount(labels, ocrText) : 0;
    const caption = buildCaption(metadata, labels);
    const analysis = buildAnalysis(metadata, labels, ocrText);
    const semanticText = [
      caption,
      analysis,
      faceCount > 0 ? `Detected face observations: ${faceCount}.` : "",
      ocrText.length > 0 ? `Image OCR text: ${ocrText}` : ""
    ].filter((line) => line.length > 0).join("\n\n");

    return {
      projectId: input.document.projectId,
      documentId: input.document.id,
      text: semanticText,
      mimeType: input.document.mimeType,
      semanticArtifacts: buildSemanticArtifacts({
        caption,
        analysis,
        ocrText,
        labels,
        metadata,
        imageCaptioning: this.imageCaptioning,
        imageEmbedding: this.imageEmbedding,
        ocr: this.ocr
      }),
      faceObservations: buildFaceObservations({
        count: faceCount,
        metadata,
        faceDetection: this.faceDetection,
        faceRecognition: this.faceRecognition
      }),
      metadata: {
        extractor: this.name,
        extractor_version: this.version,
        original_filename: input.document.originalFilename,
        image_semantic: true,
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        labels,
        face_count: faceCount,
        embedded_text_count: metadata.embeddedText.length,
        capabilities: {
          face_detection: capabilitySnapshot(this.faceDetection, faceCount > 0 ? "fallback_people_count_detected" : this.faceDetection.enabled ? "no_people_count_detected" : "disabled"),
          face_recognition: capabilitySnapshot(this.faceRecognition, faceCount > 0 ? "fallback_deterministic_embeddings" : this.faceRecognition.enabled ? "no_faces_to_embed" : "disabled"),
          image_captioning: capabilitySnapshot(this.imageCaptioning, this.imageCaptioning.enabled ? "fallback_metadata_caption" : "disabled"),
          image_embedding: capabilitySnapshot(this.imageEmbedding, this.imageEmbedding.enabled ? "skipped_no_adapter" : "disabled"),
          ocr: capabilitySnapshot(this.ocr, ocrText.length > 0 ? "embedded_text_extracted" : this.ocr.enabled ? "skipped_no_adapter" : "disabled")
        }
      }
    };
  }
}

function buildSemanticArtifacts(input: {
  caption: string;
  analysis: string;
  ocrText: string;
  labels: string[];
  metadata: ImageMetadata;
  imageCaptioning: ModelCapabilityState;
  imageEmbedding: ModelCapabilityState;
  ocr: ModelCapabilityState;
}): ExtractedSemanticArtifact[] {
  const artifacts: ExtractedSemanticArtifact[] = [
    {
      artifactType: "image_caption",
      content: input.caption,
      spanType: "image_caption",
      artifactIndex: 0,
      modelProvider: input.imageCaptioning.provider,
      modelName: input.imageCaptioning.model,
      metadata: {
        labels: input.labels,
        capability: capabilitySnapshot(input.imageCaptioning, input.imageCaptioning.enabled ? "fallback_metadata_caption" : "disabled")
      }
    },
    {
      artifactType: "image_analysis",
      content: input.analysis,
      spanType: "image_analysis",
      artifactIndex: 1,
      modelProvider: input.imageCaptioning.provider,
      modelName: input.imageCaptioning.model,
      metadata: {
        labels: input.labels,
        width: input.metadata.width,
        height: input.metadata.height,
        orientation: input.metadata.orientation,
        capability: capabilitySnapshot(input.imageCaptioning, input.imageCaptioning.enabled ? "fallback_metadata_analysis" : "disabled")
      }
    },
    {
      artifactType: "image_embedding",
      content: `Image embedding status: ${input.imageEmbedding.enabled ? "skipped_no_adapter" : "disabled"}.`,
      spanType: "image_embedding_status",
      artifactIndex: 2,
      modelProvider: input.imageEmbedding.provider,
      modelName: input.imageEmbedding.model,
      metadata: {
        labels: input.labels,
        capability: capabilitySnapshot(input.imageEmbedding, input.imageEmbedding.enabled ? "skipped_no_adapter" : "disabled")
      }
    }
  ];

  if (input.ocrText.length > 0) {
    artifacts.push({
      artifactType: "ocr_text",
      content: input.ocrText,
      spanType: "ocr_text",
      artifactIndex: 3,
      modelProvider: input.ocr.provider,
      modelName: input.ocr.model,
      metadata: {
        source: "embedded_image_text",
        capability: capabilitySnapshot(input.ocr, "embedded_text_extracted")
      }
    });
  }

  return artifacts;
}

function buildFaceObservations(input: {
  count: number;
  metadata: ImageMetadata;
  faceDetection: ModelCapabilityState;
  faceRecognition: ModelCapabilityState;
}): ExtractedFaceObservation[] {
  if (input.count <= 0) {
    return [];
  }

  return Array.from({ length: input.count }, (_, index) => ({
    observationIndex: index,
    content: `Face observation ${index + 1} detected by image fallback.`,
    boundingBox: deterministicFaceBox(index, input.count),
    embedding: deterministicFaceEmbedding(`fallback-face:${index}:${input.faceRecognition.model || "disabled"}`),
    model: input.faceRecognition.model || input.faceDetection.model || null,
    confidence: 0.5,
    metadata: {
      source: "fallback_people_count",
      image_width: input.metadata.width,
      image_height: input.metadata.height,
      detection_capability: capabilitySnapshot(input.faceDetection, "fallback_people_count_detected"),
      recognition_capability: capabilitySnapshot(input.faceRecognition, "fallback_deterministic_embeddings")
    }
  }));
}

function extractImageMetadata(bytes: Buffer, filename: string, mimeType: string): ImageMetadata {
  const dimensions = readImageDimensions(bytes);
  const orientation = dimensions.width === null || dimensions.height === null
    ? "unknown"
    : dimensions.width === dimensions.height
      ? "square"
      : dimensions.width > dimensions.height ? "landscape" : "portrait";
  return {
    mimeType: normalizeMimeType(mimeType),
    extension: fileExtension(filename).replace(/^\./, ""),
    width: dimensions.width,
    height: dimensions.height,
    orientation,
    embeddedText: extractEmbeddedImageText(bytes),
    filenameLabels: labelsFromFilename(filename)
  };
}

function buildImageLabels(metadata: ImageMetadata): string[] {
  const labels = new Set(["image", metadata.extension, metadata.orientation].filter((label) => label.length > 0 && label !== "unknown"));
  for (const label of metadata.filenameLabels) {
    labels.add(label);
  }
  if (metadata.width !== null && metadata.height !== null) {
    labels.add(`${metadata.width}x${metadata.height}`);
  }
  return Array.from(labels);
}

function buildCaption(metadata: ImageMetadata, labels: string[]): string {
  const size = metadata.width !== null && metadata.height !== null
    ? `${metadata.width}x${metadata.height} ${metadata.orientation}`
    : metadata.orientation;
  return `Image semantic description: ${size} ${metadata.extension || metadata.mimeType} image with labels ${labels.join(", ")}.`;
}

function buildAnalysis(metadata: ImageMetadata, labels: string[], ocrText: string): string {
  const peoplePhrase = readPeoplePhrase(labels);
  return [
    `Image visual labels: ${labels.join(", ")}.`,
    peoplePhrase,
    ocrText.length > 0 ? "Recognized embedded image text is available." : "No embedded OCR text was found by the fallback extractor."
  ].filter((line) => line.length > 0).join(" ");
}

function readPeoplePhrase(labels: string[]): string {
  const peopleIndex = labels.findIndex((label) => label === "people" || label === "person");
  if (peopleIndex < 0) {
    return "";
  }
  const count = labels.find((label) => /^\d+$/.test(label));
  return count ? `${count} people in image labels.` : "People mentioned in image labels.";
}

function readPeopleCount(labels: string[], ocrText: string): number {
  const labelCount = labels.find((label) => /^\d+$/.test(label));
  if (labelCount && labels.some((label) => label === "people" || label === "person" || label === "persons")) {
    return clampPeopleCount(Number.parseInt(labelCount, 10));
  }
  const match = ocrText.match(/\b(\d{1,2})\s+(people|persons?|faces?)\b/i);
  if (match?.[1]) {
    return clampPeopleCount(Number.parseInt(match[1], 10));
  }
  return 0;
}

function clampPeopleCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(value, 20);
}

function deterministicFaceBox(index: number, count: number): Record<string, unknown> {
  const width = Math.min(0.18, 0.8 / Math.max(count, 1));
  const gap = count === 1 ? 0 : (0.82 - width * count) / Math.max(count - 1, 1);
  const x = 0.09 + index * (width + Math.max(gap, 0.02));
  return {
    x: Number(x.toFixed(4)),
    y: 0.2,
    width: Number(width.toFixed(4)),
    height: 0.32,
    unit: "ratio"
  };
}

function deterministicFaceEmbedding(key: string): number[] {
  const digest = createHash("sha512").update(key, "utf8").digest();
  const values = Array.from({ length: 512 }, (_, index) => {
    const byte = digest[index % digest.length] ?? 0;
    return (byte / 255) * 2 - 1;
  });
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => Number((value / magnitude).toFixed(6)));
}

function extractEmbeddedImageText(bytes: Buffer): string[] {
  if (isPng(bytes)) {
    return extractPngText(bytes);
  }
  return [];
}

function extractPngText(bytes: Buffer): string[] {
  const chunks: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      break;
    }
    if (type === "tEXt") {
      const text = bytes.toString("utf8", dataStart, dataEnd);
      const separator = text.indexOf("\0");
      chunks.push(separator >= 0 ? text.slice(separator + 1) : text);
    }
    offset = dataEnd + 4;
  }
  return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
}

function readImageDimensions(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length >= 24 && isPng(bytes)) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20)
    };
  }
  if (bytes.length >= 10 && (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a"))) {
    return {
      width: bytes.readUInt16LE(6),
      height: bytes.readUInt16LE(8)
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return readJpegDimensions(bytes);
  }
  return { width: null, height: null };
}

function readJpegDimensions(bytes: Buffer): { width: number | null; height: number | null } {
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      break;
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) {
      break;
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + segmentLength;
  }
  return { width: null, height: null };
}

function labelsFromFilename(filename: string): string[] {
  return filename
    .replace(/\.[^.]+$/, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
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

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function matchesAscii(bytes: Buffer, offset: number, expected: string): boolean {
  if (bytes.length < offset + expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) {
      return false;
    }
  }
  return true;
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
