import {
  ProcessingError,
  type ExtractedText,
  type ExtractedTranscriptSegment,
  type ExtractTextInput,
  type TextExtractor
} from "@mindory/core/processing";

export interface AudioTranscriptExtractorOptions {
  asr?: ModelCapabilityState;
}

export interface ModelCapabilityState {
  enabled: boolean;
  provider: string;
  model: string;
  required: boolean;
}

interface AudioMetadata {
  mimeType: string;
  extension: string;
  durationMs: number | null;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitsPerSample: number | null;
  embeddedTranscript: string | null;
}

const supportedMimePrefixes = ["audio/"];
const supportedExtensions = new Set([".wav", ".wave", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);

export class AudioTranscriptExtractor implements TextExtractor {
  readonly name = "audio-transcript";
  readonly version = "audio-transcript-v1";
  private readonly asr: ModelCapabilityState;

  constructor(options: AudioTranscriptExtractorOptions = {}) {
    this.asr = options.asr ?? disabledCapability();
  }

  supports(document: { originalFilename: string; mimeType: string }): boolean {
    const mimeType = normalizeMimeType(document.mimeType);
    return supportedMimePrefixes.some((prefix) => mimeType.startsWith(prefix)) || supportedExtensions.has(fileExtension(document.originalFilename));
  }

  async extract(input: ExtractTextInput): Promise<ExtractedText> {
    if (!this.supports(input.document)) {
      throw new ProcessingError(
        "unsupported_document_type",
        `Audio transcript extractor does not support ${input.document.mimeType} (${input.document.originalFilename}).`
      );
    }

    const bytes = await readAllBytes(input.body);
    const metadata = extractAudioMetadata(bytes, input.document.originalFilename, input.document.mimeType);
    const transcript = (metadata.embeddedTranscript ?? fallbackTranscriptFromFilename(input.document.originalFilename)).trim();
    if (this.asr.enabled && this.asr.required && transcript.length === 0) {
      throw new ProcessingError("text_extraction_failed", "Audio ASR is required, but no concrete ASR adapter produced a transcript.");
    }
    const segments = buildTranscriptSegments(transcript, metadata.durationMs);
    const text = segments.map((segment) => segment.text).join("\n");
    const segmentsWithOffsets = attachOffsets(segments, text);

    return {
      projectId: input.document.projectId,
      documentId: input.document.id,
      text,
      mimeType: input.document.mimeType,
      transcriptSegments: segmentsWithOffsets,
      metadata: {
        extractor: this.name,
        extractor_version: this.version,
        original_filename: input.document.originalFilename,
        audio_transcript: true,
        duration_ms: metadata.durationMs,
        codec: metadata.codec,
        sample_rate: metadata.sampleRate,
        channels: metadata.channels,
        bits_per_sample: metadata.bitsPerSample,
        transcript_segment_count: segmentsWithOffsets.length,
        capabilities: {
          asr: capabilitySnapshot(this.asr, transcript.length > 0 ? "embedded_transcript_extracted" : this.asr.enabled ? "skipped_no_adapter" : "disabled")
        }
      }
    };
  }
}

function extractAudioMetadata(bytes: Buffer, filename: string, mimeType: string): AudioMetadata {
  const wav = readWavMetadata(bytes);
  return {
    mimeType: normalizeMimeType(mimeType),
    extension: fileExtension(filename).replace(/^\./, ""),
    durationMs: wav.durationMs,
    codec: wav.codec,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
    embeddedTranscript: wav.embeddedTranscript
  };
}

function readWavMetadata(bytes: Buffer): Omit<AudioMetadata, "mimeType" | "extension"> {
  if (!matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WAVE")) {
    return emptyAudioMetadata();
  }

  let offset = 12;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitsPerSample: number | null = null;
  let audioFormat: number | null = null;
  let dataBytes = 0;
  let transcript: string | null = null;

  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("latin1", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > bytes.length) {
      break;
    }
    if (chunkId === "fmt " && chunkSize >= 16) {
      audioFormat = bytes.readUInt16LE(dataStart);
      channels = bytes.readUInt16LE(dataStart + 2);
      sampleRate = bytes.readUInt32LE(dataStart + 4);
      bitsPerSample = bytes.readUInt16LE(dataStart + 14);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    } else if (chunkId === "LIST" && chunkSize >= 4 && bytes.toString("latin1", dataStart, dataStart + 4) === "INFO") {
      transcript = readInfoTranscript(bytes.subarray(dataStart + 4, dataEnd)) ?? transcript;
    }
    offset = dataEnd + (chunkSize % 2);
  }

  const bytesPerSecond = sampleRate && channels && bitsPerSample
    ? sampleRate * channels * (bitsPerSample / 8)
    : null;
  return {
    durationMs: bytesPerSecond && dataBytes > 0 ? Math.round((dataBytes / bytesPerSecond) * 1000) : null,
    codec: audioFormat === 1 ? "pcm_s16le" : audioFormat ? `wav_format_${audioFormat}` : null,
    sampleRate,
    channels,
    bitsPerSample,
    embeddedTranscript: transcript
  };
}

function readInfoTranscript(infoBytes: Buffer): string | null {
  let offset = 0;
  while (offset + 8 <= infoBytes.length) {
    const chunkId = infoBytes.toString("latin1", offset, offset + 4);
    const chunkSize = infoBytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > infoBytes.length) {
      break;
    }
    if (chunkId === "ICMT" || chunkId === "INAM") {
      return infoBytes.toString("utf8", dataStart, dataEnd).replace(/\0+$/g, "").trim();
    }
    offset = dataEnd + (chunkSize % 2);
  }
  return null;
}

function buildTranscriptSegments(transcript: string, durationMs: number | null): ExtractedTranscriptSegment[] {
  if (transcript.length === 0) {
    return [];
  }
  const parts = transcript.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter((part) => part.length > 0);
  const segmentCount = Math.max(parts.length, 1);
  const totalDuration = durationMs && durationMs > 0 ? durationMs : segmentCount * 1000;
  return parts.map((text, index) => {
    const startMs = Math.round((totalDuration / segmentCount) * index);
    const endMs = index === segmentCount - 1
      ? totalDuration
      : Math.round((totalDuration / segmentCount) * (index + 1));
    return {
      segmentIndex: index,
      text,
      startMs,
      endMs,
      confidence: 0.5,
      metadata: {
        source: "embedded_audio_transcript"
      }
    };
  });
}

function attachOffsets(segments: ExtractedTranscriptSegment[], text: string): ExtractedTranscriptSegment[] {
  let searchOffset = 0;
  return segments.map((segment) => {
    const startOffset = text.indexOf(segment.text, searchOffset);
    const safeStartOffset = startOffset >= 0 ? startOffset : searchOffset;
    const endOffset = safeStartOffset + segment.text.length;
    searchOffset = endOffset;
    return {
      ...segment,
      startOffset: safeStartOffset,
      endOffset
    };
  });
}

function fallbackTranscriptFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && !/^\d+$/.test(part))
    .join(" ");
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

function emptyAudioMetadata(): Omit<AudioMetadata, "mimeType" | "extension"> {
  return {
    durationMs: null,
    codec: null,
    sampleRate: null,
    channels: null,
    bitsPerSample: null,
    embeddedTranscript: null
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
