import { readFile } from "node:fs/promises";
import path from "node:path";

export interface MindoryCliApiClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface JsonRequestInput {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
}

export interface UploadDocumentFileInput {
  projectId: string;
  filePath: string;
  filename?: string;
  mimeType?: string;
  title?: string;
}

export class MindoryCliApiClient {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MindoryCliApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getJson(pathname: string): Promise<unknown> {
    return this.requestJson({ method: "GET", path: pathname });
  }

  async postJson(pathname: string, body: unknown): Promise<unknown> {
    return this.requestJson({ method: "POST", path: pathname, body });
  }

  async deleteJson(pathname: string): Promise<unknown> {
    return this.requestJson({ method: "DELETE", path: pathname });
  }

  async requestJson(input: JsonRequestInput): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: "application/json"
    };
    if (input.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const request: RequestInit = {
      method: input.method,
      headers
    };
    if (input.body !== undefined) {
      request.body = JSON.stringify(input.body);
    }

    const response = await this.fetchJson(input.path, request);

    return parseResponse(response);
  }

  async uploadDocument(input: UploadDocumentFileInput): Promise<unknown> {
    const form = new FormData();
    form.append("projectId", input.projectId);
    if (input.title) {
      form.append("title", input.title);
    }

    const body = await readFile(input.filePath);
    const filename = input.filename ?? path.basename(input.filePath);
    const mimeType = input.mimeType ?? inferMimeType(filename);
    form.append("file", new Blob([body], { type: mimeType }), filename);

    const headers: Record<string, string> = {
      accept: "application/json"
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const response = await this.fetchJson("/v1/documents", {
      method: "POST",
      headers,
      body: form
    });

    return parseResponse(response);
  }

  url(pathname: string): string {
    return `${this.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }

  private async fetchJson(pathname: string, request: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(this.url(pathname), request);
    } catch (error) {
      throw new MindoryCliNetworkError(`Unable to reach Mindory API at ${this.baseUrl}.`, error);
    }
  }
}

export class MindoryCliApiError extends Error {
  readonly statusCode: number;
  readonly apiCode: string | null;
  readonly body: unknown;

  constructor(statusCode: number, message: string, body: unknown, apiCode: string | null = null) {
    super(message);
    this.name = "MindoryCliApiError";
    this.statusCode = statusCode;
    this.apiCode = apiCode;
    this.body = body;
  }
}

export class MindoryCliNetworkError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MindoryCliNetworkError";
    this.cause = cause;
  }
}

export function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = extractApiError(body);
    throw new MindoryCliApiError(
      response.status,
      error.message ?? (response.statusText || "Mindory API request failed."),
      body,
      error.code
    );
  }
  return body;
}

function extractApiError(body: unknown): { code: string | null; message: string | null } {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return {
      code: null,
      message: typeof body === "string" && body.length > 0 ? body : null
    };
  }

  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return { code: null, message: null };
  }

  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : null,
    message: typeof record.message === "string" ? record.message : null
  };
}

function inferMimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }
  if (extension === ".json") {
    return "application/json";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  return "text/plain";
}
