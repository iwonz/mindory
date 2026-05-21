import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationId = "0000_initial_schema";
const migrationPath = path.join(packageRoot, "drizzle", `${migrationId}.sql`);
const databaseUrl = process.env.MINDORY_DATABASE_URL ?? "postgresql://mindory:mindory@localhost:5432/mindory";

const expectedTables = [
  "projects",
  "access_tokens",
  "access_token_project_scopes",
  "peers",
  "sessions",
  "session_peers",
  "messages",
  "documents",
  "attachments",
  "chunks",
  "chunk_vector_embeddings",
  "memory_claims",
  "processing_jobs"
];

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mindory_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readAppliedMigration(client) {
  const result = await client.query("SELECT checksum FROM mindory_migrations WHERE id = $1", [migrationId]);
  return result.rows[0]?.checksum ?? null;
}

async function listExistingTables(client) {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [expectedTables]
  );

  return new Set(result.rows.map((row) => row.table_name));
}

async function recordMigration(client, checksum) {
  await client.query(
    `
      INSERT INTO mindory_migrations (id, checksum)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE
      SET checksum = EXCLUDED.checksum,
          applied_at = now()
    `,
    [migrationId, checksum]
  );
}

async function main() {
  const sql = await readFile(migrationPath, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    await ensureMigrationTable(client);

    const appliedChecksum = await readAppliedMigration(client);
    if (appliedChecksum) {
      if (appliedChecksum !== checksum) {
        throw new Error(`Migration ${migrationId} checksum mismatch. Refusing to continue.`);
      }

      console.log(`Migration ${migrationId} already applied.`);
      return;
    }

    const existingTables = await listExistingTables(client);
    if (existingTables.size > 0) {
      const missingTables = expectedTables.filter((tableName) => !existingTables.has(tableName));
      if (missingTables.length > 0) {
        throw new Error(`Partial baseline schema detected. Missing tables: ${missingTables.join(", ")}`);
      }

      await recordMigration(client, checksum);
      console.log(`Recorded existing baseline schema as ${migrationId}.`);
      return;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await recordMigration(client, checksum);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(`Applied migration ${migrationId}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
