import { buildWorkerRuntime } from "./runtime.js";

const runtime = buildWorkerRuntime();

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

await runtime.start();

async function shutdown(): Promise<void> {
  await runtime.close();
  process.exit(0);
}
