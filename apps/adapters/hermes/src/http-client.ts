import { Buffer } from "node:buffer";

export interface HermesMindoryApiClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface HermesJsonRequestInput {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
}

export interface HermesAttachmentUploadInput {
  projectId: string;
  filename: string;
  mimeType: string;
  content: string;
  encoding?: "utf8" | "base64";
  title?: string;
}

export class HermesMindoryApiClient {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HermesMindoryApiClientOptions) {
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

  async requestJson(input: HermesJsonRequestInput): Promise<unknown> {
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

  async uploadAttachment(input: HermesAttachmentUploadInput): Promise<unknown> {
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

  url(pathname: string): string {
    return `${this.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }
}

export class HermesMindoryApiError extends Error {
  readonly statusCode: number;
  readonly body: unknown;

  constructor(statusCode: number, message: string, body: unknown) {
    super(message);
    this.name = "HermesMindoryApiError";
    this.statusCode = statusCode;
    this.body = body;
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
    throw new HermesMindoryApiError(response.status, JSON.stringify(body), body);
  }
  return body;
}
