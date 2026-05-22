import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "apps/cli/src/args.ts",
  "apps/cli/src/commands.ts",
  "apps/cli/src/http-client.ts",
  "apps/cli/src/index.ts",
  "apps/cli/src/run.ts",
  "scripts/smoke-cli.js"
];

const expectedCommandTokens = [
  "project:create",
  "project:get",
  "project:list",
  "token:create",
  "token:list",
  "token:revoke",
  "token:rotate",
  "session:create",
  "session:get",
  "session:list",
  "message:add",
  "message:list",
  "document:upload",
  "document:status",
  "document:reprocess",
  "document:recompute",
  "document:runs",
  "document:search",
  "document:read",
  "document:list",
  "artifact:search",
  "search:query",
  "face:identities",
  "face:identity",
  "face:observations",
  "face:rename",
  "face:merge",
  "memory:remember",
  "memory:recall",
  "memory:explain",
  "memory:forget",
  "memory:list",
  "context:build",
  "jobs:get",
  "jobs:list",
  "jobs:retry"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `${file} is required.`);
}

const rootPackage = readJson("package.json");
const cliPackage = readJson("apps/cli/package.json");
const args = read("apps/cli/src/args.ts");
const commands = read("apps/cli/src/commands.ts");
const httpClient = read("apps/cli/src/http-client.ts");
const index = read("apps/cli/src/index.ts");
const run = read("apps/cli/src/run.ts");
const smoke = read("scripts/smoke-cli.js");
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");

assert(rootPackage.scripts?.["cli:validate"] === "node scripts/validate-cli.js", "Root package must expose cli:validate.");
assert(rootPackage.scripts?.["cli:smoke"] === "node scripts/smoke-cli.js", "Root package must expose cli:smoke.");
assert(cliPackage.bin?.mindory === "./dist/index.js", "@mindory/cli must expose the mindory binary.");
assert(cliPackage.exports?.["."], "@mindory/cli must export its root module.");
assert(cliPackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/cli must depend on @mindory/config.");

for (const symbol of ["parseCliArgs", "readFlag", "readFlagValues", "readBooleanFlag"]) {
  assert(args.includes(symbol), `CLI args module must define ${symbol}.`);
}

for (const commandToken of expectedCommandTokens) {
  assert(commands.includes(`"${commandToken}"`), `CLI commands must include ${commandToken}.`);
}

for (const route of [
  "/v1/projects",
  "/v1/tokens",
  "/v1/sessions",
  "/v1/documents",
  "/processing-runs",
  "/recompute",
  "/v1/documents/search",
  "/v1/artifacts/search",
  "/v1/search",
  "/v1/faces/identities",
  "/v1/faces/observations",
  "/v1/memories",
  "/v1/memories/search",
  "/v1/context/build",
  "/v1/jobs"
]) {
  assert(commands.includes(route), `CLI commands must call ${route}.`);
}

assert(commands.includes("--source-ref <type:id>"), "CLI help must document memory source refs.");
assert(commands.includes("sourceRefs: readSourceRefs(parsed)"), "memory remember must send sourceRefs.");
assert(commands.includes("readProjectIds"), "CLI must support project/project list parsing.");
assert(commands.includes("tokenBudget"), "context build must send tokenBudget.");
assert(commands.includes("jobs retry"), "CLI help must document job retry.");
assert(commands.includes("jobs get"), "CLI help must document job get.");
assert(commands.includes("artifact search"), "CLI help must document artifact search.");
assert(commands.includes("search query"), "CLI help must document unified search.");
assert(commands.includes("document reprocess"), "CLI help must document document reprocess.");
assert(commands.includes("document runs"), "CLI help must document document processing runs.");
assert(commands.includes("face identities"), "CLI help must document face identities.");
assert(commands.includes("token list --project <id>"), "CLI help must document token list.");
assert(commands.includes("token revoke <id> --project <id>"), "CLI help must document token revoke.");
assert(commands.includes("token rotate <id> --project <id>"), "CLI help must document token rotate.");
assert(commands.includes("projectId: requiredFlag(parsed, \"project\")"), "CLI job retry must send projectId.");
assert(commands.includes("readPositiveIntegerFlag"), "CLI must validate positive integer flags.");
assert(commands.includes("message list --session <id> --project <id>"), "CLI help must document message list.");
assert(commands.includes("readMetadataFilters"), "CLI search commands must pass metadata filters.");
assert(commands.includes("patchJson"), "CLI commands must support PATCH routes.");

for (const symbol of ["MindoryCliApiClient", "requestJson", "patchJson", "uploadDocument", "readFile", "FormData", "authorization", "Bearer", "MindoryCliApiError", "MindoryCliNetworkError"]) {
  assert(httpClient.includes(symbol), `CLI HTTP client must include ${symbol}.`);
}
assert(httpClient.includes("fetchImpl"), "CLI HTTP client must support injectable fetch.");

assert(index.startsWith("#!/usr/bin/env node"), "CLI entrypoint must include a node shebang.");
assert(index.includes("runMindoryCli"), "CLI entrypoint must run runMindoryCli.");
assert(run.includes("MINDORY_CLI_API_URL") || run.includes("config.cli.apiUrl"), "CLI runner must use CLI API URL config.");
assert(run.includes("config.cli.apiToken"), "CLI runner must use CLI API token config.");
assert(run.includes("return 3"), "CLI runner must return exit code 3 for API errors.");
assert(run.includes("return 4"), "CLI runner must return exit code 4 for network errors.");
assert(run.includes("API ${error.statusCode}"), "CLI runner must format API status in errors.");

for (const token of [
  "runMindoryCli",
  "RecordingApi",
  "jobs\", \"get\"",
  "artifact\", \"search\"",
  "search\", \"query\"",
  "face\", \"rename\"",
  "context\", \"build\"",
  "document\", \"upload\"",
  "Missing project id should exit 2",
  "API errors should exit 3",
  "Network errors should exit 4"
]) {
  assert(smoke.includes(token), `CLI smoke script must include ${token}.`);
}

for (const envName of ["MINDORY_CLI_API_URL", "MINDORY_CLI_API_TOKEN"]) {
  assert(config.includes(envName), `Config loader must read ${envName}.`);
  assert(envExample.includes(envName), `.env.example must include ${envName}.`);
  assert(compose.includes(envName), `Docker Compose env must include ${envName}.`);
}

for (const forbidden of ["@mindory/db", "drizzle-orm", "pgTable", "new Pool", "new Client", "commander", "yargs", "@modelcontextprotocol/sdk", "Hermes"]) {
  assert(!args.includes(forbidden), `CLI args module must not include ${forbidden}.`);
  assert(!commands.includes(forbidden), `CLI commands module must not include ${forbidden}.`);
  assert(!httpClient.includes(forbidden), `CLI HTTP client must not include ${forbidden}.`);
  assert(!run.includes(forbidden), `CLI runner must not include ${forbidden}.`);
}

console.log("CLI MVP command surface validated.");
