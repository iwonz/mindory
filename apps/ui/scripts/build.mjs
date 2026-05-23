import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const tsc = path.join(repoRoot, "node_modules/typescript/bin/tsc");
const dist = path.join(packageRoot, "dist");

if (!existsSync(tsc)) {
  throw new Error("TypeScript is not installed. Run pnpm install before building @mindory/ui.");
}

rmSync(dist, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tsc, "-b", "--force"], {
  cwd: packageRoot,
  stdio: "inherit"
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

mkdirSync(dist, { recursive: true });
copyFileSync(path.join(packageRoot, "public", "index.html"), path.join(dist, "index.html"));
copyFileSync(path.join(packageRoot, "public", "styles.css"), path.join(dist, "styles.css"));
