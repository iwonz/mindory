import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(root, "node_modules/typescript/bin/tsc");

if (fs.existsSync(tsc)) {
  const result = spawnSync(process.execPath, [tsc, "-b", "--pretty", "false"], {
    cwd: root,
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
}

const result = spawnSync(process.execPath, ["scripts/validate-workspace.js"], {
  cwd: root,
  stdio: "inherit"
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

console.log("TypeScript package is not installed; structural typecheck passed.");
