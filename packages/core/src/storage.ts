import type { Readable } from "node:stream";

export type ObjectStorageProvider = "local-fs" | "s3";

export type ObjectBody = Buffer | Uint8Array | string | Readable;

export interface PutObjectInput {
  key: string;
  body: ObjectBody;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  contentType?: string;
  etag?: string;
  metadata: Record<string, string>;
}

export interface StoredObjectBody extends StoredObject {
  body: Readable;
}

export interface ObjectStorage {
  readonly provider: ObjectStorageProvider;
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(key: string): Promise<StoredObjectBody>;
  statObject(key: string): Promise<StoredObject>;
  objectExists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
}

export type StorageErrorCode =
  | "invalid_storage_key"
  | "object_not_found"
  | "storage_not_implemented"
  | "storage_operation_failed";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly cause?: unknown;

  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.cause = cause;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}
