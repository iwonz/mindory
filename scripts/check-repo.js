import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["lint", "scripts/lint-repo.js"],
  ["typecheck", "scripts/typecheck-workspaces.js"],
  ["compose:validate", "scripts/validate-compose.js"],
  ["db:validate", "scripts/validate-db-schema.js"],
  ["db:repositories:validate", "scripts/validate-db-repositories.js"],
  ["api:validate", "scripts/validate-api-skeleton.js"],
  ["api:runtime:validate", "scripts/validate-api-runtime-wiring.js"],
  ["storage:validate", "scripts/validate-storage-adapters.js"],
  ["queue:validate", "scripts/validate-queue.js"],
  ["documents:validate", "scripts/validate-document-pipeline.js"],
  ["processing:validate", "scripts/validate-processing-pipeline.js"],
  ["memory:validate", "scripts/validate-memory-context.js"],
  ["mcp:validate", "scripts/validate-mcp-server.js"],
  ["mcp:smoke", "apps/mcp/scripts/smoke-stdio.js"],
  ["cli:validate", "scripts/validate-cli.js"],
  ["cli:smoke", "scripts/smoke-cli.js"],
  ["hermes:validate", "scripts/validate-hermes-adapter.js"],
  ["hermes:smoke", "scripts/smoke-hermes.js"],
  ["mvp:acceptance", "scripts/mvp-acceptance.js"],
  ["test", "scripts/test-integration.js"],
  ["tasks:validate", "scripts/validate-tasks.js"]
];

for (const [name, script] of checks) {
  console.log(`> ${name}`);
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    stdio: "inherit"
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("All repository checks passed.");
