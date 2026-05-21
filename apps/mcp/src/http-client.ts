import { Buffer } from "node:buffer";

export interface MindoryApiClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface JsonRequestInput {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

export interface UploadDocumentInput {
  projectId: string;
  filename: string;
  mimeType: string;
  content: string;
  encoding?: "utf8" | "base64";
  title?: string;
}

export class MindoryApiClient {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MindoryApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getJson(path: string): Promise<unknown> {
    return this.requestJson({ method: "GET", path });
  }

  async postJson(path: string, body: unknown): Promise<unknown> {
    return this.requestJson({ method: "POST", path, body });
  }

  async patchJson(path: string, body: unknown): Promise<unknown> {
    return this.requestJson({ method: "PATCH", path, body });
  }

  async deleteJson(path: string): Promise<unknown> {
    return this.requestJson({ method: "DELETE", path });
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

    const response = await this.fetchImpl(this.url(input.path), request);

    return parseResponse(response);
  }

  async uploadDocument(input: UploadDocumentInput): Promise<unknown> {
    const form = new FormData();
    form.append("projectId", input.projectId);
    if (input.title) {
      form.append("title", input.title);
    }

    const content = input.encoding === "base64" ? Buffer.from(input.content, "base64") : Buffer.from(input.content, "utf8");
    form.append("file", new Blob([content], { type: input.mimeType }), input.filename);

    const headers: Record<string, string> = {
      accept: "application/json"
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const response = await this.fetchImpl(this.url("/v1/documents"), {
      method: "POST",
      headers,
      body: form
    });

    return parseResponse(response);
  }

  url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }
}

export class MindoryApiError extends Error {
  readonly statusCode: number;
  readonly body: unknown;

  constructor(statusCode: number, message: string, body: unknown) {
    super(message);
    this.name = "MindoryApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body
      ? JSON.stringify(body)
      : `Mindory API request failed with ${response.status}.`;
    throw new MindoryApiError(response.status, message, body);
  }

  return body;
}
