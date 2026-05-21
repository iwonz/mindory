import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "packages/core/src/queue.ts",
  "packages/queue/bullmq/src/index.ts",
  "apps/worker/src/runner.ts",
  "apps/worker/src/runtime.ts"
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
const queuePackage = readJson("packages/queue/bullmq/package.json");
const workerPackage = readJson("apps/worker/package.json");
const queueTsconfig = readJson("packages/queue/bullmq/tsconfig.json");
const workerTsconfig = readJson("apps/worker/tsconfig.json");
const core = read("packages/core/src/queue.ts");
const bullmq = read("packages/queue/bullmq/src/index.ts");
const workerRunner = read("apps/worker/src/runner.ts");
const workerRuntime = read("apps/worker/src/runtime.ts");

assert(rootPackage.scripts?.["queue:validate"] === "node scripts/validate-queue.js", "Root package must expose queue:validate.");
assert(corePackage.exports?.["./queue"], "@mindory/core must export ./queue.");
assert(queuePackage.dependencies?.["@mindory/core"] === "workspace:*", "@mindory/queue-bullmq must depend on @mindory/core.");
assert(queuePackage.dependencies?.bullmq, "@mindory/queue-bullmq must depend on bullmq.");
assert(workerPackage.dependencies?.["@mindory/core"] === "workspace:*", "@mindory/worker must depend on @mindory/core.");
assert(workerPackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/worker must depend on @mindory/config.");
assert(workerPackage.dependencies?.["@mindory/queue-bullmq"] === "workspace:*", "@mindory/worker must depend on @mindory/queue-bullmq.");
assert(queueTsconfig.references?.some((reference) => reference.path === "../../../packages/core"), "BullMQ package must reference @mindory/core.");
assert(workerTsconfig.references?.some((reference) => reference.path === "../../packages/queue/bullmq"), "Worker app must reference BullMQ package.");

for (const symbol of [
  "ProcessingJobQueuePayload",
  "ProcessingJobQueue",
  "ProcessingJobWorker",
  "ProcessingJobStore",
  "ProcessingJobDispatcher",
  "ProcessingJobRunner",
  "ProcessingJobProcessorRegistry",
  "QueueError"
]) {
  assert(core.includes(symbol), `@mindory/core queue contract must define ${symbol}.`);
}

const dispatcherMethod = core.match(/async createAndEnqueue[\s\S]*?\n  \}/)?.[0] ?? "";
assert(dispatcherMethod.includes("createPendingJob"), "Dispatcher must create a durable pending job.");
assert(dispatcherMethod.indexOf("createPendingJob") < dispatcherMethod.indexOf("enqueueProcessingJob"), "Dispatcher must persist jobs before enqueueing.");
assert(core.includes("markJobRunning"), "Runner must mark jobs running.");
assert(core.includes("markJobSucceeded"), "Runner must mark jobs succeeded.");
assert(core.includes("markJobFailed"), "Runner must mark jobs failed.");
assert(core.includes("getJob"), "Job store must support job lookup.");
assert(core.includes("listJobs"), "Job store must support job listing.");
assert(core.includes("resetJobForRetry"), "Job store must support retry reset.");
assert(core.includes("async retry"), "Dispatcher must support retry enqueue.");
assert(core.includes("processor_not_found"), "Runner must fail clearly when a processor is missing.");

for (const symbol of ["BullMqProcessingJobQueue", "BullMqProcessingJobWorker", "parseRedisUrl"]) {
  assert(bullmq.includes(symbol), `BullMQ package must define ${symbol}.`);
}
assert(bullmq.includes("new Queue<ProcessingJobQueuePayload>"), "BullMQ queue adapter must create a Queue.");
assert(bullmq.includes("new Worker<ProcessingJobQueuePayload>"), "BullMQ worker adapter must create a Worker.");
assert(bullmq.includes("jobId: toBullMqJobId(payload.idempotencyKey)"), "BullMQ enqueue must use a stable safe idempotency jobId.");
assert(bullmq.includes("createHash(\"sha256\")"), "BullMQ job ids must hash durable idempotency keys to avoid reserved Redis separators.");
assert(bullmq.includes("attempts: payload.maxAttempts"), "BullMQ enqueue must configure attempts from durable job payload.");
assert(bullmq.includes("type: \"exponential\""), "BullMQ enqueue must configure exponential backoff.");
assert(bullmq.includes("prefix: options.queuePrefix"), "BullMQ queue must use configured queue prefix.");
assert(bullmq.includes("prefix: this.options.queuePrefix"), "BullMQ worker must use configured queue prefix.");

assert(workerRunner.includes("buildWorkerBaseRunner"), "Worker app must export base runner builder.");
assert(workerRunner.includes("ProcessingJobRunner"), "Worker base runner must use ProcessingJobRunner.");
assert(workerRunner.includes("BullMqProcessingJobWorker"), "Worker base runner must use BullMQ worker.");
assert(!workerRunner.includes("document.scan"), "Worker base runner must stay generic and not register concrete processors.");
assert(workerRuntime.includes("buildWorkerRuntime"), "Worker runtime must build a concrete worker runtime.");
assert(workerRuntime.includes("buildDocumentPipelineProcessors"), "Worker runtime must register document pipeline processors.");
assert(workerRuntime.includes("DbProcessingJobStore"), "Worker runtime must use durable processing job store.");

console.log("Queue scaffold validated.");
