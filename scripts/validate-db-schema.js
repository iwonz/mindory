import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "packages/db/src/schema.ts");
const relationsPath = path.join(root, "packages/db/src/relations.ts");
const migrationPath = path.join(root, "packages/db/drizzle/0000_initial_schema.sql");
const derivedMigrationPath = path.join(root, "packages/db/drizzle/0001_derived_artifact_schema.sql");
const routeJobMigrationPath = path.join(root, "packages/db/drizzle/0002_document_route_job.sql");
const recomputeJobMigrationPath = path.join(root, "packages/db/drizzle/0003_document_recompute_job.sql");
const artifactTextSearchMigrationPath = path.join(root, "packages/db/drizzle/0004_artifact_text_search.sql");
const drizzleConfigPath = path.join(root, "packages/db/drizzle.config.ts");

const requiredTables = [
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
  "processing_jobs",
  "processing_runs",
  "document_artifacts",
  "document_artifact_vectors",
  "document_artifact_text_spans",
  "document_media_metadata",
  "document_metadata_index",
  "face_identities",
  "face_observations"
];

const projectScopedTables = [
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
  "processing_jobs",
  "processing_runs",
  "document_artifacts",
  "document_artifact_vectors",
  "document_artifact_text_spans",
  "document_media_metadata",
  "document_metadata_index",
  "face_identities",
  "face_observations"
];

const requiredEnums = [
  "access_token_status",
  "peer_type",
  "session_status",
  "message_role",
  "document_status",
  "memory_claim_type",
  "memory_claim_status",
  "processing_job_type",
  "processing_job_status",
  "processing_run_status",
  "document_artifact_type",
  "face_identity_status"
];

const requiredIndexes = [
  "access_tokens_project_id_idx",
  "access_tokens_token_hash_idx",
  "access_token_project_scopes_project_id_idx",
  "peers_project_id_idx",
  "sessions_project_id_idx",
  "session_peers_peer_id_idx",
  "messages_session_created_at_idx",
  "messages_author_peer_id_idx",
  "documents_project_status_idx",
  "attachments_message_document_idx",
  "chunks_document_chunk_index_idx",
  "chunk_vector_embeddings_chunk_id_idx",
  "chunk_vector_embeddings_embedding_hnsw_idx",
  "memory_claims_project_status_idx",
  "memory_claims_source_refs_idx",
  "processing_jobs_idempotency_key_idx",
  "processing_jobs_type_status_idx",
  "processing_runs_project_document_idx",
  "document_artifacts_project_document_idx",
  "document_artifacts_source_refs_idx",
  "document_artifact_vectors_embedding_hnsw_idx",
  "document_artifact_text_spans_project_type_idx",
  "document_artifact_text_spans_content_fts_idx",
  "document_media_metadata_duration_idx",
  "document_metadata_index_key_number_idx",
  "face_identities_project_status_idx",
  "face_observations_embedding_hnsw_idx"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function tableBody(sql, tableName) {
  const marker = `CREATE TABLE ${tableName} (`;
  const start = sql.indexOf(marker);
  assert(start !== -1, `Migration must create ${tableName}.`);

  let depth = 0;
  for (let index = start + marker.length - 1; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return sql.slice(start + marker.length, index);
      }
    }
  }

  throw new Error(`Could not parse table body for ${tableName}.`);
}

assert(fs.existsSync(schemaPath), "packages/db/src/schema.ts is required.");
assert(fs.existsSync(relationsPath), "packages/db/src/relations.ts is required.");
assert(fs.existsSync(migrationPath), "packages/db/drizzle/0000_initial_schema.sql is required.");
assert(fs.existsSync(derivedMigrationPath), "packages/db/drizzle/0001_derived_artifact_schema.sql is required.");
assert(fs.existsSync(routeJobMigrationPath), "packages/db/drizzle/0002_document_route_job.sql is required.");
assert(fs.existsSync(recomputeJobMigrationPath), "packages/db/drizzle/0003_document_recompute_job.sql is required.");
assert(fs.existsSync(artifactTextSearchMigrationPath), "packages/db/drizzle/0004_artifact_text_search.sql is required.");
assert(fs.existsSync(drizzleConfigPath), "packages/db/drizzle.config.ts is required.");

const rootPackage = JSON.parse(read("package.json"));
const dbPackage = JSON.parse(read("packages/db/package.json"));
const schema = fs.readFileSync(schemaPath, "utf8");
const relations = fs.readFileSync(relationsPath, "utf8");
const migration = [
  fs.readFileSync(migrationPath, "utf8"),
  fs.readFileSync(derivedMigrationPath, "utf8"),
  fs.readFileSync(routeJobMigrationPath, "utf8"),
  fs.readFileSync(recomputeJobMigrationPath, "utf8"),
  fs.readFileSync(artifactTextSearchMigrationPath, "utf8")
].join("\n");
const drizzleConfig = fs.readFileSync(drizzleConfigPath, "utf8");

assert(rootPackage.scripts?.["db:validate"] === "node scripts/validate-db-schema.js", "Root package must expose db:validate.");
assert(dbPackage.dependencies?.["drizzle-orm"], "@mindory/db must depend on drizzle-orm.");
assert(dbPackage.dependencies?.pg, "@mindory/db must declare pg for PostgreSQL connectivity.");
assert(drizzleConfig.includes('dialect: "postgresql"'), "Drizzle config must use PostgreSQL.");
assert(drizzleConfig.includes('schema: "./src/schema.ts"'), "Drizzle config must point at src/schema.ts.");
assert(drizzleConfig.includes('out: "./drizzle"'), "Drizzle config must output migrations to ./drizzle.");
assert(migration.includes("CREATE EXTENSION IF NOT EXISTS vector"), "Migration must enable pgvector extension.");
assert(schema.includes("chunkVectorEmbeddings"), "Drizzle schema must define chunkVectorEmbeddings.");
assert(migration.includes("'document.route'"), "Migration must add document.route to processing_job_type.");
assert(migration.includes("'document.recompute'"), "Migration must add document.recompute to processing_job_type.");
assert(schema.includes('"document.route"'), "Drizzle schema must include document.route processing jobs.");
assert(schema.includes('"document.recompute"'), "Drizzle schema must include document.recompute processing jobs.");

for (const enumName of requiredEnums) {
  assert(migration.includes(`CREATE TYPE ${enumName}`), `Migration must create enum ${enumName}.`);
}

for (const tableName of requiredTables) {
  assert(migration.includes(`CREATE TABLE ${tableName}`), `Migration must create table ${tableName}.`);
  assert(schema.includes(`"${tableName}"`), `Drizzle schema must define ${tableName}.`);
  assert(relations.includes(tableName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/^accessTokens$/, "accessTokens")), `Relations should reference ${tableName}.`);
}

for (const tableName of projectScopedTables) {
  const body = tableBody(migration, tableName);
  assert(/\bproject_id\b/.test(body), `${tableName} must include project_id.`);
}

for (const indexName of requiredIndexes) {
  assert(migration.includes(indexName), `Migration must create index or constraint ${indexName}.`);
}

for (const jsonbColumn of ["source jsonb", "metadata jsonb", "source_refs jsonb", "created_source jsonb"]) {
  assert(migration.includes(jsonbColumn), `Migration must include ${jsonbColumn}.`);
}

assert(migration.includes("USING gin (source_refs)"), "source_refs must have a GIN index.");
assert(migration.includes("CHECK (importance >= 0 AND importance <= 1)"), "importance must be range checked.");
assert(migration.includes("CHECK (confidence >= 0 AND confidence <= 1)"), "confidence must be range checked.");
assert(migration.includes("text[] NOT NULL"), "Permissions must be stored as a text array.");
assert(migration.includes("embedding vector(1536) NOT NULL"), "Chunk vector embeddings must use pgvector.");
assert(migration.includes("USING hnsw (embedding vector_cosine_ops)"), "Chunk vector embeddings must have an HNSW cosine index.");
assert(migration.includes("embedding vector(512)"), "Face observations must support 512-dimensional face embeddings.");
assert(migration.includes("document_artifacts_has_payload"), "Document artifacts must require content, storage or source refs.");
assert(migration.includes("document_metadata_index_has_value"), "Document metadata index rows must require a typed value.");
assert(migration.includes("to_tsvector('simple', content)"), "Artifact text spans must have a full-text search index.");
assert(schema.includes("SourceRef"), "Schema must type SourceRef.");
assert(schema.includes("SourceSnapshot"), "Schema must type SourceSnapshot.");
assert(schema.includes("processingRuns"), "Schema must define processingRuns.");
assert(schema.includes("documentArtifacts"), "Schema must define documentArtifacts.");
assert(schema.includes("faceObservations"), "Schema must define faceObservations.");

console.log("Database schema scaffold validated.");
