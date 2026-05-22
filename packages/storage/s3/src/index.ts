import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import {
  StorageError,
  type ObjectBody,
  type ObjectStorage,
  type PutObjectInput,
  type StoredObject,
  type StoredObjectBody
} from "@mindory/core/storage";

export interface S3ObjectStorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  fetchImpl?: typeof fetch;
}

export interface S3ListedObject {
  key: string;
  sizeBytes: number;
  etag?: string;
  lastModified?: string;
}

export interface S3ListObjectsPageOptions {
  prefix?: string;
  continuationToken?: string;
  maxKeys?: number;
}

export interface S3ListObjectsPage {
  objects: S3ListedObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

interface S3Request {
  method: "DELETE" | "GET" | "HEAD" | "PUT";
  key: string;
  body?: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly provider = "s3" as const;
  readonly options: S3ObjectStorageOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: S3ObjectStorageOptions) {
    if (options.endpoint.trim() === "" || options.bucket.trim() === "") {
      throw new StorageError("storage_operation_failed", "S3 storage requires endpoint and bucket.");
    }
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const key = normalizeS3Key(input.key);
    const body = await objectBodyToBuffer(input.body);
    const request: S3Request = {
      method: "PUT",
      key,
      body
    };
    if (input.contentType !== undefined) {
      request.contentType = input.contentType;
    }
    if (input.metadata !== undefined) {
      request.metadata = input.metadata;
    }
    const response = await this.request(request);
    if (!response.ok) {
      await throwS3Error(response, `Could not put object ${key}.`);
    }
    return this.statObject(key);
  }

  async getObject(key: string): Promise<StoredObjectBody> {
    const normalizedKey = normalizeS3Key(key);
    const response = await this.request({ method: "GET", key: normalizedKey });
    if (response.status === 404) {
      throw new StorageError("object_not_found", `Object ${normalizedKey} was not found.`);
    }
    if (!response.ok) {
      await throwS3Error(response, `Could not get object ${normalizedKey}.`);
    }
    const responseBody = response.body;
    if (responseBody === null) {
      throw new StorageError("storage_operation_failed", `Could not get object ${normalizedKey}. S3-compatible endpoint returned an empty body.`);
    }
    const stored = storedObjectFromHeaders(normalizedKey, response.headers);
    return {
      ...stored,
      body: Readable.fromWeb(responseBody)
    };
  }

  async statObject(key: string): Promise<StoredObject> {
    const normalizedKey = normalizeS3Key(key);
    const response = await this.request({ method: "HEAD", key: normalizedKey });
    if (response.status === 404) {
      throw new StorageError("object_not_found", `Object ${normalizedKey} was not found.`);
    }
    if (!response.ok) {
      await throwS3Error(response, `Could not stat object ${normalizedKey}.`);
    }
    return storedObjectFromHeaders(normalizedKey, response.headers);
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.statObject(key);
      return true;
    } catch (error) {
      if (error instanceof StorageError && error.code === "object_not_found") {
        return false;
      }
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const normalizedKey = normalizeS3Key(key);
    const response = await this.request({ method: "DELETE", key: normalizedKey });
    if (response.status === 404) {
      return;
    }
    if (!response.ok) {
      await throwS3Error(response, `Could not delete object ${normalizedKey}.`);
    }
  }

  async ensureBucket(): Promise<void> {
    const head = await this.bucketRequest("HEAD");
    if (head.ok) {
      return;
    }
    if (head.status !== 404) {
      await throwS3Error(head, `Could not check bucket ${this.options.bucket}.`);
    }

    const created = await this.bucketRequest("PUT");
    if (created.ok || created.status === 409) {
      return;
    }
    await throwS3Error(created, `Could not create bucket ${this.options.bucket}.`);
  }

  async checkBucketAccess(): Promise<void> {
    const response = await this.bucketRequest("HEAD");
    if (!response.ok) {
      await throwS3Error(response, `Could not access bucket ${this.options.bucket}.`);
    }
  }

  async listObjectsPage(options: S3ListObjectsPageOptions = {}): Promise<S3ListObjectsPage> {
    const prefix = options.prefix ?? "";
    validateS3ListPrefix(prefix);
    const query = new URLSearchParams();
    query.set("list-type", "2");
    if (prefix !== "") {
      query.set("prefix", prefix);
    }
    if (options.continuationToken !== undefined) {
      query.set("continuation-token", options.continuationToken);
    }
    if (options.maxKeys !== undefined) {
      if (!Number.isInteger(options.maxKeys) || options.maxKeys <= 0 || options.maxKeys > 1000) {
        throw new StorageError("invalid_storage_key", "S3 list maxKeys must be an integer from 1 to 1000.");
      }
      query.set("max-keys", String(options.maxKeys));
    }
    const response = await this.bucketRequest("GET", query);
    if (!response.ok) {
      await throwS3Error(response, `Could not list bucket ${this.options.bucket}.`);
    }
    return parseListObjectsV2Response(await response.text());
  }

  private request(input: S3Request): Promise<Response> {
    const body = input.body ?? Buffer.alloc(0);
    const payloadHash = sha256Hex(body);
    const target = buildS3Url(this.options, input.key);
    const headers = new Headers();
    headers.set("host", target.url.host);
    headers.set("x-amz-content-sha256", payloadHash);
    headers.set("x-amz-date", amzDate(target.now));

    if (input.contentType !== undefined) {
      headers.set("content-type", input.contentType);
    }
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      headers.set(`x-amz-meta-${normalizeMetadataKey(key)}`, value);
    }
    headers.set("authorization", authorizationHeader({
      method: input.method,
      url: target.url,
      headers,
      payloadHash,
      now: target.now,
      region: this.options.region,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey
    }));

    const init: RequestInit = {
      method: input.method,
      headers
    };
    if (input.method === "PUT") {
      init.body = body;
    }
    return this.fetchImpl(target.url, init);
  }

  private bucketRequest(method: "GET" | "HEAD" | "PUT", query?: URLSearchParams): Promise<Response> {
    const body = Buffer.alloc(0);
    const payloadHash = sha256Hex(body);
    const target = buildS3BucketUrl(this.options);
    if (query !== undefined) {
      target.url.search = canonicalQueryString(query);
    }
    const headers = new Headers();
    headers.set("host", target.url.host);
    headers.set("x-amz-content-sha256", payloadHash);
    headers.set("x-amz-date", amzDate(target.now));
    headers.set("authorization", authorizationHeader({
      method,
      url: target.url,
      headers,
      payloadHash,
      now: target.now,
      region: this.options.region,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey
    }));

    return this.fetchImpl(target.url, {
      method,
      headers
    });
  }
}

export function normalizeS3Key(key: string): string {
  if (!key || key.startsWith("/") || key.includes("\0")) {
    throw new StorageError("invalid_storage_key", "Object storage key must be a non-empty relative path.");
  }
  const segments = key.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new StorageError("invalid_storage_key", "Object storage key cannot contain path traversal segments.");
  }
  return segments.join("/");
}

function validateS3ListPrefix(prefix: string): void {
  if (prefix.startsWith("/") || prefix.includes("\0")) {
    throw new StorageError("invalid_storage_key", "S3 list prefix must be a relative prefix.");
  }
  if (prefix.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new StorageError("invalid_storage_key", "S3 list prefix cannot contain path traversal segments.");
  }
}

async function objectBodyToBuffer(body: ObjectBody): Promise<Buffer> {
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function buildS3Url(options: S3ObjectStorageOptions, key: string): { url: URL; now: Date } {
  const endpoint = new URL(options.endpoint);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");

  if (options.forcePathStyle) {
    endpoint.pathname = joinUrlPath(endpoint.pathname, options.bucket, encodedKey);
  } else {
    endpoint.hostname = `${options.bucket}.${endpoint.hostname}`;
    endpoint.pathname = joinUrlPath(endpoint.pathname, encodedKey);
  }

  return {
    url: endpoint,
    now: new Date()
  };
}

function buildS3BucketUrl(options: S3ObjectStorageOptions): { url: URL; now: Date } {
  const endpoint = new URL(options.endpoint);
  if (options.forcePathStyle) {
    endpoint.pathname = joinUrlPath(endpoint.pathname, options.bucket);
  } else {
    endpoint.hostname = `${options.bucket}.${endpoint.hostname}`;
    endpoint.pathname = joinUrlPath(endpoint.pathname);
  }
  return {
    url: endpoint,
    now: new Date()
  };
}

function canonicalQueryString(query: URLSearchParams): string {
  return Array.from(query.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function joinUrlPath(...parts: string[]): string {
  const joined = parts
    .flatMap((part) => part.split("/"))
    .filter((part) => part.length > 0)
    .join("/");
  return `/${joined}`;
}

function authorizationHeader(input: {
  method: string;
  url: URL;
  headers: Headers;
  payloadHash: string;
  now: Date;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): string {
  const date = shortDate(input.now);
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    input.url.searchParams.toString(),
    canonicalHeaders(input.headers),
    signedHeaders(input.headers),
    input.payloadHash
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate(input.now),
    scope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders(input.headers)}, Signature=${signature}`;
}

function canonicalHeaders(headers: Headers): string {
  return signedHeaderNames(headers)
    .map((name) => `${name}:${headers.get(name)?.trim().replace(/\s+/g, " ") ?? ""}\n`)
    .join("");
}

function signedHeaders(headers: Headers): string {
  return signedHeaderNames(headers).join(";");
}

function signedHeaderNames(headers: Headers): string[] {
  return Array.from(headers.keys())
    .map((name) => name.toLowerCase())
    .sort();
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function shortDate(date: Date): string {
  return amzDate(date).slice(0, 8);
}

function storedObjectFromHeaders(key: string, headers: Headers): StoredObject {
  const contentType = headers.get("content-type") ?? undefined;
  const etag = headers.get("etag")?.replace(/^"|"$/g, "");
  const stored: StoredObject = {
    key,
    sizeBytes: Number.parseInt(headers.get("content-length") ?? "0", 10),
    metadata: metadataFromHeaders(headers)
  };
  if (contentType !== undefined) {
    stored.contentType = contentType;
  }
  if (etag !== undefined) {
    stored.etag = etag;
  }
  return stored;
}

function parseListObjectsV2Response(xml: string): S3ListObjectsPage {
  const objects = xml.match(/<Contents\b[\s\S]*?<\/Contents>/g)?.map(parseListedObject).filter((object): object is S3ListedObject => object !== null) ?? [];
  const nextContinuationToken = textFromXml(xml, "NextContinuationToken");
  const page: S3ListObjectsPage = {
    objects,
    isTruncated: (textFromXml(xml, "IsTruncated") ?? "false").toLowerCase() === "true"
  };
  if (nextContinuationToken !== undefined) {
    page.nextContinuationToken = nextContinuationToken;
  }
  return page;
}

function parseListedObject(xml: string): S3ListedObject | null {
  const key = textFromXml(xml, "Key");
  const size = textFromXml(xml, "Size");
  if (key === undefined || size === undefined) {
    return null;
  }
  const object: S3ListedObject = {
    key,
    sizeBytes: Number.parseInt(size, 10)
  };
  const etag = textFromXml(xml, "ETag")?.replace(/^"|"$/g, "");
  if (etag !== undefined) {
    object.etag = etag;
  }
  const lastModified = textFromXml(xml, "LastModified");
  if (lastModified !== undefined) {
    object.lastModified = lastModified;
  }
  return object;
}

function textFromXml(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  const value = match?.[1];
  return value === undefined ? undefined : decodeXmlEntities(value);
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function metadataFromHeaders(headers: Headers): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [name, value] of headers) {
    if (name.startsWith("x-amz-meta-")) {
      metadata[name.slice("x-amz-meta-".length)] = value;
    }
  }
  return metadata;
}

function normalizeMetadataKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

async function throwS3Error(response: Response, message: string): Promise<never> {
  throw new StorageError(
    "storage_operation_failed",
    `${message} S3-compatible endpoint returned ${response.status}: ${await response.text()}`,
  );
}
