import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "packages/core/src/documents.ts",
  "packages/core/src/document-routing.ts",
  "packages/core/src/recompute.ts",
  "packages/core/src/antivirus.ts",
  "apps/api/src/routes/documents.ts",
  "apps/api/tsconfig.json",
  "packages/processors/antivirus-clamav/src/index.ts",
  "fixtures/docling/native-pdf.json",
  "fixtures/docling/scanned-pdf.json",
  "scripts/test-integration.js"
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
const apiPackage = readJson("apps/api/package.json");
const apiTsconfig = readJson("apps/api/tsconfig.json");
const processorPackage = readJson("packages/processors/antivirus-clamav/package.json");
const processorTsconfig = readJson("packages/processors/antivirus-clamav/tsconfig.json");
const documents = read("packages/core/src/documents.ts");
const routing = read("packages/core/src/document-routing.ts");
const recompute = read("packages/core/src/recompute.ts");
const antivirus = read("packages/core/src/antivirus.ts");
const app = read("apps/api/src/app.ts");
const runtime = read("apps/api/src/runtime.ts");
const routes = read("apps/api/src/routes/documents.ts");
const clamav = read("packages/processors/antivirus-clamav/src/index.ts");
const integration = read("scripts/test-integration.js");
const nativeDoclingFixture = readJson("fixtures/docling/native-pdf.json");
const scannedDoclingFixture = readJson("fixtures/docling/scanned-pdf.json");
const removedSyncScanUploadError = ["sync", "scan", "not", "implemented"].join("_");

assert(rootPackage.scripts?.["documents:validate"] === "node scripts/validate-document-pipeline.js", "Root package must expose documents:validate.");
assert(corePackage.exports?.["./documents"], "@mindory/core must export ./documents.");
assert(corePackage.exports?.["./document-routing"], "@mindory/core must export ./document-routing.");
assert(corePackage.exports?.["./recompute"], "@mindory/core must export ./recompute.");
assert(corePackage.exports?.["./antivirus"], "@mindory/core must export ./antivirus.");
assert(apiPackage.dependencies?.["@fastify/multipart"], "@mindory/api must depend on @fastify/multipart.");
assert(apiPackage.dependencies?.["@mindory/core"] === "workspace:*", "@mindory/api must depend on @mindory/core.");
assert(apiPackage.dependencies?.["@mindory/processor-antivirus-clamav"] === "workspace:*", "@mindory/api must depend on the ClamAV scanner for sync_scan.");
assert(apiTsconfig.references?.some((reference) => reference.path === "../../packages/processors/antivirus-clamav"), "@mindory/api must reference the ClamAV scanner package.");
assert(processorPackage.dependencies?.["@mindory/core"] === "workspace:*", "ClamAV processor must depend on @mindory/core.");
assert(processorTsconfig.references?.some((reference) => reference.path === "../../../packages/core"), "ClamAV processor must reference @mindory/core.");

for (const symbol of ["DocumentStatus", "DocumentRepository", "DocumentUploadService", "buildDocumentStorageKey"]) {
  assert(documents.includes(symbol), `Core documents module must define ${symbol}.`);
}
for (const status of ["scan_pending", "scan_clean", "scan_infected", "scan_failed", "quarantined"]) {
  assert(documents.includes(`"${status}"`), `Document statuses must include ${status}.`);
}

const uploadMethod = documents.match(/async upload[\s\S]*?\n  private requiresAsyncScan/)?.[0] ?? "";
assert(uploadMethod.includes("storage.putObject"), "Upload service must store object blob.");
assert(uploadMethod.includes("documents.createDocument"), "Upload service must create document metadata.");
assert(uploadMethod.indexOf("storage.putObject") < uploadMethod.indexOf("documents.createDocument"), "Upload service must store blob before document metadata.");
assert(uploadMethod.includes("runSynchronousScan"), "Upload service must run sync_scan before creating document metadata.");
assert(uploadMethod.includes("deleteObject(storageKey)"), "Upload service must delete infected RAW objects when policy requires deletion.");
assert(uploadMethod.includes("type: \"document.scan\""), "Upload service must enqueue document.scan jobs.");
assert(uploadMethod.includes("idempotencyKey: `document.scan:${document.id}:${this.scannerVersion}`"), "Upload service must use deterministic scan idempotency key.");
assert(documents.includes("type: \"document.route\""), "Upload service must enqueue document.route jobs when async scanning is not required.");
assert(documents.includes("idempotencyKey: `document.route:${document.id}:${this.routeProcessorVersion}`"), "Upload service must use deterministic route idempotency key.");
assert(uploadMethod.includes("scan_pending"), "Async quarantine uploads must use scan_pending status.");
assert(documents.includes("sync_scanner_missing"), "Sync scan must fail clearly when no scanner is configured.");
assert(!documents.includes(removedSyncScanUploadError), "Sync scan must not retain the old upload error path.");
assert(documents.includes("this.antivirusPolicy.onInfected === \"quarantine\" ? \"quarantined\" : \"scan_infected\""), "Sync scan must apply infected policy.");
assert(documents.includes("this.antivirusPolicy.onScanFailure === \"allow_with_warning\" ? \"scan_failed\" : \"quarantined\""), "Sync scan must apply scan-failure policy.");
assert(documents.includes("canRouteAfterUpload"), "Sync scan must route only clean or allowed-warning uploads.");

for (const token of ["classifyDocumentFile", "planDocumentProcessingRoute", "\"text\"", "\"pdf\"", "\"image\"", "\"audio\"", "\"video\"", "pdf_extraction", "image_semantic_extraction", "audio_transcription", "video_keyframes", "processor_not_implemented"]) {
  assert(routing.includes(token), `Document routing module must include ${token}.`);
}
for (const token of ["DocumentRecomputeService", "document.recompute", "processing_run_id", "raw_original_unchanged"]) {
  assert(recompute.includes(token), `Document recompute module must include ${token}.`);
}

for (const symbol of ["AntivirusScanner", "AntivirusScanResult", "AntivirusError"]) {
  assert(antivirus.includes(symbol), `Core antivirus module must define ${symbol}.`);
}

assert(app.includes("registerDocumentRoutes"), "API app must register document routes.");
assert(routes.includes("fastifyMultipart"), "Document routes must register @fastify/multipart.");
assert(routes.includes('"/v1/documents"'), "Document routes must register POST /v1/documents.");
assert(routes.includes('"/v1/documents/:id/status"'), "Document routes must register status endpoint.");
assert(routes.includes("route_job"), "Document upload response must expose route_job.");
assert(routes.includes('"/v1/documents/:id/recompute"'), "Document routes must register recompute endpoint.");
assert(routes.includes('"/v1/documents/:id/processing-runs"'), "Document routes must register processing run listing endpoint.");
assert(routes.includes("assertRouteDependencies"), "Document routes must validate runtime dependencies during registration.");
assert(routes.includes("requireRouteDependency"), "Document route handlers must guard dependency-free tests.");
assert(routes.includes("DocumentUploadService"), "Document route dependencies must accept DocumentUploadService.");
assert(runtime.includes("DocumentUploadService"), "API runtime must construct DocumentUploadService.");
assert(runtime.includes("LocalFsObjectStorage"), "API runtime must construct local-fs object storage.");
assert(runtime.includes("ProcessingJobDispatcher"), "API runtime must construct a processing job dispatcher.");
assert(runtime.includes("BullMqProcessingJobQueue"), "API runtime must enqueue upload processing jobs through BullMQ.");
assert(runtime.includes("ClamAvScanner"), "API runtime must import the ClamAV scanner.");
assert(runtime.includes("buildUploadScanner"), "API runtime must build the upload-time sync scanner.");

for (const symbol of ["ClamAvScanner", "ClamAvDocumentScanProcessor", "parseClamAvReply"]) {
  assert(clamav.includes(symbol), `ClamAV package must define ${symbol}.`);
}
assert(clamav.includes("zINSTREAM\\0"), "ClamAV scanner must use z-framed INSTREAM.");
assert(clamav.includes("writeUInt32BE"), "ClamAV scanner must write big-endian chunk lengths.");
assert(clamav.includes("Buffer.alloc(4)"), "ClamAV scanner must send zero-length terminating chunk.");
assert(clamav.includes("status: \"scan_clean\""), "ClamAV processor must set scan_clean after a clean verdict.");
assert(clamav.includes("type: \"document.route\""), "ClamAV processor must enqueue routing when job chaining is configured.");
assert(clamav.includes("status: this.policy.onInfected === \"quarantine\" ? \"quarantined\" : \"scan_infected\""), "ClamAV processor must handle infected status policy.");
assert(clamav.includes("status: this.policy.onScanFailure === \"allow_with_warning\" ? \"scan_failed\" : \"quarantined\""), "ClamAV processor must handle scan failure policy.");

assert(Array.isArray(nativeDoclingFixture.pages) && nativeDoclingFixture.pages.length === 2, "Native Docling PDF fixture must define two pages.");
assert(Array.isArray(scannedDoclingFixture.ocr_pages) && scannedDoclingFixture.ocr_pages.length === 1, "Scanned Docling PDF fixture must define OCR output.");
for (const token of ["startDoclingService", "MINDORY_DOCLING_ENABLED", "MINDORY_DOCLING_URL", "assertDoclingFailureAndRetry", "docling_service.enabled", "ocr_text", "retry path recovers"]) {
  assert(integration.includes(token), `Integration acceptance must include ${token}.`);
}
for (const token of ["startClamdProtocolServer", "MINDORY_AV_MODE: \"sync_scan\"", "Eicar-Test-Signature", "allow_with_warning", "scan_infected", "antivirus_error"]) {
  assert(integration.includes(token), `Sync scan integration acceptance must include ${token}.`);
}

console.log("Document upload and scan pipeline validated.");
