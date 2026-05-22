import fs from "node:fs";
import os from "node:os";
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

const installerSource = read("packages/installer/src/index.ts");
const installerCli = read("packages/installer/src/cli.ts");
const installerDocs = read("docs/INSTALLER.md");
const productionDocs = read("docs/PRODUCTION_HARDENING.md");

for (const token of [
  "createMindoryRuntimeBackup",
  "restoreMindoryRuntimeBackup",
  "RuntimeBackupManifest",
  "pg_dump",
  "psql",
  "backup-manifest.json",
  "external_s3"
]) {
  assert(installerSource.includes(token), `Installer source must include ${token}.`);
}

for (const token of ["command === \"backup\"", "command === \"restore\"", "mindory-installer backup", "mindory-installer restore"]) {
  assert(installerCli.includes(token), `Installer CLI must expose ${token}.`);
}

for (const token of ["backup-manifest.json", "pg_dump", "restore --home", "External S3-compatible bucket data"]) {
  assert(installerDocs.includes(token), `Installer docs must describe ${token}.`);
}
assert(productionDocs.includes("mindory-installer backup"), "Production hardening docs must use the installer backup command.");
assert(productionDocs.includes("point-in-time recovery"), "Production hardening docs must keep PITR as future hardening.");

const installer = await import("../packages/installer/dist/index.js");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-backup-restore-"));
const commands = [];
fs.mkdirSync(path.join(home, "config"), { recursive: true });
fs.mkdirSync(path.join(home, "data", "objects", "documents"), { recursive: true });
fs.mkdirSync(path.join(home, "install", "compose"), { recursive: true });
fs.writeFileSync(path.join(home, "config", ".env"), [
  `MINDORY_HOME=${home}`,
  "MINDORY_PUBLIC_URL=http://localhost:3000",
  "MINDORY_DATABASE_URL=postgresql://mindory:mindory@postgres:5432/mindory",
  "MINDORY_STORAGE_PROVIDER=local-fs",
  "MINDORY_STORAGE_LOCAL_PATH=/data/mindory/objects"
].join("\n"));
fs.writeFileSync(path.join(home, "config", "mindory.config.json"), "{\"profile\":\"test\"}\n");
fs.writeFileSync(path.join(home, "data", "objects", "documents", "raw.txt"), "raw object\n");
fs.writeFileSync(path.join(home, "install", "install-journal.json"), "[]\n");
fs.writeFileSync(path.join(home, "install", "compose", "docker-compose.yml"), "services: {}\n");

const commandRunner = {
  async run(command, args) {
    commands.push(`${command} ${args.join(" ")}`);
    const cpIndex = args.indexOf("cp");
    if (cpIndex !== -1) {
      const source = args[cpIndex + 1];
      const target = args[cpIndex + 2];
      if (typeof source === "string" && source.startsWith("postgres:") && typeof target === "string") {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "-- mindory pg_dump fixture\n");
      }
    }
    return { status: 0, stdout: "ok", stderr: "" };
  }
};

const dryRunReport = await installer.createMindoryRuntimeBackup(home, {
  dryRun: true,
  includePostgres: false,
  commandRunner
});
assert(dryRunReport.dryRun === true, "Backup dry-run must report dryRun=true.");
assert(!fs.existsSync(dryRunReport.backupPath), "Backup dry-run must not create the backup directory.");
assert(dryRunReport.components.some((component) => component.status === "dry_run"), "Backup dry-run must mark components as dry_run.");

const backupReport = await installer.createMindoryRuntimeBackup(home, {
  label: "validator",
  commandRunner
});
assert(fs.existsSync(backupReport.manifestPath), "Backup must write backup-manifest.json.");
assert(fs.existsSync(path.join(backupReport.backupPath, "config", ".env")), "Backup must copy config files.");
assert(fs.existsSync(path.join(backupReport.backupPath, "objects", "documents", "raw.txt")), "Backup must copy local object files.");
assert(fs.existsSync(path.join(backupReport.backupPath, "postgres", "mindory.sql")), "Backup must copy the PostgreSQL dump.");
assert(backupReport.components.some((component) => component.component === "postgres" && component.status === "backed_up"), "Backup must report backed-up PostgreSQL.");
assert(commands.some((command) => command.includes("pg_dump")), "Backup must run pg_dump through Compose.");
assert(commands.some((command) => command.includes("cp postgres:/tmp/mindory-backup")), "Backup must copy the dump out of the postgres container.");

fs.writeFileSync(path.join(home, "config", ".env"), "MINDORY_HOME=changed\n");
fs.writeFileSync(path.join(home, "data", "objects", "documents", "raw.txt"), "changed\n");

let restoreRejected = false;
try {
  await installer.restoreMindoryRuntimeBackup(home, backupReport.backupPath, {
    yes: false,
    commandRunner
  });
} catch (error) {
  restoreRejected = String(error).includes("requires explicit confirmation");
}
assert(restoreRejected, "Restore must reject calls without yes=true.");

const restoreReport = await installer.restoreMindoryRuntimeBackup(home, backupReport.backupPath, {
  yes: true,
  commandRunner
});
assert(restoreReport.restored === true, "Restore must report restored=true when components are restored.");
assert(fs.readFileSync(path.join(home, "config", ".env"), "utf8").includes("MINDORY_STORAGE_PROVIDER=local-fs"), "Restore must restore config.");
assert(fs.readFileSync(path.join(home, "data", "objects", "documents", "raw.txt"), "utf8") === "raw object\n", "Restore must restore local object files.");
assert(commands.some((command) => command.includes("psql -U mindory -d mindory")), "Restore must run psql through Compose.");

const externalHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-backup-external-s3-"));
fs.mkdirSync(path.join(externalHome, "config"), { recursive: true });
fs.writeFileSync(path.join(externalHome, "config", ".env"), [
  `MINDORY_HOME=${externalHome}`,
  "MINDORY_STORAGE_PROVIDER=s3",
  "MINDORY_S3_ENDPOINT=https://s3.example.test",
  "MINDORY_S3_BUCKET=mindory"
].join("\n"));
const externalReport = await installer.createMindoryRuntimeBackup(externalHome, {
  includeConfig: false,
  includePostgres: false,
  commandRunner
});
assert(externalReport.components.some((component) => component.component === "external_s3" && component.status === "skipped"), "External S3 backup must be explicitly skipped with a reason.");

fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(externalHome, { recursive: true, force: true });

console.log("Backup and restore MVP validated.");
