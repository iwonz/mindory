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
  "scripts/docling-service.mjs",
  "packages/processors/extractors/image-semantic/src/index.ts",
  "packages/processors/extractors/video-keyframe/src/index.ts",
  "packages/processors/embeddings/openai-compatible/src/index.ts",
  "packages/processors/embeddings/ollama/src/index.ts",
  "packages/llm/src/index.ts",
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
const videoKeyframePackage = readJson("packages/processors/extractors/video-keyframe/package.json");
const videoKeyframeTsconfig = readJson("packages/processors/extractors/video-keyframe/tsconfig.json");
const openAiPackage = readJson("packages/processors/embeddings/openai-compatible/package.json");
const openAiTsconfig = readJson("packages/processors/embeddings/openai-compatible/tsconfig.json");
const ollamaPackage = readJson("packages/processors/embeddings/ollama/package.json");
const ollamaTsconfig = readJson("packages/processors/embeddings/ollama/tsconfig.json");
const llmPackage = readJson("packages/llm/package.json");
const llmTsconfig = readJson("packages/llm/tsconfig.json");
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
const doclingService = read("scripts/docling-service.mjs");
const imageSemantic = read("packages/processors/extractors/image-semantic/src/index.ts");
const videoKeyframe = read("packages/processors/extractors/video-keyframe/src/index.ts");
const openAi = read("packages/processors/embeddings/openai-compatible/src/index.ts");
const ollama = read("packages/processors/embeddings/ollama/src/index.ts");
const llm = read("packages/llm/src/index.ts");
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
  "video_keyframes",
  "processor_" + "not" + "_implemented"
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
assert(audioTranscriptPackage.dependencies?.["@mindory/llm"] === "workspace:*", "Audio transcript extractor must route ASR through @mindory/llm.");
assert(audioTranscriptPackage.exports?.["."], "Audio transcript extractor must export its root module.");
assert(audioTranscriptTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Audio transcript extractor must reference @mindory/core.");
assert(audioTranscriptTsconfig.references?.some((reference) => reference.path === "../../../../packages/llm"), "Audio transcript extractor must reference @mindory/llm.");
for (const token of ["AudioTranscriptExtractor", "transcriptSegments", "transcript_segment", "readWavMetadata", "ICMT", "asr", "asrProvider", "transcribe", "provider_asr", "llm_asr_provider"]) {
  assert(audioTranscript.includes(token), `Audio transcript extractor must include ${token}.`);
}

assert(doclingPackage.dependencies?.["@mindory/core"] === "workspace:*", "Docling PDF extractor must depend on @mindory/core.");
assert(doclingPackage.dependencies?.["@mindory/llm"] === "workspace:*", "Docling PDF extractor must route OCR through @mindory/llm.");
assert(doclingPackage.exports?.["."], "Docling PDF extractor must export its root module.");
assert(doclingTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Docling PDF extractor must reference @mindory/core.");
assert(doclingTsconfig.references?.some((reference) => reference.path === "../../../../packages/llm"), "Docling PDF extractor must reference @mindory/llm.");
for (const token of ["DoclingPdfExtractor", "extractPdfPageText", "\"application/pdf\"", "\".pdf\"", "native_text_pages", "ocr", "ocrProvider", "recognizeText", "ocr_text_pages", "service", "/v1/extract", "AbortController", "docling_service"]) {
  assert(docling.includes(token), `Docling PDF extractor must include ${token}.`);
}
for (const token of ["DoclingPdfExtractor", "/health", "/v1/extract", "Readable.from", "data_base64", "docling_service_runtime"]) {
  assert(doclingService.includes(token), `Docling service must include ${token}.`);
}

assert(imageSemanticPackage.dependencies?.["@mindory/core"] === "workspace:*", "Image semantic extractor must depend on @mindory/core.");
assert(imageSemanticPackage.dependencies?.["@mindory/llm"] === "workspace:*", "Image semantic extractor must route OCR and vision through @mindory/llm.");
assert(imageSemanticPackage.exports?.["."], "Image semantic extractor must export its root module.");
assert(imageSemanticTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Image semantic extractor must reference @mindory/core.");
assert(imageSemanticTsconfig.references?.some((reference) => reference.path === "../../../../packages/llm"), "Image semantic extractor must reference @mindory/llm.");
for (const token of ["ImageSemanticExtractor", "image_caption", "image_analysis", "ocr_text", "image_embedding", "faceObservations", "face_detection", "deterministicFaceEmbedding", "extractEmbeddedImageText", "ocrProvider", "visionProvider", "faceProvider", "recognizeText", "captionImage", "detectFaces", "recognizeFaces", "provider_ocr", "provider_caption", "provider_detected", "provider_recognized", "llm_face_provider"]) {
  assert(imageSemantic.includes(token), `Image semantic extractor must include ${token}.`);
}

assert(videoKeyframePackage.dependencies?.["@mindory/core"] === "workspace:*", "Video keyframe extractor must depend on @mindory/core.");
assert(videoKeyframePackage.dependencies?.["@mindory/llm"] === "workspace:*", "Video keyframe extractor must route frame OCR and vision through @mindory/llm.");
assert(videoKeyframePackage.exports?.["."], "Video keyframe extractor must export its root module.");
assert(videoKeyframeTsconfig.references?.some((reference) => reference.path === "../../../../packages/core"), "Video keyframe extractor must reference @mindory/core.");
assert(videoKeyframeTsconfig.references?.some((reference) => reference.path === "../../../../packages/llm"), "Video keyframe extractor must reference @mindory/llm.");
for (const token of ["VideoKeyframeExtractor", "video_keyframe", "video_keyframe_description", "maxKeyframes", "MINDORY_VIDEO_MANIFEST", "readVideoManifest", "LocalCommandVideoKeyframeProvider", "keyframeProvider", "local-command", "recognizeText", "captionImage", "provider_ocr", "provider_caption"]) {
  assert(videoKeyframe.includes(token), `Video keyframe extractor must include ${token}.`);
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

assert(llmPackage.dependencies?.["@mindory/config"] === "workspace:*", "LLM SDK package must depend on @mindory/config.");
assert(llmPackage.dependencies?.["@mindory/core"] === "workspace:*", "LLM SDK package must depend on @mindory/core.");
assert(llmPackage.exports?.["."], "LLM SDK package must export its root module.");
assert(llmTsconfig.references?.some((reference) => reference.path === "../config"), "LLM SDK package must reference @mindory/config.");
for (const token of ["buildMindoryLlm", "buildMindoryTextEmbeddingsProvider", "LlmRoleRegistry", "LlmOperationResult", "oauth-bearer", "OpenAICompatibleEmbeddingsProvider", "OllamaEmbeddingsProvider"]) {
  assert(llm.includes(token), `LLM SDK adapter must include ${token}.`);
}

assert(pgvectorPackage.dependencies?.["@mindory/core"] === "workspace:*", "pgvector package must depend on @mindory/core.");
assert(pgvectorPackage.dependencies?.["@mindory/db"] === "workspace:*", "pgvector package must depend on @mindory/db.");
assert(pgvectorPackage.exports?.["."], "pgvector package must export its root module.");
assert(pgvectorTsconfig.references?.some((reference) => reference.path === "../../../packages/core"), "pgvector package must reference @mindory/core.");
assert(pgvectorTsconfig.references?.some((reference) => reference.path === "../../../packages/db"), "pgvector package must reference @mindory/db.");
for (const token of ["PgVectorChunkIndex", "PgVectorDocumentChunkSearchRepository", "createTableSql", "vector(", "upsertDocumentChunks", "deleteDocumentChunks", "searchDocumentChunks", "metadataFilters", "<=>"]) {
  assert(pgvector.includes(token), `pgvector package must include ${token}.`);
}
assert(!pgvector.includes("vector_index_" + "not" + "_implemented"), "pgvector package must include a working implementation.");

assert(qdrantPackage.dependencies?.["@mindory/core"] === "workspace:*", "Qdrant package must depend on @mindory/core.");
assert(qdrantPackage.exports?.["."], "Qdrant package must export its root module.");
assert(qdrantTsconfig.references?.some((reference) => reference.path === "../../../packages/core"), "Qdrant package must reference @mindory/core.");
for (const token of ["QdrantVectorIndex", "QdrantDocumentChunkSearchRepository", "ensureCollection", "healthcheck", "upsertDocumentChunks", "deleteDocumentChunks", "searchDocumentChunks", "/points/search", "/points/delete?wait=true", "source_refs", "metadataFilters"]) {
  assert(qdrant.includes(token), `Qdrant package must include ${token}.`);
}
assert(!qdrant.includes("vector_index_" + "not" + "_implemented"), "Qdrant package must include a working implementation.");

for (const token of [
  "\"TEXT_EMBEDDING\"",
  "readLlmEmbeddingCapabilityConfig",
  "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_LLM_OLLAMA_BASE_URL",
  "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
]) {
  assert(config.includes(token), `Config loader must read ${token}.`);
}
for (const envName of [
  "MINDORY_LLM_TEXT_EMBEDDING_ENABLED",
  "MINDORY_LLM_TEXT_EMBEDDING_PROVIDER",
  "MINDORY_LLM_TEXT_EMBEDDING_MODEL",
  "MINDORY_LLM_TEXT_EMBEDDING_DIMENSIONS",
  "MINDORY_LLM_TEXT_EMBEDDING_TIMEOUT_MS",
  "MINDORY_LLM_TEXT_EMBEDDING_CONCURRENCY",
  "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL",
  "MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE",
  "MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY",
  "MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN",
  "MINDORY_LLM_OLLAMA_BASE_URL",
  "MINDORY_LLM_LOCAL_HTTP_BASE_URL"
]) {
  assert(envExample.includes(envName), `.env.example must include ${envName}.`);
}
for (const token of [
  "PGVECTOR_EMBEDDING_DIMENSIONS",
  "validateMindoryConfig",
  "MODEL is required when the capability is enabled",
  "MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL is required",
  "MINDORY_LLM_OLLAMA_BASE_URL is required"
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
  "VideoKeyframeExtractor",
  "FaceService",
  "pdf_page",
  "pdf_native_text",
  "ocr_text",
  "transcript_segment",
  "video_keyframe",
  "face_observation",
  "page_artifact_ids",
  "semantic_artifact_ids",
  "semantic_artifact_types",
  "transcript_artifact_ids",
  "transcript_time_ranges",
  "video_keyframe_artifact_ids",
  "face_observation_artifact_ids",
  "text_artifact_id",
  "artifact_id",
  "createExtractedSemanticArtifacts",
  "createExtractedTranscriptArtifacts",
  "createExtractedFaceObservations",
  "doclingPdfExtractorOptions(options.config, llm)",
  "config.docling",
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
for (const token of ["buildWorkerRuntime", "DbDocumentChunkRepository", "ProcessingJobDispatcher", "buildDocumentPipelineProcessors", "QdrantVectorIndex", "config.vector.provider === \"qdrant\""]) {
  assert(workerRuntime.includes(token), `Worker runtime must include ${token}.`);
}
for (const token of ["SessionSummaryProcessor", "MemoryDerivationProcessor", "session.summarize", "memory.derive"]) {
  assert(memoryPipeline.includes(token), `Worker memory pipeline must include ${token}.`);
}
assert(workerRuntime.includes("buildMemoryRuntimeProcessors"), "Worker runtime must register memory/context processors.");

console.log("Processing extraction, chunking, embeddings and worker pipeline validated.");
