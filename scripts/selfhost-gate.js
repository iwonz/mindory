import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const localModel = args.includes("--local-model");

const env = {
  ...process.env,
  MINDORY_SELFHOST_ACCEPTANCE_LIVE: dryRun ? "false" : "true",
  ...(localModel ? { MINDORY_SELFHOST_ACCEPTANCE_LOCAL: "true" } : {})
};

const result = spawnSync("pnpm", ["selfhost:acceptance"], {
  stdio: "inherit",
  env
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}
