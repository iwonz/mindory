import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.env.MINDORY_INSTALL_ACCEPTANCE_LIVE === "true";
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-install-acceptance-"));
const prepareHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-install-prepare-"));

try {
  run("node", ["packages/installer/dist/cli.js", "plan"]);
  run("node", ["packages/installer/dist/cli.js", "prepare", "--home", prepareHome, "--source", root]);
  run("node", ["packages/installer/dist/cli.js", "repair", "--home", tempHome]);
  run("node", ["packages/installer/dist/cli.js", "resume", "--home", tempHome]);
  run("pnpm", ["installer:matrix:validate"]);
  run("pnpm", ["bootstrap:validate"]);

  if (live) {
    run("pnpm", ["mvp:demo", "--model-profile", "disabled", "--timeout-ms", "300000"], {
      MINDORY_HOME: tempHome
    });
    run("pnpm", ["mvp:reset"], {
      MINDORY_HOME: tempHome
    });
    console.log("Installer live Docker acceptance completed.");
  } else {
    console.log("Installer acceptance dry-run passed. Set MINDORY_INSTALL_ACCEPTANCE_LIVE=true to run the Docker smoke path.");
  }
} finally {
  if (tempHome.startsWith(os.tmpdir())) {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
  if (prepareHome.startsWith(os.tmpdir())) {
    fs.rmSync(prepareHome, { recursive: true, force: true });
  }
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env
    }
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}
