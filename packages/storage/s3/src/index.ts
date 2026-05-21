import {
  StorageError,
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
}

export class S3ObjectStorage implements ObjectStorage {
  readonly provider = "s3" as const;
  readonly options: S3ObjectStorageOptions;

  constructor(options: S3ObjectStorageOptions) {
    this.options = options;
  }

  async putObject(_input: PutObjectInput): Promise<StoredObject> {
    throw notImplemented();
  }

  async getObject(_key: string): Promise<StoredObjectBody> {
    throw notImplemented();
  }

  async statObject(_key: string): Promise<StoredObject> {
    throw notImplemented();
  }

  async objectExists(_key: string): Promise<boolean> {
    throw notImplemented();
  }

  async deleteObject(_key: string): Promise<void> {
    throw notImplemented();
  }
}

function notImplemented(): StorageError {
  return new StorageError(
    "storage_not_implemented",
    "S3/MinIO object storage is a TASK-6 skeleton. Add the S3 client implementation in a later task."
  );
}
