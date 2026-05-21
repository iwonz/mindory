import {
  ProcessingError,
  type SearchVectorChunksInput,
  type UpsertVectorChunksInput,
  type VectorIndex,
  type VectorIndexResult,
  type VectorSearchHit
} from "@mindory/core/processing";

export interface QdrantVectorIndexOptions {
  url: string;
  collectionPrefix: string;
}

export class QdrantVectorIndex implements VectorIndex {
  readonly provider = "qdrant";
  readonly options: QdrantVectorIndexOptions;

  constructor(options: QdrantVectorIndexOptions) {
    this.options = options;
  }

  async upsertDocumentChunks(_input: UpsertVectorChunksInput): Promise<VectorIndexResult[]> {
    throw notImplemented();
  }

  async deleteDocumentChunks(_projectId: string, _documentId: string): Promise<void> {
    throw notImplemented();
  }

  async searchDocumentChunks(_input: SearchVectorChunksInput): Promise<VectorSearchHit[]> {
    throw notImplemented();
  }
}

function notImplemented(): ProcessingError {
  return new ProcessingError(
    "vector_index_not_implemented",
    "Qdrant vector index is a placeholder for a future optional adapter task."
  );
}
