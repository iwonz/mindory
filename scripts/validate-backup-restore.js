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
  "runScheduledMindoryBackup",
  "ScheduledBackupHealth",
  "RuntimeBackupManifest",
  "pg_dump",
  "psql",
  "backup-manifest.json",
  "scheduled-backup-health.json",
  "scheduled-backup.lock",
  "external_s3"
]) {
  assert(installerSource.includes(token), `Installer source must include ${token}.`);
}

for (const token of ["command === \"backup\"", "command === \"backup-schedule\"", "command === \"restore\"", "mindory-installer backup", "mindory-installer backup-schedule", "mindory-installer restore"]) {
  assert(installerCli.includes(token), `Installer CLI must expose ${token}.`);
}

for (const token of ["backup-manifest.json", "pg_dump", "restore --home", "backup-schedule --home", "scheduled-backup-health.json", "scheduled-backup.log", "MINDORY_BACKUP_RETENTION_COUNT", "External S3-compatible bucket data"]) {
  assert(installerDocs.includes(token), `Installer docs must describe ${token}.`);
}
assert(productionDocs.includes("mindory-installer backup"), "Production hardening docs must use the installer backup command.");
assert(productionDocs.includes("MINDORY_BACKUP_SCHEDULE_ENABLED"), "Production hardening docs must document scheduled backup config.");
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

function writeBackupFixture(directoryName, createdAt) {
  const backupPath = path.join(home, "backups", directoryName);
  fs.mkdirSync(backupPath, { recursive: true });
  fs.writeFileSync(path.join(backupPath, "backup-manifest.json"), `${JSON.stringify({
    schema_version: 1,
    kind: "mindory-runtime-backup",
    created_at: createdAt,
    mindory_home: home,
    storage: { provider: "local-fs" },
    components: []
  }, null, 2)}\n`);
  return backupPath;
}

const oldScheduledBackup = writeBackupFixture("2026-01-01T00-00-00-old-scheduled", "2026-01-01T00:00:00.000Z");
const recentScheduledBackup = writeBackupFixture("2026-05-21T00-00-00-recent-scheduled", "2026-05-21T00:00:00.000Z");
fs.writeFileSync(path.join(home, "config", ".env"), [
  `MINDORY_HOME=${home}`,
  "MINDORY_PUBLIC_URL=http://localhost:3000",
  "MINDORY_DATABASE_URL=postgresql://mindory:mindory@postgres:5432/mindory",
  "MINDORY_STORAGE_PROVIDER=local-fs",
  "MINDORY_STORAGE_LOCAL_PATH=/data/mindory/objects",
  "MINDORY_BACKUP_SCHEDULE_ENABLED=true",
  "MINDORY_BACKUP_SCHEDULE_INTERVAL_MINUTES=60",
  "MINDORY_BACKUP_RETENTION_COUNT=1",
  "MINDORY_BACKUP_RETENTION_DAYS=30",
  "MINDORY_BACKUP_INCLUDE_CONFIG=true",
  "MINDORY_BACKUP_INCLUDE_POSTGRES=false",
  "MINDORY_BACKUP_INCLUDE_OBJECTS=true"
].join("\n"));
fs.writeFileSync(path.join(home, "data", "objects", "documents", "raw.txt"), "scheduled raw object\n");

const scheduledReport = await installer.runScheduledMindoryBackup(home, {
  force: true,
  now: new Date("2026-05-22T00:00:00.000Z"),
  commandRunner
});
assert(scheduledReport.status === "backed_up", "Scheduled backup must create a backup when forced.");
assert(fs.existsSync(scheduledReport.healthPath), "Scheduled backup must write health status.");
assert(fs.existsSync(scheduledReport.logPath), "Scheduled backup must append a log record.");
assert(!fs.existsSync(scheduledReport.lockPath), "Scheduled backup must remove its lock after completion.");
assert(scheduledReport.health.last_success_at === "2026-05-22T00:00:00.000Z", "Scheduled backup health must record last success.");
assert(scheduledReport.health.next_run_at === "2026-05-22T01:00:00.000Z", "Scheduled backup health must record next run.");
assert(scheduledReport.health.last_backup_path === scheduledReport.backup.backupPath, "Scheduled backup health must point at the latest backup.");
assert(fs.existsSync(path.join(scheduledReport.backup.backupPath, "backup-manifest.json")), "Scheduled backup must contain a runtime manifest.");
assert(fs.existsSync(path.join(scheduledReport.backup.backupPath, "objects", "documents", "raw.txt")), "Scheduled backup must copy local object files.");
assert(!fs.existsSync(path.join(scheduledReport.backup.backupPath, "postgres", "mindory.sql")), "Scheduled backup config must be able to skip PostgreSQL dumps.");
assert(scheduledReport.retention.deleted.includes(path.resolve(oldScheduledBackup)), "Retention must delete old scheduled backups.");
assert(scheduledReport.retention.deleted.includes(path.resolve(recentScheduledBackup)), "Retention count must delete extra old backups.");
assert(fs.existsSync(path.join(home, "data", "objects", "documents", "raw.txt")), "Retention must not delete active object storage.");

const skippedScheduledReport = await installer.runScheduledMindoryBackup(home, {
  now: new Date("2026-05-22T00:30:00.000Z"),
  commandRunner
});
assert(skippedScheduledReport.status === "skipped_not_due", "Scheduled backup must skip before next_run_at.");

fs.writeFileSync(path.join(home, "backups", "scheduled-backup.lock"), "{\"pid\":1}\n");
const lockedScheduledReport = await installer.runScheduledMindoryBackup(home, {
  force: true,
  now: new Date("2026-05-22T02:00:00.000Z"),
  commandRunner
});
assert(lockedScheduledReport.status === "already_running", "Scheduled backup must not run when the lock exists.");
fs.rmSync(path.join(home, "backups", "scheduled-backup.lock"), { force: true });

fs.writeFileSync(path.join(home, "config", ".env"), "MINDORY_HOME=changed-again\n");
fs.writeFileSync(path.join(home, "data", "objects", "documents", "raw.txt"), "changed scheduled\n");
const scheduledRestoreReport = await installer.restoreMindoryRuntimeBackup(home, scheduledReport.backup.backupPath, {
  yes: true,
  restorePostgres: false,
  commandRunner
});
assert(scheduledRestoreReport.restored === true, "Scheduled backup output must be restorable.");
assert(fs.readFileSync(path.join(home, "config", ".env"), "utf8").includes("MINDORY_BACKUP_SCHEDULE_ENABLED=true"), "Scheduled restore must restore backup config.");
assert(fs.readFileSync(path.join(home, "data", "objects", "documents", "raw.txt"), "utf8") === "scheduled raw object\n", "Scheduled restore must restore object files.");

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
