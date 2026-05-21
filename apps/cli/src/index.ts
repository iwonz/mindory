#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMindoryCli } from "./run.js";

export * from "./args.js";
export * from "./commands.js";
export * from "./http-client.js";
export * from "./run.js";

if (isMainModule(import.meta.url, process.argv[1])) {
  const exitCode = await runMindoryCli({
    argv: process.argv.slice(2),
    env: process.env
  });
  process.exitCode = exitCode;
}

function isMainModule(moduleUrl: string, entrypoint: string | undefined): boolean {
  return entrypoint !== undefined && fileURLToPath(moduleUrl) === path.resolve(entrypoint);
}
