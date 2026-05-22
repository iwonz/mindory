import { inflateSync } from "node:zlib";
import {
  ProcessingError,
  type ExtractedText,
  type ExtractedTextPage,
  type ExtractTextInput,
  type TextExtractor
} from "@mindory/core/processing";
import type { LlmOcrOutput, LlmOcrProvider, LlmRoleDescriptor } from "@mindory/llm";

export interface DoclingPdfExtractorOptions {
  service?: {
    enabled: boolean;
    url: string;
    timeoutMs: number;
    fetch?: FetchLike;
  };
  ocr?: {
    enabled: boolean;
    provider: string;
    model: string;
    required: boolean;
  };
  ocrProvider?: LlmOcrProvider;
  ocrRole?: LlmRoleDescriptor;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface DoclingServicePage {
  page_number?: number;
  pageNumber?: number;
  text?: string;
  width?: number | null;
  height?: number | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

interface DoclingServiceExtractionResponse {
  status?: string;
  extractor?: string;
  version?: string;
  text?: string;
  mime_type?: string;
  pages?: DoclingServicePage[];
  metadata?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
  };
}

interface PdfObject {
  id: number;
  body: string;
  rawBody: Buffer;
}

interface PageText {
  pageNumber: number;
  text: string;
  width: number | null;
  height: number | null;
  confidence?: number | null;
  metadata: Record<string, unknown>;
}

const supportedMimeTypes = new Set(["application/pdf"]);
const supportedExtensions = new Set([".pdf"]);

export class DoclingPdfExtractor implements TextExtractor {
  readonly name = "docling-pdf";
  readonly version = "docling-pdf-v2";
  private readonly service: Required<NonNullable<DoclingPdfExtractorOptions["service"]>>;
  private readonly ocr: Required<DoclingPdfExtractorOptions>["ocr"];
  private readonly ocrProvider: LlmOcrProvider | undefined;
  private readonly ocrRole: LlmRoleDescriptor | undefined;

  constructor(options: DoclingPdfExtractorOptions = {}) {
    this.service = {
      enabled: options.service?.enabled ?? false,
      url: options.service?.url ?? "http://docling:8081",
      timeoutMs: options.service?.timeoutMs ?? 120_000,
      fetch: options.service?.fetch ?? fetch
    };
    this.ocr = options.ocr ?? {
      enabled: false,
      provider: "disabled",
      model: "",
      required: false
    };
    this.ocrProvider = options.ocrProvider;
    this.ocrRole = options.ocrRole;
  }

  supports(document: { originalFilename: string; mimeType: string }): boolean {
    return supportedMimeTypes.has(normalizeMimeType(document.mimeType)) || supportedExtensions.has(fileExtension(document.originalFilename));
  }

  async extract(input: ExtractTextInput): Promise<ExtractedText> {
    if (!this.supports(input.document)) {
      throw new ProcessingError(
        "unsupported_document_type",
        `Docling PDF extractor does not support ${input.document.mimeType} (${input.document.originalFilename}).`
      );
    }

    try {
      const bytes = await readAllBytes(input.body);
      if (this.service.enabled) {
        return await this.extractWithService(bytes, input);
      }
      const nativePages = extractPdfPageText(bytes);
      const ocrResult = await this.applyOcr({
        bytes,
        nativePages,
        input
      });

      const extractedPages = withTextOffsets(ocrResult.pages);
      return {
        projectId: input.document.projectId,
        documentId: input.document.id,
        text: extractedPages.map((page) => page.text).join("\n\n").trim(),
        mimeType: input.document.mimeType,
        pages: extractedPages,
        metadata: {
          extractor: this.name,
          extractor_version: this.version,
          original_filename: input.document.originalFilename,
          page_count: estimatePdfPageCount(bytes, extractedPages.length),
          native_text_pages: extractedPages.filter((page) => page.metadata?.native_text === true).length,
          ocr_text_pages: extractedPages.filter((page) => page.ocr === true && page.text.length > 0).length,
          pdf_page_model: "document_artifacts.pdf_page",
          ocr: {
            enabled: this.ocr.enabled,
            provider: this.ocr.provider,
            model: this.ocr.model,
            required: this.ocr.required,
            status: ocrResult.status,
            pages_attempted: ocrResult.pagesAttempted,
            pages_extracted: ocrResult.pagesExtracted,
            ...(ocrResult.error ? { error: ocrResult.error } : {})
          }
        }
      };
    } catch (error) {
      if (error instanceof ProcessingError) {
        throw error;
      }
      throw new ProcessingError("text_extraction_failed", "Failed to extract PDF document content.", error);
    }
  }

  private async extractWithService(bytes: Buffer, input: ExtractTextInput): Promise<ExtractedText> {
    if (this.service.url.trim() === "") {
      throw new ProcessingError("text_extraction_failed", "Docling service is enabled, but the service URL is empty.");
    }
    if (this.service.timeoutMs <= 0) {
      throw new ProcessingError("text_extraction_failed", "Docling service timeout must be greater than zero.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.service.timeoutMs);
    let response: Response;
    try {
      response = await this.service.fetch(serviceEndpoint(this.service.url, "/v1/extract"), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          document: {
            project_id: input.document.projectId,
            document_id: input.document.id,
            original_filename: input.document.originalFilename,
            mime_type: input.document.mimeType,
            size_bytes: input.document.sizeBytes
          },
          data_base64: bytes.toString("base64")
        }),
        signal: controller.signal
      });
    } catch (error) {
      throw new ProcessingError("text_extraction_failed", "Docling service request failed.", error);
    } finally {
      clearTimeout(timeout);
    }

    const payload = await readServiceJson(response);
    if (!response.ok) {
      throw new ProcessingError(
        "text_extraction_failed",
        payload.error?.message ?? `Docling service returned HTTP ${response.status}.`
      );
    }
    if (payload.status !== undefined && payload.status !== "succeeded") {
      throw new ProcessingError(
        "text_extraction_failed",
        payload.error?.message ?? `Docling service extraction ended with status ${payload.status}.`
      );
    }

    const servicePages = pagesFromServiceResponse(payload);
    const extractedPages = withTextOffsets(servicePages);
    const text = payload.text ?? extractedPages.map((page) => page.text).join("\n\n").trim();
    return {
      projectId: input.document.projectId,
      documentId: input.document.id,
      text,
      mimeType: payload.mime_type ?? input.document.mimeType,
      pages: extractedPages,
      metadata: {
        ...(payload.metadata ?? {}),
        extractor: this.name,
        extractor_version: this.version,
        original_filename: input.document.originalFilename,
        page_count: extractedPages.length,
        docling_service: {
          enabled: true,
          url: this.service.url,
          status: "succeeded",
          extractor: payload.extractor ?? this.name,
          version: payload.version ?? this.version
        }
      }
    };
  }

  private async applyOcr(input: {
    bytes: Buffer;
    nativePages: PageText[];
    input: ExtractTextInput;
  }): Promise<{
    pages: PageText[];
    status: string;
    pagesAttempted: number;
    pagesExtracted: number;
    error?: string;
  }> {
    const pagesNeedingOcr = input.nativePages.filter((page) => page.text.trim().length === 0);
    if (!this.ocr.enabled) {
      return {
        pages: input.nativePages,
        status: "disabled",
        pagesAttempted: 0,
        pagesExtracted: 0
      };
    }
    if (pagesNeedingOcr.length === 0 && input.nativePages.length > 0) {
      return {
        pages: input.nativePages,
        status: "skipped_native_text_available",
        pagesAttempted: 0,
        pagesExtracted: 0
      };
    }
    if (this.ocrProvider === undefined || this.ocrRole === undefined) {
      if (this.ocr.required) {
        throw new ProcessingError(
          "text_extraction_failed",
          "PDF OCR is required, but no concrete OCR adapter is installed for rasterized PDF pages."
        );
      }
      return {
        pages: input.nativePages,
        status: "skipped_no_adapter",
        pagesAttempted: pagesNeedingOcr.length || estimatePdfPageCount(input.bytes, input.nativePages.length),
        pagesExtracted: 0
      };
    }

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
    if (result.status !== "success" || result.value === undefined) {
      const error = result.audit.errorMessage ?? "PDF OCR provider failed.";
      if (this.ocr.required) {
        throw new ProcessingError("text_extraction_failed", error);
      }
      return {
        pages: input.nativePages,
        status: "failed",
        pagesAttempted: pagesNeedingOcr.length || estimatePdfPageCount(input.bytes, input.nativePages.length),
        pagesExtracted: 0,
        error
      };
    }

    const ocrPages = ocrPagesFromOutput(result.value);
    const mergedPages = mergeOcrPages(input.nativePages, ocrPages, {
      provider: this.ocr.provider,
      model: this.ocr.model
    });
    const pagesExtracted = mergedPages.filter((page) => page.metadata.ocr === true && page.text.trim().length > 0).length;
    if (pagesExtracted === 0 && this.ocr.required) {
      throw new ProcessingError("text_extraction_failed", "PDF OCR is required, but the OCR provider returned no text.");
    }
    return {
      pages: mergedPages,
      status: pagesExtracted > 0 ? "succeeded" : "no_text",
      pagesAttempted: pagesNeedingOcr.length || estimatePdfPageCount(input.bytes, input.nativePages.length),
      pagesExtracted
    };
  }
}

export function extractPdfPageText(bytes: Buffer): PageText[] {
  const objects = parsePdfObjects(bytes);
  const objectMap = new Map(objects.map((object) => [object.id, object]));
  const pages = objects
    .filter((object) => /\/Type\s*\/Page\b/.test(object.body))
    .map((object, index) => {
      const mediaBox = readMediaBox(object.body);
      return {
        pageNumber: index + 1,
        contentRefs: readContentRefs(object.body),
        width: mediaBox.width,
        height: mediaBox.height
      };
    });

  if (pages.length === 0) {
    return extractFallbackStreamText(objects);
  }

  return pages.map((page) => {
    const streamTexts = page.contentRefs
      .map((contentRef) => objectMap.get(contentRef))
      .filter((object): object is PdfObject => object !== undefined)
      .flatMap((object) => extractTextFromObjectStream(object));
    const text = normalizeExtractedPdfText(streamTexts.join("\n"));
    return {
      pageNumber: page.pageNumber,
      text,
      width: page.width,
      height: page.height,
      metadata: {
        content_refs: page.contentRefs,
        native_text: text.length > 0,
        ocr: false
      }
    };
  });
}

function parsePdfObjects(bytes: Buffer): PdfObject[] {
  const text = bytes.toString("latin1");
  const objects: PdfObject[] = [];
  const objectPattern = /(\d+)\s+\d+\s+obj\b/g;
  let match: RegExpExecArray | null;

  while ((match = objectPattern.exec(text)) !== null) {
    const id = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(id)) {
      continue;
    }
    const bodyStart = match.index + match[0].length;
    const endIndex = text.indexOf("endobj", bodyStart);
    if (endIndex < 0) {
      break;
    }
    const rawBody = bytes.subarray(bodyStart, endIndex);
    objects.push({
      id,
      body: rawBody.toString("latin1"),
      rawBody
    });
    objectPattern.lastIndex = endIndex + "endobj".length;
  }

  return objects;
}

function readContentRefs(pageBody: string): number[] {
  const arrayMatch = pageBody.match(/\/Contents\s*\[([^\]]+)]/);
  const source = arrayMatch?.[1] ?? pageBody;
  const refs = Array.from(source.matchAll(/(\d+)\s+\d+\s+R/g))
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((value) => Number.isFinite(value));
  if (refs.length > 0) {
    return refs;
  }

  const single = pageBody.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
  const ref = Number.parseInt(single?.[1] ?? "", 10);
  return Number.isFinite(ref) ? [ref] : [];
}

function readMediaBox(pageBody: string): { width: number | null; height: number | null } {
  const match = pageBody.match(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return { width: null, height: null };
  }
  const left = Number.parseFloat(match[1] ?? "");
  const bottom = Number.parseFloat(match[2] ?? "");
  const right = Number.parseFloat(match[3] ?? "");
  const top = Number.parseFloat(match[4] ?? "");
  if (![left, bottom, right, top].every(Number.isFinite)) {
    return { width: null, height: null };
  }
  return {
    width: Math.round(Math.abs(right - left)),
    height: Math.round(Math.abs(top - bottom))
  };
}

function extractTextFromObjectStream(object: PdfObject): string[] {
  const stream = readStreamBytes(object);
  if (!stream) {
    return [];
  }
  return extractTextOperators(stream.toString("latin1"));
}

function readStreamBytes(object: PdfObject): Buffer | null {
  const streamIndex = object.body.indexOf("stream");
  const endIndex = object.body.indexOf("endstream", streamIndex + "stream".length);
  if (streamIndex < 0 || endIndex < 0) {
    return null;
  }

  let dataStart = streamIndex + "stream".length;
  if (object.rawBody[dataStart] === 0x0d && object.rawBody[dataStart + 1] === 0x0a) {
    dataStart += 2;
  } else if (object.rawBody[dataStart] === 0x0a || object.rawBody[dataStart] === 0x0d) {
    dataStart += 1;
  }

  let dataEnd = endIndex;
  while (dataEnd > dataStart && [0x0a, 0x0d].includes(object.rawBody[dataEnd - 1] ?? -1)) {
    dataEnd -= 1;
  }

  const rawStream = object.rawBody.subarray(dataStart, dataEnd);
  if (/\/FlateDecode\b/.test(object.body)) {
    try {
      return inflateSync(rawStream);
    } catch {
      return rawStream;
    }
  }
  return rawStream;
}

function extractTextOperators(content: string): string[] {
  const texts: string[] = [];
  for (const match of content.matchAll(/\[((?:\\.|[^\]])*)]\s*TJ/g)) {
    texts.push(...extractPdfStrings(match[1] ?? ""));
  }
  for (const match of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g)) {
    texts.push(decodePdfLiteralString(match[1] ?? ""));
  }
  if (texts.length === 0) {
    texts.push(...extractPdfStrings(content));
  }
  return texts.filter((text) => text.trim().length > 0);
}

function extractPdfStrings(value: string): string[] {
  const literalStrings = Array.from(value.matchAll(/\(((?:\\.|[^\\)])*)\)/g))
    .map((match) => decodePdfLiteralString(match[1] ?? ""));
  const hexStrings = Array.from(value.matchAll(/<([0-9a-fA-F\s]+)>/g))
    .map((match) => decodePdfHexString(match[1] ?? ""));
  return [...literalStrings, ...hexStrings];
}

function decodePdfLiteralString(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      output += character;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) {
      continue;
    }
    if (next === "\n" || next === "\r") {
      index += next === "\r" && value[index + 2] === "\n" ? 2 : 1;
      continue;
    }
    if (/[0-7]/.test(next)) {
      const octal = value.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
      output += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    output += ({
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "(": "(",
      ")": ")",
      "\\": "\\"
    } as Record<string, string>)[next] ?? next;
    index += 1;
  }
  return output;
}

function decodePdfHexString(value: string): string {
  const normalized = value.replace(/\s+/g, "");
  const evenHex = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
  const bytes = Buffer.from(evenHex, "hex");
  return bytes.toString("utf8");
}

function extractFallbackStreamText(objects: PdfObject[]): PageText[] {
  const texts = objects.flatMap(extractTextFromObjectStream);
  const text = normalizeExtractedPdfText(texts.join("\n"));
  return text.length === 0
    ? []
    : [{
      pageNumber: 1,
      text,
      width: null,
      height: null,
      metadata: {
        native_text: true,
        ocr: false,
        fallback: "all_streams"
      }
    }];
}

function withTextOffsets(pages: PageText[]): ExtractedTextPage[] {
  let cursor = 0;
  return pages.map((page, index) => {
    const startOffset = cursor;
    const endOffset = startOffset + page.text.length;
    cursor = endOffset + (index === pages.length - 1 ? 0 : 2);
    return {
      pageNumber: page.pageNumber,
      text: page.text,
      startOffset,
      endOffset,
      width: page.width,
      height: page.height,
      ocr: page.metadata.ocr === true,
      confidence: page.confidence ?? null,
      metadata: page.metadata
    };
  });
}

function serviceEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  return url.toString();
}

async function readServiceJson(response: Response): Promise<DoclingServiceExtractionResponse> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ProcessingError("text_extraction_failed", "Docling service returned invalid JSON.", error);
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProcessingError("text_extraction_failed", "Docling service returned an invalid response object.");
  }
  return payload as DoclingServiceExtractionResponse;
}

function pagesFromServiceResponse(payload: DoclingServiceExtractionResponse): PageText[] {
  if (Array.isArray(payload.pages) && payload.pages.length > 0) {
    return payload.pages.map((page, index) => {
      const pageNumber = page.pageNumber ?? page.page_number ?? index + 1;
      return {
        pageNumber,
        text: normalizeExtractedPdfText(page.text ?? ""),
        width: typeof page.width === "number" ? page.width : null,
        height: typeof page.height === "number" ? page.height : null,
        confidence: typeof page.confidence === "number" ? page.confidence : null,
        metadata: {
          ...(page.metadata ?? {}),
          docling_service_page: true
        }
      };
    });
  }

  const text = normalizeExtractedPdfText(payload.text ?? "");
  return text.length === 0
    ? []
    : [{
      pageNumber: 1,
      text,
      width: null,
      height: null,
      confidence: null,
      metadata: {
        docling_service_page: true
      }
    }];
}

function ocrPagesFromOutput(output: LlmOcrOutput): PageText[] {
  if (Array.isArray(output.pages) && output.pages.length > 0) {
    return output.pages
      .filter((page) => page.text.trim().length > 0)
      .map((page) => ({
        pageNumber: page.pageNumber,
        text: normalizeExtractedPdfText(page.text),
        width: null,
        height: null,
        confidence: page.confidence ?? null,
        metadata: {
          native_text: false,
          ocr: true
        }
      }));
  }
  const text = normalizeExtractedPdfText(output.text);
  return text.length === 0
    ? []
    : [{
      pageNumber: 1,
      text,
      width: null,
      height: null,
      confidence: null,
      metadata: {
        native_text: false,
        ocr: true
      }
    }];
}

function mergeOcrPages(
  nativePages: PageText[],
  ocrPages: PageText[],
  ocrModel: { provider: string; model: string }
): PageText[] {
  if (nativePages.length === 0) {
    return ocrPages.map((page) => withOcrModelMetadata(page, ocrModel));
  }
  const ocrByPageNumber = new Map(ocrPages.map((page) => [page.pageNumber, page]));
  return nativePages.map((nativePage) => {
    if (nativePage.text.trim().length > 0) {
      return nativePage;
    }
    const ocrPage = ocrByPageNumber.get(nativePage.pageNumber);
    if (ocrPage === undefined) {
      return {
        ...nativePage,
        metadata: {
          ...nativePage.metadata,
          ocr: false,
          ocr_status: "no_text"
        }
      };
    }
    return withOcrModelMetadata({
      ...ocrPage,
      width: nativePage.width,
      height: nativePage.height,
      metadata: {
        ...nativePage.metadata,
        ...ocrPage.metadata,
        native_text: false,
        ocr: true
      }
    }, ocrModel);
  });
}

function withOcrModelMetadata(page: PageText, ocrModel: { provider: string; model: string }): PageText {
  return {
    ...page,
    metadata: {
      ...page.metadata,
      ocr: true,
      ocr_provider: ocrModel.provider,
      ocr_model: ocrModel.model
    }
  };
}

function estimatePdfPageCount(bytes: Buffer, extractedPages: number): number {
  if (extractedPages > 0) {
    return extractedPages;
  }
  return bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

function normalizeExtractedPdfText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
