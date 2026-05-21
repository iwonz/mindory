import type { Readable } from "node:stream";
import {
  ProcessingError,
  type ExtractedText,
  type ExtractTextInput,
  type TextExtractor
} from "@mindory/core/processing";

const supportedMimeTypes = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/markdown"
]);

const supportedExtensions = new Set([
  ".txt",
  ".md",
  ".markdown"
]);

export class BuiltinTextExtractor implements TextExtractor {
  readonly name = "builtin-text";
  readonly version = "builtin-text-v1";

  supports(document: { originalFilename: string; mimeType: string }): boolean {
    return supportedMimeTypes.has(normalizeMimeType(document.mimeType)) || supportedExtensions.has(fileExtension(document.originalFilename));
  }

  async extract(input: ExtractTextInput): Promise<ExtractedText> {
    if (!this.supports(input.document)) {
      throw new ProcessingError(
        "unsupported_document_type",
        `Builtin text extractor does not support ${input.document.mimeType} (${input.document.originalFilename}).`
      );
    }

    try {
      const rawText = await readUtf8(input.body);
      const markdown = isMarkdown(input.document);
      const text = markdown ? normalizeMarkdown(rawText) : normalizePlainText(rawText);

      return {
        projectId: input.document.projectId,
        documentId: input.document.id,
        text,
        mimeType: input.document.mimeType,
        metadata: {
          extractor: this.name,
          extractor_version: this.version,
          original_filename: input.document.originalFilename,
          markdown
        }
      };
    } catch (error) {
      if (error instanceof ProcessingError) {
        throw error;
      }
      throw new ProcessingError("text_extraction_failed", "Failed to extract text document content.", error);
    }
  }
}

export function normalizePlainText(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

export function normalizeMarkdown(markdown: string): string {
  return normalizePlainText(markdown)
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~#>|]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isMarkdown(document: { originalFilename: string; mimeType: string }): boolean {
  const mimeType = normalizeMimeType(document.mimeType);
  return mimeType.includes("markdown") || [".md", ".markdown"].includes(fileExtension(document.originalFilename));
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function fileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : "";
}

async function readUtf8(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
