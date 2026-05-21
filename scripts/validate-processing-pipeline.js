import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "packages/core/src/processing.ts",
  "packages/core/src/faces.ts",
  "packages/core/src/document-routing.ts",
  "packages/core/src/recompute.ts",
  "packages/processors/extractors/builtin-text/src/index.ts",
  "packages/processors/extractors/audio-transcript/src/index.ts",
  "packages/processors/extractors/docling/src/index.ts",
  "packages/processors/extractors/image-semantic/src/index.ts",
  "packages/processors/embeddings/openai-compatible/src/index.ts",
  "packages/processors/embeddings/ollama/src/index.ts",
  "packages/model-runtime/src/index.ts",
  "packages/vector/pgvector/src/index.ts",
  "packages/vector/qdrant/src/index.ts",
  "apps/worker/src/document-pipeline.ts",
  "apps/worker/src/memory-pipeline.ts",
  "apps/worker/src/runtime.ts",
  "scripts/mvp-acceptance.js"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `${file} is required.`);
}

const rootPackage = readJson("package.json");
const corePackage = readJson("packages/core/package.json");
const extractorPackage = readJson("packages/processors/extractors/builtin-text/package.json");
const extractorTsconfig = readJson("packages/processors/extractors/builtin-text/tsconfig.json");
const audioTranscriptPackage = readJson("packages/processors/extractors/audio-transcript/package.json");
const audioTranscriptTsconfig = readJson("packages/processors/extractors/audio-transcript/tsconfig.json");
const doclingPackage = readJson("packages/processors/extractors/docling/package.json");
const doclingTsconfig = readJson("packages/processors/extractors/docling/tsconfig.json");
const imageSemanticPackage = readJson("packages/processors/extractors/image-semantic/package.json");
const imageSemanticTsconfig = readJson("packages/processors/extractors/image-semantic/tsconfig.json");
const openAiPackage = readJson("packages/processors/embeddings/openai-compatible/package.json");
const openAiTsconfig = readJson("packages/processors/embeddings/openai-compatible/tsconfig.json");
const ollamaPackage = readJson("packages/processors/embeddings/ollama/package.json");
const ollamaTsconfig = readJson("packages/processors/embeddings/ollama/tsconfig.json");
const modelRuntimePackage = readJson("packages/model-runtime/package.json");
const modelRuntimeTsconfig = readJson("packages/model-runtime/tsconfig.json");
const pgvectorPackage = readJson("packages/vector/pgvector/package.json");
const pgvectorTsconfig = readJson("packages/vector/pgvector/tsconfig.json");
const qdrantPackage = readJson("packages/vector/qdrant/package.json");
const qdrantTsconfig = readJson("packages/vector/qdrant/tsconfig.json");

const coreIndex = read("packages/core/src/index.ts");
const processing = read("packages/core/src/processing.ts");
const faces = read("packages/core/src/faces.ts");
const routing = read("packages/core/src/document-routing.ts");
const recompute = read("packages/core/src/recompute.ts");
const extractor = read("packages/processors/extractors/builtin-text/src/index.ts");
const audioTranscript = read("packages/processors/extractors/audio-transcript/src/index.ts");
const docling = read("packages/processors/extractors/docling/src/index.ts");
const imageSemantic = read("packages/processors/extractors/image-semantic/src/index.ts");
const openAi = read("packages/processors/embeddings/openai-compatible/src/index.ts");
const ollama = read("packages/processors/embeddings/ollama/src/index.ts");
const modelRuntime = read("packages/model-runtime/src/index.ts");
const pgvector = read("packages/vector/pgvector/src/index.ts");
const qdrant = read("packages/vector/qdrant/src/index.ts");
const workerPipeline = read("apps/worker/src/document-pipeline.ts");
const memoryPipeline = read("apps/worker/src/memory-pipeline.ts");
const workerRuntime = read("apps/worker/src/runtime.ts");
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const mvpAcceptance = read("scripts/mvp-acceptance.js");
const configurationDocs = read("docs/CONFIGURATION.md");

assert(rootPackage.scripts?.["processing:validate"] === "node scripts/validate-processing-pipeline.js", "Root package must expose processing:validate.");
assert(corePackage.exports?.["./processing"], "@mindory/core must export ./processing.");
assert(corePackage.exports?.["./faces"], "@mindory/core must export ./faces.");
assert(corePackage.exports?.["./document-routing"], "@mindory/core must export ./document-routing.");
assert(corePackage.exports?.["./recompute"], "@mindory/core must export ./recompute.");
assert(coreIndex.includes('export * from "./processing.js";'), "@mindory/core root index must export processing contracts.");
assert(coreIndex.includes('export * from "./faces.js";'), "@mindory/core root index must export face contracts.");
assert(coreIndex.includes('export * from "./document-routing.js";'), "@mindory/core root index must export document routing contracts.");
assert(coreIndex.includes('export * from "./recompute.js";'), "@mindory/core root index must export recompute contracts.");

for (const symbol of [
  "TextExtractor",
  "ExtractTextInput",
  "ExtractedText",
  "ExtractedFaceObservation",
  "ExtractedTranscriptSegment",
  "TextChunker",
  "FixedSizeTextChunker",
  "TextChunk",
  "DocumentChunkRepository",
  "EmbeddingsProvider",
  "EmbeddingResult",
  "VectorIndex",
  "VectorChunkEmbedding",
  "ProcessingError"
]) {
  assert(processing.includes(symbol), `@mindory/core processing module must define ${symbol}.`);
}
for (const token of ["FaceService", "recordObservation", "cosineSimilarity", "mergeIdentities"]) {
  assert(faces.includes(token), `@mindory/core faces module must include ${token}.`);
}

for (const token of [
  "DocumentProcessingRouteConfig",
  "classifyDocumentFile",
  "planDocumentProcessingRoute",
  "routingEnabled",
  "pdf_extraction",
  "image_semantic_extraction",
  "audio_transcription",
  "processor_not_implemented"
]) {
  assert(routing.includes(token), `@mindory/core document routing module must include ${token}.`);
}
for (const token of [
  "DocumentRecomputeService",
  "DOCUMENT_RECOMPUTE_PROCESSOR_VERSION",
  "normalizeDocumentRecomputeStages",
  "document.recompute"
]) {
  assert(recompute.includes(token), `@mindory/core recompute module must include ${token}.`);
}

for (const token of ["maxTokens", "overlapTokens", "start_offset", "end_offset", "tokenCount", "randomUUID"]) {
  assert(processing.includes(token), `FixedSizeTextChunker must include ${token}.`);
}

assert(extractorPackage.dependencies?.["@mindory/core"] === "workspace:*", "Builtin text extractor must depend on @mindory/core.");
assert(extractorPackage.exports?.["."], "Builtin text extractor must export its root module.");
assert(extractorTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Builtin text extractor must reference @mindory/core.");
for (const token of ["BuiltinTextExtractor", "supports(", "extract(", "normalizeMarkdown", "\"text/plain\"", "\"text/markdown\"", "\".txt\"", "\".md\"", "\".markdown\""]) {
  assert(extractor.includes(token), `Builtin text extractor must include ${token}.`);
}

assert(audioTranscriptPackage.dependencies?.["@mindory/core"] === "workspace:*", "Audio transcript extractor must depend on @mindory/core.");
assert(audioTranscriptPackage.exports?.["."], "Audio transcript extractor must export its root module.");
assert(audioTranscriptTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Audio transcript extractor must reference @mindory/core.");
for (const token of ["AudioTranscriptExtractor", "transcriptSegments", "transcript_segment", "readWavMetadata", "ICMT", "asr"]) {
  assert(audioTranscript.includes(token), `Audio transcript extractor must include ${token}.`);
}

assert(doclingPackage.dependencies?.["@mindory/core"] === "workspace:*", "Docling PDF extractor must depend on @mindory/core.");
assert(doclingPackage.exports?.["."], "Docling PDF extractor must export its root module.");
assert(doclingTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Docling PDF extractor must reference @mindory/core.");
for (const token of ["DoclingPdfExtractor", "extractPdfPageText", "\"application/pdf\"", "\".pdf\"", "native_text_pages", "ocr"]) {
  assert(docling.includes(token), `Docling PDF extractor must include ${token}.`);
}

assert(imageSemanticPackage.dependencies?.["@mindory/core"] === "workspace:*", "Image semantic extractor must depend on @mindory/core.");
assert(imageSemanticPackage.exports?.["."], "Image semantic extractor must export its root module.");
assert(imageSemanticTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Image semantic extractor must reference @mindory/core.");
for (const token of ["ImageSemanticExtractor", "image_caption", "image_analysis", "ocr_text", "image_embedding", "faceObservations", "face_detection", "deterministicFaceEmbedding", "extractEmbeddedImageText"]) {
  assert(imageSemantic.includes(token), `Image semantic extractor must include ${token}.`);
}

assert(openAiPackage.dependencies?.["@mindory/core"] === "workspace:*", "OpenAI-compatible embedding package must depend on @mindory/core.");
assert(openAiPackage.exports?.["."], "OpenAI-compatible embedding package must export its root module.");
assert(openAiTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "OpenAI-compatible embedding package must reference @mindory/core.");
for (const token of ["OpenAICompatibleEmbeddingsProvider", "/embeddings", "Bearer", "fetch", "dimensions"]) {
  assert(openAi.includes(token), `OpenAI-compatible embedding provider must include ${token}.`);
}

assert(ollamaPackage.dependencies?.["@mindory/core"] === "workspace:*", "Ollama embedding package must depend on @mindory/core.");
assert(ollamaPackage.exports?.["."], "Ollama embedding package must export its root module.");
assert(ollamaTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Ollama embedding package must reference @mindory/core.");
for (const token of ["OllamaEmbeddingsProvider", "/api/embed", "embeddings", "fetch"]) {
  assert(ollama.includes(token), `Ollama embedding provider must include ${token}.`);
}

assert(modelRuntimePackage.dependencies?.["@mindory/config"] === "workspace:*", "Model runtime package must depend on @mindory/config.");
assert(modelRuntimePackage.dependencies?.["@mindory/core"] === "workspace:*", "Model runtime package must depend on @mindory/core.");
assert(modelRuntimePackage.exports?.["."], "Model runtime package must export its root module.");
assert(modelRuntimeTsconfig.references?.some((reference) => reference.path === "../config"), "Model runtime package must reference @mindory/config.");
for (const token of ["buildMindoryModelRuntime", "buildMindoryTextEmbeddingsProvider", "ModelCapabilityRegistry", "oauth-bearer", "OpenAICompatibleEmbeddingsProvider", "OllamaEmbeddingsProvider"]) {
  assert(modelRuntime.includes(token), `Model runtime adapter must include ${token}.`);
}

assert(pgvectorPackage.dependencies?.["@mindory/core"] === "workspace:*", "pgvector package must depend on @mindory/core.");
assert(pgvectorPackage.dependencies?.["@mindory/db"] === "workspace:*", "pgvector package must depend on @mindory/db.");
assert(pgvectorPackage.exports?.["."], "pgvector package must export its root module.");
assert(pgvectorTsconfig.references?.some((reference) => reference.path === "../../../packages/core"), "pgvector package must reference @mindory/core.");
assert(pgvectorTsconfig.references?.some((reference) => reference.path === "../../../packages/db"), "pgvector package must reference @mindory/db.");
for (const token of ["PgVectorChunkIndex", "PgVectorDocumentChunkSearchRepository", "createTableSql", "vector(", "upsertDocumentChunks", "deleteDocumentChunks", "searchDocumentChunks", "metadataFilters", "<=>"]) {
  assert(pgvector.includes(token), `pgvector package must include ${token}.`);
}
assert(!pgvector.includes("vector_index_not_implemented"), "pgvector package must no longer be a not-implemented placeholder.");

assert(qdrantPackage.dependencies?.["@mindory/core"] === "workspace:*", "Qdrant package must depend on @mindory/core.");
assert(qdrantPackage.exports?.["."], "Qdrant package must export its root module.");
assert(qdrantTsconfig.references?.some((reference) => reference.path === "../../../packages/core"), "Qdrant package must reference @mindory/core.");
for (const token of ["QdrantVectorIndex", "vector_index_not_implemented", "upsertDocumentChunks", "searchDocumentChunks"]) {
  assert(qdrant.includes(token), `Qdrant package must include ${token}.`);
}

for (const token of [
  "\"TEXT_EMBEDDING\"",
  "readModelEmbeddingCapabilityConfig",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL"
]) {
  assert(config.includes(token), `Config loader must read ${token}.`);
}
for (const envName of [
  "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_ENABLED",
  "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_PROVIDER",
  "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_MODEL",
  "MINDORY_MODEL_RUNTIME_TEXT_EMBEDDING_DIMENSIONS",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_MODEL_RUNTIME_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL"
]) {
  assert(envExample.includes(envName), `.env.example must include ${envName}.`);
}
for (const token of [
  "PGVECTOR_EMBEDDING_DIMENSIONS",
  "validateMindoryConfig",
  "MODEL is required when the capability is enabled",
  "MINDORY_MODEL_RUNTIME_OPENAI_COMPATIBLE_BASE_URL is required",
  "MINDORY_MODEL_RUNTIME_OLLAMA_BASE_URL is required"
]) {
  assert(config.includes(token), `Config loader must validate embeddings setting ${token}.`);
}
for (const token of [
  "MINDORY_E2E_REQUIRE_INDEXED",
  "new Set([\"indexed\"])",
  "\"/v1/documents/search\"",
  "sourceRefs"
]) {
  assert(mvpAcceptance.includes(token), `MVP acceptance must include strict indexed search token ${token}.`);
}
assert(envExample.includes("MINDORY_E2E_REQUIRE_INDEXED"), ".env.example must document strict indexed acceptance.");
for (const token of ["OpenAI-compatible example", "Ollama example", "1536-dimensional", "disabled"]) {
  assert(configurationDocs.includes(token), `Configuration docs must describe embeddings mode: ${token}.`);
}

for (const token of [
  "DocumentPipelineProcessorRegistry",
  "DocumentRecomputeProcessor",
  "DocumentRouteProcessor",
  "DocumentExtractProcessor",
  "DocumentChunkProcessor",
  "DocumentEmbedProcessor",
  "DocumentIndexProcessor",
  "createDocumentArtifact",
  "replaceDocumentArtifactTextSpans",
  "upsertDocumentMediaMetadata",
  "replaceDocumentMetadataIndex",
  "size_bytes",
  "duration_ms",
  "checksum_sha256",
  "DoclingPdfExtractor",
  "ImageSemanticExtractor",
  "AudioTranscriptExtractor",
  "FaceService",
  "pdf_page",
  "pdf_native_text",
  "transcript_segment",
  "face_observation",
  "page_artifact_ids",
  "semantic_artifact_ids",
  "semantic_artifact_types",
  "transcript_artifact_ids",
  "transcript_time_ranges",
  "face_observation_artifact_ids",
  "text_artifact_id",
  "artifact_id",
  "createExtractedSemanticArtifacts",
  "createExtractedTranscriptArtifacts",
  "createExtractedFaceObservations",
  "ClamAvDocumentScanProcessor",
  "document.recompute",
  "document.route",
  "document.extract",
  "document.chunk",
  "document.embed",
  "document.index",
  "replaceDocumentChunks"
]) {
  assert(workerPipeline.includes(token), `Worker document pipeline must include ${token}.`);
}
for (const token of ["buildWorkerRuntime", "DbDocumentChunkRepository", "ProcessingJobDispatcher", "buildDocumentPipelineProcessors"]) {
  assert(workerRuntime.includes(token), `Worker runtime must include ${token}.`);
}
for (const token of ["SessionSummaryProcessor", "MemoryDerivationProcessor", "session.summarize", "memory.derive"]) {
  assert(memoryPipeline.includes(token), `Worker memory pipeline must include ${token}.`);
}
assert(workerRuntime.includes("buildMemoryRuntimeProcessors"), "Worker runtime must register memory/context processors.");

console.log("Processing extraction, chunking, embeddings and worker pipeline validated.");
