import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const rootPackage = readJson("package.json");
const checkRepo = read("scripts/check-repo.js");
const queue = read("packages/core/src/queue.ts");
const processing = read("packages/core/src/processing.ts");
const jobStore = read("packages/db/src/repositories/jobs.ts");
const jobRoutes = read("apps/api/src/routes/jobs.ts");
const workerPipeline = read("apps/worker/src/document-pipeline.ts");
const clamav = read("packages/processors/antivirus-clamav/src/index.ts");
const integration = read("scripts/test-integration.js");
const workersDoc = read("docs/WORKERS.md");
const apiDoc = read("docs/API.md");

assert(rootPackage.scripts?.["jobs:validate"] === "node scripts/validate-job-semantics.js", "Root package must expose jobs:validate.");
assert(checkRepo.includes("jobs:validate"), "Repository check must run jobs:validate.");

for (const symbol of [
  "ProcessingJobStageStatus",
  "ProcessingJobStageDetail",
  "ProcessingJobProgress",
  "ProcessingJobErrorDetail",
  "ProcessingJobResult",
  "ProcessingJobDetails",
  "buildProcessingJobDetails"
]) {
  assert(queue.includes(symbol), `Queue contracts must include ${symbol}.`);
}

for (const status of ["skipped", "disabled", "blocked_by_scan", "partial_failed", "retrying"]) {
  assert(queue.includes(`"${status}"`), `Queue stage details must support ${status}.`);
}

assert(queue.includes("markJobRunning(jobId: string, metadata?"), "Job store contract must allow running metadata updates.");
assert(queue.includes("markJobSucceeded(jobId: string, metadata?"), "Job store contract must allow success metadata updates.");
assert(queue.includes("markJobFailed(jobId: string, error: Error, metadata?"), "Job store contract must allow failure metadata updates.");
assert(queue.includes("job_error"), "Queue runner must persist readable job_error details.");
assert(queue.includes("retryable: job.attempts < job.maxAttempts"), "Readable job errors must expose retryability.");
assert(processing.includes('"blocked_by_scan"'), "Processing errors must include blocked_by_scan.");

for (const token of ["mergeJobMetadata", "job_status_detail", "stage_graph", "job_error", "retrying"]) {
  assert(jobStore.includes(token), `DbProcessingJobStore must persist ${token}.`);
}

assert(jobRoutes.includes("buildProcessingJobDetails"), "Jobs API must expose normalized job details.");
assert(jobRoutes.includes("details:"), "Jobs API responses must include details.");

for (const token of ["stageGraph", "partial_failed", "disabled", "blockedByScanError", "routeSkippedStageStatus"]) {
  assert(workerPipeline.includes(token), `Document worker pipeline must record ${token}.`);
}

assert(clamav.includes("blocked_by_scan"), "ClamAV scan processor must expose blocked_by_scan stage semantics.");

for (const token of ["details.status", "details.stages", "details.error.code", "retryable"]) {
  assert(integration.includes(token), `Integration tests must assert ${token}.`);
}

assert(apiDoc.includes("details"), "API docs must describe job details.");
assert(workersDoc.includes("stage graph"), "Worker docs must describe stage graph semantics.");

console.log("Job stage graph semantics validated.");
