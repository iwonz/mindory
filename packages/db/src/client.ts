import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import type { MindoryDatabase } from "./repositories/types.js";

export interface MindoryDatabaseClient {
  db: MindoryDatabase;
  pool: Pool;
  close(): Promise<void>;
}

export function createMindoryDatabaseClient(databaseUrl: string): MindoryDatabaseClient {
  const pool = new Pool({
    connectionString: databaseUrl
  });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async close() {
      await pool.end();
    }
  };
}
