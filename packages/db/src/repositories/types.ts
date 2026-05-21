import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";

export type MindoryDatabase = NodePgDatabase<typeof schema>;

export class DbRepositoryError extends Error {
  readonly code: "not_found";

  constructor(message: string) {
    super(message);
    this.name = "DbRepositoryError";
    this.code = "not_found";
  }
}

export function firstOrThrow<T>(rows: T[], message: string): T {
  const row = rows[0];
  if (!row) {
    throw new DbRepositoryError(message);
  }
  return row;
}
