import { createHash } from "node:crypto";
import pg from "../packages/db/node_modules/pg/lib/index.js";

const { Client } = pg;

const databaseUrl = process.env.MINDORY_DATABASE_URL ?? "postgresql://mindory:mindory@localhost:5432/mindory";
const projectId = requiredEnv("MINDORY_INITIAL_PROJECT_ID");
const projectName = process.env.MINDORY_INITIAL_PROJECT_NAME ?? "Mindory Default";
const token = requiredEnv("MINDORY_INITIAL_TOKEN");
const tokenId = requiredEnv("MINDORY_INITIAL_TOKEN_ID");

const permissions = [
  "project:read",
  "token:read",
  "token:write",
  "session:read",
  "session:write",
  "message:read",
  "message:write",
  "document:read",
  "document:write",
  "document:search",
  "face:read",
  "face:write",
  "memory:read",
  "memory:write",
  "memory:delete",
  "context:build"
];

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("begin");
  await client.query(
    `
      insert into projects (id, name, metadata)
      values ($1, $2, $3::jsonb)
      on conflict (id) do update set
        name = excluded.name,
        metadata = projects.metadata || excluded.metadata,
        updated_at = now()
    `,
    [projectId, projectName, JSON.stringify({ installer: true })]
  );
  await client.query(
    `
      insert into access_tokens (id, project_id, name, token_hash, status, metadata)
      values ($1, $2, $3, $4, 'active', $5::jsonb)
      on conflict (id) do update set
        project_id = excluded.project_id,
        name = excluded.name,
        token_hash = excluded.token_hash,
        status = 'active',
        metadata = access_tokens.metadata || excluded.metadata,
        updated_at = now()
    `,
    [tokenId, projectId, "Initial installer token", hashAccessToken(token), JSON.stringify({ installer: true })]
  );
  await client.query(
    `
      insert into access_token_project_scopes (token_id, project_id, permissions)
      values ($1, $2, $3::text[])
      on conflict (token_id, project_id) do update set
        permissions = excluded.permissions
    `,
    [tokenId, projectId, permissions]
  );
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}

console.log(JSON.stringify({
  project_id: projectId,
  token_id: tokenId,
  api_url: process.env.MINDORY_PUBLIC_URL ?? process.env.MINDORY_E2E_API_URL ?? "http://localhost:3000"
}, null, 2));

function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function hashAccessToken(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
