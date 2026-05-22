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
  "createMindoryPostgresPitrBaseBackup",
  "restoreMindoryPostgresPitrBackup",
  "PostgresPitrBackupManifest",
  "EncryptedBackupArchiveManifest",
  "createEncryptedMindoryBackupArchive",
  "restoreEncryptedMindoryBackupArchive",
  "uploadEncryptedMindoryBackupArchive",
  "downloadEncryptedMindoryBackupArchive",
  "exportExternalS3ObjectInventory",
  "createExternalS3StreamingBackupArchive",
  "restoreExternalS3StreamingBackupArchive",
  "aes-256-gcm",
  "mindory-external-s3-streaming-backup",
  "runScheduledMindoryBackup",
  "ScheduledBackupHealth",
  "RuntimeBackupManifest",
  "pg_dump",
  "pg_basebackup",
  "pg_switch_wal",
  "psql",
  "backup-manifest.json",
  "pitr-manifest.json",
  "recovery_target_time",
  "postgres-wal",
  "scheduled-backup-health.json",
  "scheduled-backup.lock",
  "MINDORY_BACKUP_ENCRYPTION_KEY",
  "MINDORY_REMOTE_BACKUP_S3_ENDPOINT",
  "external_s3"
]) {
  assert(installerSource.includes(token), `Installer source must include ${token}.`);
}

for (const token of ["command === \"backup\"", "command === \"backup-archive\"", "command === \"backup-upload\"", "command === \"backup-download\"", "command === \"backup-restore-archive\"", "command === \"s3-inventory\"", "command === \"s3-backup\"", "command === \"s3-restore\"", "command === \"backup-schedule\"", "command === \"pitr-backup\"", "command === \"pitr-restore\"", "command === \"restore\"", "mindory-installer backup", "mindory-installer backup-archive", "mindory-installer backup-upload", "mindory-installer backup-download", "mindory-installer backup-restore-archive", "mindory-installer s3-inventory", "mindory-installer s3-backup", "mindory-installer s3-restore", "mindory-installer backup-schedule", "mindory-installer pitr-backup", "mindory-installer pitr-restore", "mindory-installer restore"]) {
  assert(installerCli.includes(token), `Installer CLI must expose ${token}.`);
}

for (const token of ["backup-manifest.json", "pitr-manifest.json", "pg_dump", "pg_basebackup", "restore --home", "backup-archive --home", "backup-upload --home", "backup-download --home", "backup-restore-archive --home", "s3-inventory --home", "s3-backup --home", "s3-restore --home", "backup-schedule --home", "pitr-backup --home", "pitr-restore --home", "scheduled-backup-health.json", "scheduled-backup.log", "MINDORY_BACKUP_RETENTION_COUNT", "MINDORY_POSTGRES_WAL_ARCHIVE_ENABLED", "MINDORY_REMOTE_BACKUP_ENABLED", "External S3-compatible bucket data"]) {
  assert(installerDocs.includes(token), `Installer docs must describe ${token}.`);
}
assert(productionDocs.includes("mindory-installer backup"), "Production hardening docs must use the installer backup command.");
assert(productionDocs.includes("mindory-installer backup-archive"), "Production hardening docs must use the encrypted backup archive command.");
assert(productionDocs.includes("mindory-installer s3-backup"), "Production hardening docs must use the external S3 streaming backup command.");
assert(productionDocs.includes("mindory-installer pitr-backup"), "Production hardening docs must use the PITR backup command.");
assert(productionDocs.includes("MINDORY_BACKUP_SCHEDULE_ENABLED"), "Production hardening docs must document scheduled backup config.");
assert(productionDocs.includes("MINDORY_REMOTE_BACKUP_S3_ENDPOINT"), "Production hardening docs must document remote backup config.");
assert(productionDocs.includes("recovery_target_time"), "Production hardening docs must document PITR target-time recovery.");

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
    const restoreVolume = args.find((entry) => typeof entry === "string" && entry.endsWith(":/restore"));
    if (typeof restoreVolume === "string") {
      const restorePath = restoreVolume.slice(0, -":/restore".length);
      fs.mkdirSync(restorePath, { recursive: true });
      fs.writeFileSync(path.join(restorePath, "postgresql.auto.conf"), "restore_command = 'cp /wal-archive/%f %p'\nrecovery_target_time = '2026-05-22T12:00:00.000Z'\n");
      fs.writeFileSync(path.join(restorePath, "recovery.signal"), "");
    }
    const cpIndex = args.indexOf("cp");
    if (cpIndex !== -1) {
      const source = args[cpIndex + 1];
      const target = args[cpIndex + 2];
      if (typeof source === "string" && source.startsWith("postgres:") && typeof target === "string") {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (source.includes("mindory-pitr-base")) {
          fs.mkdirSync(target, { recursive: true });
          fs.writeFileSync(path.join(target, "base.tar.gz"), "base tar fixture\n");
          fs.writeFileSync(path.join(target, "pg_wal.tar.gz"), "wal tar fixture\n");
        } else {
          fs.writeFileSync(target, "-- mindory pg_dump fixture\n");
        }
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

const encryptionKey = "validator-backup-encryption-key";
const archiveReport = await installer.createEncryptedMindoryBackupArchive(home, backupReport.backupPath, {
  encryptionKey,
  keyId: "validator-key"
});
assert(fs.existsSync(archiveReport.archivePath), "Encrypted backup archive must be written.");
assert(archiveReport.filesCount > 0, "Encrypted backup archive must include backed-up files.");
const archiveText = fs.readFileSync(archiveReport.archivePath, "utf8");
assert(archiveText.includes("aes-256-gcm"), "Encrypted backup archive must declare AES-GCM encryption.");
assert(!archiveText.includes(encryptionKey), "Encrypted backup archive must not contain the raw encryption key.");
assert(!archiveText.includes("validator-secret"), "Encrypted backup archive must not contain remote backup secrets.");

let encryptedRestoreRejected = false;
try {
  await installer.restoreEncryptedMindoryBackupArchive(home, archiveReport.archivePath, {
    yes: false,
    encryptionKey
  });
} catch (error) {
  encryptedRestoreRejected = String(error).includes("requires explicit confirmation");
}
assert(encryptedRestoreRejected, "Encrypted backup archive restore must reject calls without yes=true.");

const decryptedOutputDirectory = path.join(home, "backups", "decrypted-validator");
const decryptedReport = await installer.restoreEncryptedMindoryBackupArchive(home, archiveReport.archivePath, {
  yes: true,
  encryptionKey,
  outputDirectory: decryptedOutputDirectory
});
assert(fs.existsSync(path.join(decryptedReport.outputDirectory, "backup-manifest.json")), "Encrypted archive restore must recreate backup-manifest.json.");
assert(fs.existsSync(path.join(decryptedReport.outputDirectory, "objects", "documents", "raw.txt")), "Encrypted archive restore must recreate object files.");
const decryptedRestoreReport = await installer.restoreMindoryRuntimeBackup(home, decryptedReport.outputDirectory, {
  yes: true,
  restorePostgres: false,
  commandRunner
});
assert(decryptedRestoreReport.restored === true, "Decrypted archive output must be restorable through the normal runtime restore command.");

fs.appendFileSync(path.join(home, "config", ".env"), [
  "",
  "MINDORY_REMOTE_BACKUP_ENABLED=true",
  "MINDORY_BACKUP_ENCRYPTION_KEY_ID=validator-key",
  `MINDORY_BACKUP_ENCRYPTION_KEY=${encryptionKey}`,
  "MINDORY_REMOTE_BACKUP_S3_ENDPOINT=http://s3.example.test",
  "MINDORY_REMOTE_BACKUP_S3_REGION=us-east-1",
  "MINDORY_REMOTE_BACKUP_S3_BUCKET=mindory-backups",
  "MINDORY_REMOTE_BACKUP_S3_ACCESS_KEY_ID=remote-access",
  "MINDORY_REMOTE_BACKUP_S3_SECRET_ACCESS_KEY=remote-secret",
  "MINDORY_REMOTE_BACKUP_S3_FORCE_PATH_STYLE=true",
  "MINDORY_REMOTE_BACKUP_S3_PREFIX=mindory-validator"
].join("\n"));
const remoteBackupFetch = createInMemoryS3Fetch();
const uploadReport = await installer.uploadEncryptedMindoryBackupArchive(home, archiveReport.archivePath, {
  s3FetchImpl: remoteBackupFetch
});
assert(uploadReport.objectKey.startsWith("mindory-validator/"), "Remote backup upload must use the configured prefix.");
assert(uploadReport.bucket === "mindory-backups", "Remote backup upload must use the configured bucket.");
const downloadReport = await installer.downloadEncryptedMindoryBackupArchive(home, {
  objectKey: uploadReport.objectKey,
  s3FetchImpl: remoteBackupFetch
});
assert(fs.existsSync(downloadReport.outputFile), "Remote backup download must write the archive locally.");
assert(downloadReport.sha256 === uploadReport.sha256, "Remote backup download must preserve archive checksum.");
const remoteDecryptedReport = await installer.restoreEncryptedMindoryBackupArchive(home, downloadReport.outputFile, {
  yes: true,
  encryptionKey,
  outputDirectory: path.join(home, "backups", "decrypted-remote-validator")
});
assert(fs.existsSync(remoteDecryptedReport.sourceBackupManifestPath), "Downloaded encrypted archive must decrypt to a verifiable backup manifest.");

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

const pitrDryRun = await installer.createMindoryPostgresPitrBaseBackup(home, {
  dryRun: true,
  commandRunner
});
assert(pitrDryRun.dryRun === true, "PITR base backup dry-run must report dryRun=true.");
assert(!fs.existsSync(pitrDryRun.backupPath), "PITR dry-run must not create the backup directory.");

const pitrReport = await installer.createMindoryPostgresPitrBaseBackup(home, {
  label: "validator",
  commandRunner
});
assert(fs.existsSync(pitrReport.manifestPath), "PITR base backup must write pitr-manifest.json.");
assert(fs.existsSync(path.join(pitrReport.baseBackupPath, "base.tar.gz")), "PITR base backup must copy base.tar.gz out of Postgres.");
assert(fs.existsSync(path.join(home, "backups", "postgres-wal")), "PITR base backup must ensure the WAL archive directory under MINDORY_HOME.");
assert(commands.some((command) => command.includes("pg_basebackup")), "PITR backup must run pg_basebackup through Compose.");
assert(commands.some((command) => command.includes("pg_switch_wal")), "PITR backup must switch WAL after the base backup.");

let pitrRestoreRejected = false;
try {
  await installer.restoreMindoryPostgresPitrBackup(home, pitrReport.backupPath, {
    yes: false,
    targetTime: "2026-05-22T12:00:00.000Z",
    commandRunner
  });
} catch (error) {
  pitrRestoreRejected = String(error).includes("requires explicit confirmation");
}
assert(pitrRestoreRejected, "PITR restore must reject calls without yes=true.");

const pitrRestoreReport = await installer.restoreMindoryPostgresPitrBackup(home, pitrReport.backupPath, {
  yes: true,
  targetTime: "2026-05-22T12:00:00.000Z",
  commandRunner
});
assert(pitrRestoreReport.targetTime === "2026-05-22T12:00:00.000Z", "PITR restore must normalize and report the target time.");
assert(fs.existsSync(pitrRestoreReport.recoveryConfigPath), "PITR restore must stage postgresql.auto.conf.");
assert(fs.existsSync(pitrRestoreReport.recoverySignalPath), "PITR restore must stage recovery.signal.");
assert(fs.readFileSync(pitrRestoreReport.recoveryConfigPath, "utf8").includes("recovery_target_time"), "PITR restore config must include recovery_target_time.");
assert(commands.some((command) => command.includes("-v") && command.includes(":/wal-archive:ro")), "PITR restore must mount the WAL archive read-only.");

fs.mkdirSync(path.join(home, "data", "postgres"), { recursive: true });
fs.writeFileSync(path.join(home, "data", "postgres", "PG_VERSION"), "16\n");
const pitrReplaceReport = await installer.restoreMindoryPostgresPitrBackup(home, pitrReport.backupPath, {
  yes: true,
  targetTime: new Date("2026-05-22T12:30:00.000Z"),
  replaceLiveData: true,
  commandRunner
});
assert(pitrReplaceReport.replacedLiveData === true, "PITR restore must support explicit live data replacement.");
assert(pitrReplaceReport.liveDataBackupPath !== undefined && fs.existsSync(pitrReplaceReport.liveDataBackupPath), "PITR live replacement must back up existing Postgres data first.");
assert(fs.existsSync(path.join(home, "data", "postgres", "recovery.signal")), "PITR live replacement must replace Postgres data with the staged recovery directory.");
assert(commands.some((command) => command.includes("compose") && command.includes("down")), "PITR live replacement must stop the Compose stack first.");

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

fs.writeFileSync(path.join(externalHome, "config", ".env"), [
  `MINDORY_HOME=${externalHome}`,
  "MINDORY_STORAGE_PROVIDER=s3",
  "MINDORY_S3_ENDPOINT=http://s3.example.test",
  "MINDORY_S3_REGION=us-east-1",
  "MINDORY_S3_BUCKET=mindory",
  "MINDORY_S3_ACCESS_KEY_ID=external-access",
  "MINDORY_S3_SECRET_ACCESS_KEY=external-secret",
  "MINDORY_S3_FORCE_PATH_STYLE=true",
  "MINDORY_BACKUP_ENCRYPTION_KEY_ID=external-key",
  "MINDORY_BACKUP_ENCRYPTION_KEY=external-encryption-key"
].join("\n"));
const externalS3Fetch = createInMemoryS3Fetch([
  {
    bucket: "mindory",
    key: "documents/a.txt",
    body: Buffer.from("alpha external object\n"),
    contentType: "text/plain",
    metadata: { source: "validator" }
  },
  {
    bucket: "mindory",
    key: "documents/b.txt",
    body: Buffer.from("beta external object\n"),
    contentType: "text/plain",
    metadata: { source: "validator" }
  }
]);
const directExternalListProbe = await externalS3Fetch("http://s3.example.test/mindory?list-type=2&prefix=documents%2F&max-keys=1", {
  method: "GET",
  headers: new Headers()
});
assert((await directExternalListProbe.text()).includes("documents/a.txt"), "External S3 fake must list seeded objects.");
const externalInventory = await installer.exportExternalS3ObjectInventory(externalHome, {
  prefix: "documents/",
  pageSize: 1,
  s3FetchImpl: externalS3Fetch
});
assert(externalInventory.object_count === 2, "External S3 inventory must list objects from S3-compatible storage.");
assert(externalInventory.page_count === 2, "External S3 inventory must support paginated listing.");
assert(externalInventory.objects.every((object) => object.metadata.source === "validator"), "External S3 inventory must preserve metadata from object HEAD calls.");
const streamingProgress = [];
const externalStreamingReport = await installer.createExternalS3StreamingBackupArchive(externalHome, {
  prefix: "documents/",
  pageSize: 1,
  encryptionKey: "external-encryption-key",
  keyId: "external-key",
  s3FetchImpl: externalS3Fetch,
  progressSink: (event) => streamingProgress.push(event)
});
assert(fs.existsSync(externalStreamingReport.archivePath), "External S3 streaming backup must write an encrypted archive.");
assert(externalStreamingReport.objectCount === 2, "External S3 streaming backup must include all listed objects.");
assert(streamingProgress.some((event) => event.phase === "inventory_page"), "External S3 streaming backup must report paginated progress.");
assert(streamingProgress.some((event) => event.phase === "archive_completed"), "External S3 streaming backup must report completion progress.");

const externalRestoreHome = fs.mkdtempSync(path.join(os.tmpdir(), "mindory-backup-external-s3-restore-"));
fs.mkdirSync(path.join(externalRestoreHome, "config"), { recursive: true });
fs.writeFileSync(path.join(externalRestoreHome, "config", ".env"), [
  `MINDORY_HOME=${externalRestoreHome}`,
  "MINDORY_STORAGE_PROVIDER=s3",
  "MINDORY_S3_ENDPOINT=http://s3.example.test",
  "MINDORY_S3_REGION=us-east-1",
  "MINDORY_S3_BUCKET=mindory",
  "MINDORY_S3_ACCESS_KEY_ID=external-access",
  "MINDORY_S3_SECRET_ACCESS_KEY=external-secret",
  "MINDORY_S3_FORCE_PATH_STYLE=true",
  "MINDORY_BACKUP_ENCRYPTION_KEY_ID=external-key",
  "MINDORY_BACKUP_ENCRYPTION_KEY=external-encryption-key"
].join("\n"));
const externalRestoreFetch = createInMemoryS3Fetch();
let streamingRestoreRejected = false;
try {
  await installer.restoreExternalS3StreamingBackupArchive(externalRestoreHome, externalStreamingReport.archivePath, {
    yes: false,
    encryptionKey: "external-encryption-key",
    s3FetchImpl: externalRestoreFetch
  });
} catch (error) {
  streamingRestoreRejected = String(error).includes("requires explicit confirmation");
}
assert(streamingRestoreRejected, "External S3 streaming restore must require explicit confirmation.");
const externalRestoreReport = await installer.restoreExternalS3StreamingBackupArchive(externalRestoreHome, externalStreamingReport.archivePath, {
  yes: true,
  encryptionKey: "external-encryption-key",
  s3FetchImpl: externalRestoreFetch
});
assert(externalRestoreReport.objectCount === 2, "External S3 streaming restore must restore archived objects.");
const restoredInventory = await installer.exportExternalS3ObjectInventory(externalRestoreHome, {
  prefix: "documents/",
  pageSize: 10,
  s3FetchImpl: externalRestoreFetch
});
assert(restoredInventory.object_count === 2, "External S3 streaming restore must recreate object keys.");
assert(restoredInventory.objects.some((object) => object.key === "documents/a.txt"), "External S3 streaming restore must preserve source keys.");
assert(restoredInventory.objects.every((object) => object.metadata.source === "validator"), "External S3 streaming restore must preserve object metadata.");

fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(externalHome, { recursive: true, force: true });
fs.rmSync(externalRestoreHome, { recursive: true, force: true });

console.log("Backup and restore MVP validated.");

function createInMemoryS3Fetch(initialObjects = []) {
  const buckets = new Set();
  const objects = new Map();
  for (const object of initialObjects) {
    buckets.add(object.bucket);
    objects.set(`${object.bucket}/${object.key}`, {
      body: Buffer.from(object.body),
      contentType: object.contentType,
      metadata: object.metadata ?? {},
      etag: object.etag ?? `etag-${Buffer.from(object.body).length}`
    });
  }
  return async (url, init = {}) => {
    const method = init.method ?? "GET";
    const parsed = new URL(String(url));
    const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const bucket = parts[0];
    const key = parts.slice(1).join("/");
    if (bucket === undefined) {
      return new Response("missing bucket", { status: 400 });
    }
    if (key === "") {
      if (method === "HEAD") {
        return new Response("", { status: buckets.has(bucket) ? 200 : 404 });
      }
      if (method === "GET" && parsed.searchParams.get("list-type") === "2") {
        const prefix = parsed.searchParams.get("prefix") ?? "";
        const maxKeys = Number.parseInt(parsed.searchParams.get("max-keys") ?? "1000", 10);
        const continuationToken = parsed.searchParams.get("continuation-token");
        const sorted = Array.from(objects.entries())
          .filter(([objectId]) => objectId.startsWith(`${bucket}/`))
          .map(([objectId, object]) => [objectId.slice(bucket.length + 1), object])
          .filter(([objectKey]) => objectKey.startsWith(prefix))
          .sort(([left], [right]) => left.localeCompare(right));
        const startIndex = continuationToken === null ? 0 : Math.max(sorted.findIndex(([objectKey]) => objectKey === continuationToken) + 1, 0);
        const page = sorted.slice(startIndex, startIndex + maxKeys);
        const next = sorted.length > startIndex + maxKeys ? page.at(-1)?.[0] : undefined;
        return new Response(renderS3ListObjectsResponse(page, next), {
          status: 200,
          headers: { "content-type": "application/xml" }
        });
      }
      if (method === "PUT") {
        buckets.add(bucket);
        return new Response("", { status: 200 });
      }
      return new Response("unsupported bucket method", { status: 405 });
    }
    if (!buckets.has(bucket)) {
      return new Response("bucket missing", { status: 404 });
    }
    const objectId = `${bucket}/${key}`;
    if (method === "PUT") {
      const body = await requestBodyBuffer(init.body);
      const headers = new Headers(init.headers);
      const metadata = {};
      for (const [name, value] of headers) {
        if (name.startsWith("x-amz-meta-")) {
          metadata[name.slice("x-amz-meta-".length)] = value;
        }
      }
      objects.set(objectId, {
        body,
        contentType: headers.get("content-type") ?? "application/octet-stream",
        metadata,
        etag: `etag-${body.length}`
      });
      return new Response("", { status: 200, headers: { etag: `"etag-${body.length}"` } });
    }
    const stored = objects.get(objectId);
    if (stored === undefined) {
      return new Response("object missing", { status: 404 });
    }
    const headers = new Headers({
      "content-length": String(stored.body.length),
      "content-type": stored.contentType,
      etag: `"${stored.etag}"`
    });
    for (const [name, value] of Object.entries(stored.metadata)) {
      headers.set(`x-amz-meta-${name}`, value);
    }
    if (method === "HEAD") {
      return new Response("", { status: 200, headers });
    }
    if (method === "GET") {
      return new Response(stored.body, { status: 200, headers });
    }
    return new Response("unsupported object method", { status: 405 });
  };
}

function renderS3ListObjectsResponse(entries, nextContinuationToken) {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<ListBucketResult>",
    `<IsTruncated>${nextContinuationToken === undefined ? "false" : "true"}</IsTruncated>`,
    ...entries.map(([key, object]) => [
      "<Contents>",
      `<Key>${escapeXml(key)}</Key>`,
      "<LastModified>2026-05-22T00:00:00.000Z</LastModified>",
      `<ETag>&quot;${escapeXml(object.etag)}&quot;</ETag>`,
      `<Size>${object.body.length}</Size>`,
      "</Contents>"
    ].join("")),
    nextContinuationToken === undefined ? "" : `<NextContinuationToken>${escapeXml(nextContinuationToken)}</NextContinuationToken>`,
    "</ListBucketResult>"
  ].join("");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

async function requestBodyBuffer(body) {
  if (body === undefined || body === null) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  return Buffer.from(await new Response(body).arrayBuffer());
}
