import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.MINDORY_DATABASE_URL ?? "postgresql://mindory:mindory@localhost:5432/mindory";

const migrations = [
  {
    id: "0000_initial_schema",
    expectedTables: [
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
    ]
  },
  {
    id: "0001_derived_artifact_schema",
    expectedTables: [
      "processing_runs",
      "document_artifacts",
      "document_artifact_vectors",
      "document_artifact_text_spans",
      "document_media_metadata",
      "document_metadata_index",
      "face_identities",
      "face_observations"
    ]
  }
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

async function readAppliedMigration(client, migrationId) {
  const result = await client.query("SELECT checksum FROM mindory_migrations WHERE id = $1", [migrationId]);
  return result.rows[0]?.checksum ?? null;
}

async function listExistingTables(client, expectedTables) {
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

async function recordMigration(client, migrationId, checksum) {
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

async function readMigration(migrationId) {
  const sql = await readFile(path.join(packageRoot, "drizzle", `${migrationId}.sql`), "utf8");
  return {
    sql,
    checksum: createHash("sha256").update(sql).digest("hex")
  };
}

async function applyMigration(client, migration) {
  const { sql, checksum } = await readMigration(migration.id);
  const appliedChecksum = await readAppliedMigration(client, migration.id);
  if (appliedChecksum) {
    if (appliedChecksum !== checksum) {
      throw new Error(`Migration ${migration.id} checksum mismatch. Refusing to continue.`);
    }

    console.log(`Migration ${migration.id} already applied.`);
    return;
  }

  const existingTables = await listExistingTables(client, migration.expectedTables);
  if (existingTables.size > 0) {
    const missingTables = migration.expectedTables.filter((tableName) => !existingTables.has(tableName));
    if (missingTables.length > 0) {
      throw new Error(`Partial schema for migration ${migration.id} detected. Missing tables: ${missingTables.join(", ")}`);
    }

    await recordMigration(client, migration.id, checksum);
    console.log(`Recorded existing schema as ${migration.id}.`);
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await recordMigration(client, migration.id, checksum);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  console.log(`Applied migration ${migration.id}.`);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    await ensureMigrationTable(client);
    for (const migration of migrations) {
      await applyMigration(client, migration);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
