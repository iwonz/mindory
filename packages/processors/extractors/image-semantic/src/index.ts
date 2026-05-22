import { createHash } from "node:crypto";
import {
  ProcessingError,
  type ExtractedArtifactVector,
  type ExtractedFaceObservation,
  type ExtractedSemanticArtifact,
  type ExtractedText,
  type ExtractTextInput,
  type TextExtractor
} from "@mindory/core/processing";
import type { LlmFaceObservationOutput, LlmImageEmbeddingProvider, LlmObjectObservationOutput, LlmFaceProvider, LlmOcrProvider, LlmRoleDescriptor, LlmVisionProvider } from "@mindory/llm";

export interface ImageSemanticExtractorOptions {
  faceDetection?: ModelCapabilityState;
  faceRecognition?: ModelCapabilityState;
  imageCaptioning?: ModelCapabilityState;
  imageEmbedding?: ModelCapabilityState;
  ocr?: ModelCapabilityState;
  ocrProvider?: LlmOcrProvider;
  ocrRole?: LlmRoleDescriptor;
  imageEmbeddingProvider?: LlmImageEmbeddingProvider;
  imageEmbeddingRole?: LlmRoleDescriptor;
  visionProvider?: LlmVisionProvider;
  visionRole?: LlmRoleDescriptor;
  faceProvider?: LlmFaceProvider;
  faceDetectionRole?: LlmRoleDescriptor;
  faceRecognitionRole?: LlmRoleDescriptor;
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
  private readonly ocrProvider: LlmOcrProvider | undefined;
  private readonly ocrRole: LlmRoleDescriptor | undefined;
  private readonly imageEmbeddingProvider: LlmImageEmbeddingProvider | undefined;
  private readonly imageEmbeddingRole: LlmRoleDescriptor | undefined;
  private readonly visionProvider: LlmVisionProvider | undefined;
  private readonly visionRole: LlmRoleDescriptor | undefined;
  private readonly faceProvider: LlmFaceProvider | undefined;
  private readonly faceDetectionRole: LlmRoleDescriptor | undefined;
  private readonly faceRecognitionRole: LlmRoleDescriptor | undefined;

  constructor(options: ImageSemanticExtractorOptions = {}) {
    this.faceDetection = options.faceDetection ?? disabledCapability();
    this.faceRecognition = options.faceRecognition ?? disabledCapability();
    this.imageCaptioning = options.imageCaptioning ?? disabledCapability();
    this.imageEmbedding = options.imageEmbedding ?? disabledCapability();
    this.ocr = options.ocr ?? disabledCapability();
    this.ocrProvider = options.ocrProvider;
    this.ocrRole = options.ocrRole;
    this.imageEmbeddingProvider = options.imageEmbeddingProvider;
    this.imageEmbeddingRole = options.imageEmbeddingRole;
    this.visionProvider = options.visionProvider;
    this.visionRole = options.visionRole;
    this.faceProvider = options.faceProvider;
    this.faceDetectionRole = options.faceDetectionRole;
    this.faceRecognitionRole = options.faceRecognitionRole;
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
    const modelResult = await this.runModelOperations({ bytes, input, metadata });
    const ocrText = modelResult.ocrText;

    const objectLabels = modelResult.objects.map((object) => object.label);
    const labels = buildImageLabels(metadata, modelResult.labels.concat(objectLabels));
    const faceResult = await this.runFaceOperations({ bytes, input, labels, ocrText });
    const faceCount = faceResult.observations.length;
    const caption = modelResult.caption ?? buildCaption(metadata, labels);
    const analysis = buildAnalysis(metadata, labels, ocrText, modelResult.objects);
    const semanticText = [
      caption,
      analysis,
      modelResult.objects.length > 0 ? `Detected image objects: ${modelResult.objects.map((object) => object.label).join(", ")}.` : "",
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
        objects: modelResult.objects,
        metadata,
        imageCaptioning: this.imageCaptioning,
        imageEmbedding: this.imageEmbedding,
        ocr: this.ocr,
        imageCaptioningStatus: modelResult.visionStatus,
        objectDetectionStatus: modelResult.objectDetectionStatus,
        imageEmbeddingStatus: modelResult.imageEmbeddingStatus,
        imageVector: modelResult.imageVector,
        ocrStatus: modelResult.ocrStatus
      }),
      faceObservations: faceResult.observations,
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
          face_detection: capabilitySnapshot(this.faceDetection, faceResult.detectionStatus),
          face_recognition: capabilitySnapshot(this.faceRecognition, faceResult.recognitionStatus),
          image_captioning: capabilitySnapshot(this.imageCaptioning, modelResult.visionStatus),
          image_embedding: capabilitySnapshot(this.imageEmbedding, modelResult.imageEmbeddingStatus),
          object_detection: capabilitySnapshot(this.imageCaptioning, modelResult.objectDetectionStatus),
          ocr: capabilitySnapshot(this.ocr, modelResult.ocrStatus)
        }
      }
    };
  }

  private async runModelOperations(input: {
    bytes: Buffer;
    input: ExtractTextInput;
    metadata: ImageMetadata;
  }): Promise<{
    ocrText: string;
    ocrStatus: string;
    caption: string | undefined;
    labels: string[];
    visionStatus: string;
    objects: LlmObjectObservationOutput[];
    objectDetectionStatus: string;
    imageVector: ExtractedArtifactVector | undefined;
    imageEmbeddingStatus: string;
  }> {
    const embeddedText = input.metadata.embeddedText.join("\n").trim();
    let ocrText = embeddedText;
    let ocrStatus = embeddedText.length > 0 ? "embedded_text_extracted" : this.ocr.enabled ? "skipped_no_adapter" : "disabled";
    if (this.ocr.enabled && this.ocrProvider !== undefined && this.ocrRole !== undefined) {
      const result = await this.ocrProvider.recognizeText({
        bytes: input.bytes,
        mimeType: input.input.document.mimeType
      }, {
        role: this.ocrRole,
        refs: {
          projectId: input.input.document.projectId,
          documentId: input.input.document.id
        }
      });
      if (result.status === "success" && result.value !== undefined && result.value.text.trim().length > 0) {
        ocrText = result.value.text.trim();
        ocrStatus = "provider_ocr";
      } else if (this.ocr.required) {
        throw new ProcessingError("text_extraction_failed", result.audit.errorMessage ?? "Image OCR provider returned no text.");
      } else if (result.status === "failed") {
        ocrStatus = "provider_failed";
      }
    } else if (this.ocr.enabled && this.ocr.required && ocrText.length === 0) {
      throw new ProcessingError("text_extraction_failed", "Image OCR is required, but no concrete OCR adapter produced text.");
    }

    let caption: string | undefined;
    let labels: string[] = [];
    let visionStatus = this.imageCaptioning.enabled ? "fallback_metadata_caption" : "disabled";
    let objects: LlmObjectObservationOutput[] = [];
    let objectDetectionStatus = this.imageCaptioning.enabled ? "no_objects_detected" : "disabled";
    if (this.imageCaptioning.enabled && this.visionProvider !== undefined && this.visionRole !== undefined) {
      const result = await this.visionProvider.captionImage({
        bytes: input.bytes,
        mimeType: input.input.document.mimeType
      }, {
        role: this.visionRole,
        refs: {
          projectId: input.input.document.projectId,
          documentId: input.input.document.id
        }
      });
      if (result.status === "success" && result.value !== undefined && result.value.caption.trim().length > 0) {
        caption = result.value.caption.trim();
        labels = result.value.labels ?? [];
        visionStatus = "provider_caption";
      } else if (this.imageCaptioning.required) {
        throw new ProcessingError("text_extraction_failed", result.audit.errorMessage ?? "Image captioning provider returned no caption.");
      } else if (result.status === "failed") {
        visionStatus = "provider_failed";
      }

      const detectedObjects = await this.visionProvider.detectObjects({
        bytes: input.bytes,
        mimeType: input.input.document.mimeType
      }, {
        role: this.visionRole,
        refs: {
          projectId: input.input.document.projectId,
          documentId: input.input.document.id
        }
      });
      if (detectedObjects.status === "success" && detectedObjects.value !== undefined) {
        objects = detectedObjects.value.objects;
        labels = labels.concat(detectedObjects.value.labels ?? objects.map((object) => object.label));
        objectDetectionStatus = objects.length > 0 ? "provider_detected" : "provider_no_objects";
      } else if (this.imageCaptioning.required) {
        throw new ProcessingError("text_extraction_failed", detectedObjects.audit.errorMessage ?? "Image object detection provider failed.");
      } else if (detectedObjects.status === "failed") {
        objectDetectionStatus = "provider_failed";
      }
    } else if (this.imageCaptioning.enabled && this.imageCaptioning.required) {
      throw new ProcessingError("text_extraction_failed", "Image captioning is required, but no concrete vision adapter produced a caption.");
    }

    let imageVector: ExtractedArtifactVector | undefined;
    let imageEmbeddingStatus = this.imageEmbedding.enabled ? "skipped_no_adapter" : "disabled";
    if (this.imageEmbedding.enabled && this.imageEmbeddingProvider !== undefined && this.imageEmbeddingRole !== undefined) {
      const result = await this.imageEmbeddingProvider.embedImages({
        images: [{
          bytes: input.bytes,
          mimeType: input.input.document.mimeType
        }]
      }, {
        role: this.imageEmbeddingRole,
        refs: {
          projectId: input.input.document.projectId,
          documentId: input.input.document.id
        }
      });
      const embedding = result.value?.[0];
      if (result.status === "success" && embedding !== undefined && embedding.length > 0) {
        imageVector = {
          embedding,
          model: this.imageEmbedding.model,
          dimensions: embedding.length,
          provider: this.imageEmbedding.provider,
          metadata: {
            role: this.imageEmbeddingRole.role
          }
        };
        imageEmbeddingStatus = "provider_embedded";
      } else if (this.imageEmbedding.required) {
        throw new ProcessingError("embedding_provider_error", result.audit.errorMessage ?? "Image embedding provider returned no vector.");
      } else if (result.status === "failed") {
        imageEmbeddingStatus = "provider_failed";
      }
    } else if (this.imageEmbedding.enabled && this.imageEmbedding.required) {
      throw new ProcessingError("embedding_provider_error", "Image embedding is required, but no concrete image embedding adapter is configured.");
    }

    return {
      ocrText,
      ocrStatus,
      caption,
      labels,
      visionStatus,
      objects,
      objectDetectionStatus,
      imageVector,
      imageEmbeddingStatus
    };
  }

  private async runFaceOperations(input: {
    bytes: Buffer;
    input: ExtractTextInput;
    labels: string[];
    ocrText: string;
  }): Promise<{
    observations: ExtractedFaceObservation[];
    detectionStatus: string;
    recognitionStatus: string;
  }> {
    if (this.faceDetection.enabled && this.faceProvider !== undefined && this.faceDetectionRole !== undefined) {
      const detected = await this.faceProvider.detectFaces({
        bytes: input.bytes,
        mimeType: input.input.document.mimeType
      }, {
        role: this.faceDetectionRole,
        refs: {
          projectId: input.input.document.projectId,
          documentId: input.input.document.id
        }
      });
      if (detected.status === "success" && detected.value !== undefined && detected.value.faces.length > 0) {
        const recognizedFaces = await this.recognizeFaces(input, detected.value.faces);
        return {
          observations: buildProviderFaceObservations({
            faces: recognizedFaces.faces.length > 0 ? recognizedFaces.faces : detected.value.faces,
            faceDetection: this.faceDetection,
            faceRecognition: this.faceRecognition,
            recognitionStatus: recognizedFaces.status
          }),
          detectionStatus: "provider_detected",
          recognitionStatus: recognizedFaces.status
        };
      }
      if (this.faceDetection.required) {
        throw new ProcessingError("text_extraction_failed", detected.audit.errorMessage ?? "Face detection provider returned no faces.");
      }
      if (detected.status === "failed") {
        return {
          observations: fallbackFaceObservations(input.labels, input.ocrText, this.faceDetection, this.faceRecognition),
          detectionStatus: "provider_failed",
          recognitionStatus: this.faceRecognition.enabled ? "skipped_detection_failed" : "disabled"
        };
      }
    } else if (this.faceDetection.enabled && this.faceDetection.required) {
      throw new ProcessingError("text_extraction_failed", "Face detection is required, but no concrete face adapter is configured.");
    }

    const observations = fallbackFaceObservations(input.labels, input.ocrText, this.faceDetection, this.faceRecognition);
    const detectionStatus = observations.length > 0
      ? "fallback_people_count_detected"
      : this.faceDetection.enabled ? "no_people_count_detected" : "disabled";
    const recognitionStatus = observations.length > 0
      ? "fallback_deterministic_embeddings"
      : this.faceRecognition.enabled ? "no_faces_to_embed" : "disabled";
    return {
      observations,
      detectionStatus,
      recognitionStatus
    };
  }

  private async recognizeFaces(input: {
    bytes: Buffer;
    input: ExtractTextInput;
  }, detectedFaces: LlmFaceObservationOutput[]): Promise<{
    faces: LlmFaceObservationOutput[];
    status: string;
  }> {
    if (!this.faceRecognition.enabled) {
      return {
        faces: detectedFaces,
        status: "disabled"
      };
    }
    if (this.faceProvider === undefined || this.faceRecognitionRole === undefined) {
      if (this.faceRecognition.required) {
        throw new ProcessingError("text_extraction_failed", "Face recognition is required, but no concrete face adapter is configured.");
      }
      return {
        faces: detectedFaces,
        status: detectedFaces.some((face) => Array.isArray(face.embedding) && face.embedding.length > 0) ? "provider_embeddings_from_detection" : "skipped_no_adapter"
      };
    }
    const recognized = await this.faceProvider.recognizeFaces({
      bytes: input.bytes,
      mimeType: input.input.document.mimeType
    }, {
      role: this.faceRecognitionRole,
      refs: {
        projectId: input.input.document.projectId,
        documentId: input.input.document.id
      }
    });
    if (recognized.status === "success" && recognized.value !== undefined && recognized.value.faces.length > 0) {
      return {
        faces: mergeRecognizedFaces(detectedFaces, recognized.value.faces),
        status: "provider_recognized"
      };
    }
    if (this.faceRecognition.required) {
      throw new ProcessingError("text_extraction_failed", recognized.audit.errorMessage ?? "Face recognition provider returned no embeddings.");
    }
    return {
      faces: detectedFaces,
      status: recognized.status === "failed" ? "provider_failed" : "provider_no_embeddings"
    };
  }
}

function buildSemanticArtifacts(input: {
  caption: string;
  analysis: string;
  ocrText: string;
  labels: string[];
  objects: LlmObjectObservationOutput[];
  metadata: ImageMetadata;
  imageCaptioning: ModelCapabilityState;
  imageEmbedding: ModelCapabilityState;
  ocr: ModelCapabilityState;
  imageCaptioningStatus: string;
  objectDetectionStatus: string;
  imageEmbeddingStatus: string;
  imageVector: ExtractedArtifactVector | undefined;
  ocrStatus: string;
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
        capability: capabilitySnapshot(input.imageCaptioning, input.imageCaptioningStatus)
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
        capability: capabilitySnapshot(input.imageCaptioning, input.imageCaptioningStatus)
      }
    },
    {
      artifactType: "image_embedding",
      content: input.imageVector
        ? `Image visual embedding generated with ${input.imageVector.dimensions} dimensions for labels ${input.labels.join(", ")}.`
        : `Image embedding status: ${input.imageEmbeddingStatus}.`,
      spanType: "image_embedding",
      artifactIndex: 2,
      modelProvider: input.imageEmbedding.provider,
      modelName: input.imageEmbedding.model,
      ...(input.imageVector === undefined ? {} : { vector: input.imageVector }),
      metadata: {
        labels: input.labels,
        vector_dimensions: input.imageVector?.dimensions ?? null,
        capability: capabilitySnapshot(input.imageEmbedding, input.imageEmbeddingStatus)
      }
    }
  ];

  for (const [objectIndex, object] of input.objects.entries()) {
    artifacts.push({
      artifactType: "object_detection",
      content: objectDetectionContent(object),
      spanType: "object_detection",
      artifactIndex: objectIndex,
      modelProvider: input.imageCaptioning.provider,
      modelName: input.imageCaptioning.model,
      confidence: object.confidence ?? null,
      sourcePosition: object.boundingBox ? { bounding_box: object.boundingBox } : {},
      metadata: {
        label: object.label,
        labels: [object.label],
        confidence: object.confidence ?? null,
        bounding_box: object.boundingBox ?? null,
        capability: capabilitySnapshot(input.imageCaptioning, input.objectDetectionStatus)
      }
    });
  }

  if (input.ocrText.length > 0) {
    artifacts.push({
      artifactType: "ocr_text",
      content: input.ocrText,
      spanType: "ocr_text",
      artifactIndex: 3 + input.objects.length,
      modelProvider: input.ocr.provider,
      modelName: input.ocr.model,
      metadata: {
        source: input.ocrStatus === "provider_ocr" ? "llm_ocr_provider" : "embedded_image_text",
        capability: capabilitySnapshot(input.ocr, input.ocrStatus)
      }
    });
  }

  return artifacts;
}

function objectDetectionContent(object: LlmObjectObservationOutput): string {
  const confidence = typeof object.confidence === "number" ? ` with confidence ${object.confidence.toFixed(3)}` : "";
  return `Detected object: ${object.label}${confidence}.`;
}

function fallbackFaceObservations(
  labels: string[],
  ocrText: string,
  faceDetection: ModelCapabilityState,
  faceRecognition: ModelCapabilityState
): ExtractedFaceObservation[] {
  const count = faceDetection.enabled ? readPeopleCount(labels, ocrText) : 0;
  return buildFallbackFaceObservations({
    count,
    faceDetection,
    faceRecognition
  });
}

function buildProviderFaceObservations(input: {
  faces: LlmFaceObservationOutput[];
  faceDetection: ModelCapabilityState;
  faceRecognition: ModelCapabilityState;
  recognitionStatus: string;
}): ExtractedFaceObservation[] {
  return input.faces.map((face, index) => ({
    observationIndex: index,
    content: `Face observation ${index + 1} detected by provider.`,
    boundingBox: face.boundingBox,
    embedding: Array.isArray(face.embedding) ? face.embedding : null,
    model: input.faceRecognition.model || input.faceDetection.model || null,
    confidence: face.confidence ?? null,
    metadata: {
      source: "llm_face_provider",
      label: face.label ?? null,
      detection_capability: capabilitySnapshot(input.faceDetection, "provider_detected"),
      recognition_capability: capabilitySnapshot(input.faceRecognition, input.recognitionStatus)
    }
  }));
}

function mergeRecognizedFaces(detected: LlmFaceObservationOutput[], recognized: LlmFaceObservationOutput[]): LlmFaceObservationOutput[] {
  return detected.map((face, index) => ({
    ...face,
    ...(recognized[index] ?? {})
  }));
}

function buildFallbackFaceObservations(input: {
  count: number;
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

function buildImageLabels(metadata: ImageMetadata, providerLabels: string[] = []): string[] {
  const labels = new Set(["image", metadata.extension, metadata.orientation].filter((label) => label.length > 0 && label !== "unknown"));
  for (const label of metadata.filenameLabels) {
    labels.add(label);
  }
  for (const label of providerLabels) {
    const normalized = label.trim().toLowerCase();
    if (normalized.length > 0) {
      labels.add(normalized);
    }
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

function buildAnalysis(metadata: ImageMetadata, labels: string[], ocrText: string, objects: LlmObjectObservationOutput[] = []): string {
  const peoplePhrase = readPeoplePhrase(labels);
  return [
    `Image visual labels: ${labels.join(", ")}.`,
    objects.length > 0 ? `Detected objects: ${objects.map((object) => object.label).join(", ")}.` : "",
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
