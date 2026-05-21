import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  StorageError,
  type ObjectBody,
  type ObjectStorage,
  type PutObjectInput,
  type StoredObject,
  type StoredObjectBody
} from "@mindory/core/storage";

export interface LocalFsObjectStorageOptions {
  rootPath: string;
}

export class LocalFsObjectStorage implements ObjectStorage {
  readonly provider = "local-fs" as const;
  readonly rootPath: string;

  constructor(options: LocalFsObjectStorageOptions) {
    if (!options.rootPath) {
      throw new StorageError("invalid_storage_key", "Local filesystem storage requires a root path.");
    }
    this.rootPath = path.resolve(options.rootPath);
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const filePath = this.resolveKeyPath(input.key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeBody(filePath, input.body);
    const metadata: LocalMetadataFile = {
      metadata: input.metadata ?? {}
    };
    if (input.contentType !== undefined) {
      metadata.contentType = input.contentType;
    }
    await writeMetadata(filePath, metadata);

    return this.statObject(input.key);
  }

  async getObject(key: string): Promise<StoredObjectBody> {
    const stored = await this.statObject(key);
    return {
      ...stored,
      body: createReadStream(this.resolveKeyPath(key))
    };
  }

  async statObject(key: string): Promise<StoredObject> {
    const filePath = this.resolveKeyPath(key);

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw new StorageError("object_not_found", `Object ${key} is not a file.`);
      }

      const objectMetadata = await readMetadata(filePath);
      const storedObject: StoredObject = {
        key,
        sizeBytes: fileStat.size,
        etag: await calculateEtag(filePath),
        metadata: objectMetadata.metadata
      };
      if (objectMetadata.contentType !== undefined) {
        storedObject.contentType = objectMetadata.contentType;
      }
      return storedObject;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new StorageError("object_not_found", `Object ${key} was not found.`, error);
      }
      throw new StorageError("storage_operation_failed", `Could not stat object ${key}.`, error);
    }
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
    const filePath = this.resolveKeyPath(key);

    try {
      await rm(filePath, { force: true });
      await rm(metadataPath(filePath), { force: true });
    } catch (error) {
      throw new StorageError("storage_operation_failed", `Could not delete object ${key}.`, error);
    }
  }

  resolveKeyPath(key: string): string {
    return resolveLocalStorageKey(this.rootPath, key);
  }
}

export function resolveLocalStorageKey(rootPath: string, key: string): string {
  if (!key || path.isAbsolute(key) || key.includes("\0")) {
    throw new StorageError("invalid_storage_key", "Object storage key must be a non-empty relative path.");
  }

  const normalizedKey = key.split("/").filter(Boolean).join(path.sep);
  const segments = normalizedKey.split(path.sep);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new StorageError("invalid_storage_key", "Object storage key cannot contain path traversal segments.");
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(resolvedRoot, normalizedKey);
  const relativePath = path.relative(resolvedRoot, resolvedPath);

  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new StorageError("invalid_storage_key", "Object storage key resolves outside the storage root.");
  }

  return resolvedPath;
}

async function writeBody(filePath: string, body: ObjectBody): Promise<void> {
  if (typeof body === "string" || body instanceof Uint8Array) {
    await pipeline(Readable.from([body]), createWriteStream(filePath));
    return;
  }

  await pipeline(body, createWriteStream(filePath));
}

async function calculateEtag(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

interface LocalMetadataFile {
  contentType?: string;
  metadata: Record<string, string>;
}

function metadataPath(filePath: string): string {
  return `${filePath}.metadata.json`;
}

async function writeMetadata(filePath: string, metadata: LocalMetadataFile): Promise<void> {
  await writeFile(metadataPath(filePath), JSON.stringify(metadata, null, 2), "utf8");
}

async function readMetadata(filePath: string): Promise<LocalMetadataFile> {
  try {
    const rawMetadata = await readFile(metadataPath(filePath), "utf8");
    return JSON.parse(rawMetadata) as LocalMetadataFile;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { metadata: {} };
    }
    throw new StorageError("storage_operation_failed", `Could not read object metadata for ${filePath}.`, error);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
