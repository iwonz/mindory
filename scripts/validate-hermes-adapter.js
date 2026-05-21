import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "apps/adapters/hermes/src/adapter.ts",
  "apps/adapters/hermes/src/http-client.ts",
  "apps/adapters/hermes/src/identity.ts",
  "apps/adapters/hermes/src/index.ts",
  "apps/adapters/hermes/src/tools.ts",
  "scripts/smoke-hermes.js"
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
const hermesPackage = readJson("apps/adapters/hermes/package.json");
const adapter = read("apps/adapters/hermes/src/adapter.ts");
const httpClient = read("apps/adapters/hermes/src/http-client.ts");
const identity = read("apps/adapters/hermes/src/identity.ts");
const index = read("apps/adapters/hermes/src/index.ts");
const tools = read("apps/adapters/hermes/src/tools.ts");
const smoke = read("scripts/smoke-hermes.js");
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");

assert(rootPackage.scripts?.["hermes:validate"] === "node scripts/validate-hermes-adapter.js", "Root package must expose hermes:validate.");
assert(rootPackage.scripts?.["hermes:smoke"] === "node scripts/smoke-hermes.js", "Root package must expose hermes:smoke.");
assert(hermesPackage.exports?.["."], "@mindory/adapter-hermes must export its root module.");
assert(hermesPackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/adapter-hermes must depend on @mindory/config.");

for (const exportPath of ["./adapter.js", "./http-client.js", "./identity.js", "./tools.js"]) {
  assert(index.includes(`export * from "${exportPath}";`), `Hermes index must export ${exportPath}.`);
}

for (const symbol of [
  "MindoryHermesAdapter",
  "buildMindoryHermesAdapter",
  "preparePromptContext",
  "handleTurn",
  "saveTurn",
  "ensureProjectPeerSession",
  "uploadAttachments",
  "formatContextForPrompt"
]) {
  assert(adapter.includes(symbol), `Hermes adapter must include ${symbol}.`);
}

for (const route of [
  "/v1/projects",
  "/v1/peers",
  "/v1/sessions",
  "/v1/context/build",
  "/v1/documents"
]) {
  assert(adapter.includes(route) || httpClient.includes(route), `Hermes adapter must call ${route}.`);
}
assert(adapter.includes("/messages"), "Hermes adapter must append user/assistant messages.");
assert(adapter.includes("actor_peer_id"), "Hermes source snapshots must preserve actor peer.");
assert(adapter.includes("agent_peer_id"), "Hermes source snapshots must preserve agent peer.");
assert(adapter.includes("buildAttachmentMetadata"), "Hermes adapter must preserve attachment metadata on saved messages.");
assert(adapter.indexOf("preparePromptContext") < adapter.indexOf("saveTurn(input)"), "Hermes lifecycle helper must build context before saving the turn.");

for (const symbol of [
  "mapHermesIdentity",
  "stableMindoryId",
  "externalUserId",
  "externalSessionId",
  "agentId",
  "usedDefaultUserPeer",
  "usedDefaultAgentPeer"
]) {
  assert(identity.includes(symbol), `Hermes identity mapper must include ${symbol}.`);
}
assert(identity.includes("requireStableIdentity(input.externalSessionId"), "Hermes identity mapper must require stable session identity.");

for (const symbol of ["HermesMindoryApiClient", "requestJson", "uploadAttachment", "FormData", "authorization", "Bearer"]) {
  assert(httpClient.includes(symbol), `Hermes HTTP client must include ${symbol}.`);
}
assert(httpClient.includes("fetchImpl"), "Hermes HTTP client must support injectable fetch.");

for (const toolName of ["memor_recall", "memor_remember", "memor_document_search", "memor_document_read", "memor_explain"]) {
  assert(tools.includes(toolName), `Hermes optional tools must include ${toolName}.`);
}
assert(tools.includes("sourceRefs"), "Hermes remember tool must preserve evidence sourceRefs.");
assert(tools.includes("ensureProjectPeerSession"), "Hermes tools must ensure identity before API calls.");

assert(smoke.includes("handleTurn"), "Hermes smoke must exercise lifecycle helper.");
assert(smoke.includes("Context must be built before saving the current turn"), "Hermes smoke must verify context before turn save.");
assert(smoke.includes("Hermes tools must ensure identity"), "Hermes smoke must verify tool identity ensure.");
assert(smoke.includes("Later sessions must recall project-scoped context"), "Hermes smoke must verify later-session recall.");

for (const envName of [
  "MINDORY_HERMES_ADAPTER_ENABLED",
  "MINDORY_HERMES_API_URL",
  "MINDORY_HERMES_API_TOKEN",
  "MINDORY_HERMES_DEFAULT_PROJECT",
  "MINDORY_HERMES_DEFAULT_USER_PEER",
  "MINDORY_HERMES_DEFAULT_AGENT_PEER",
  "MINDORY_HERMES_CONTEXT_TOKEN_BUDGET"
]) {
  assert(config.includes(envName), `Config loader must read ${envName}.`);
  assert(envExample.includes(envName), `.env.example must include ${envName}.`);
  assert(compose.includes(envName), `Docker Compose env must include ${envName}.`);
}

for (const forbidden of ["@mindory/db", "drizzle-orm", "pgTable", "new Pool", "new Client", "commander", "yargs", "@modelcontextprotocol/sdk", "from \"hermes", "from 'hermes"]) {
  assert(!adapter.includes(forbidden), `Hermes adapter must not include ${forbidden}.`);
  assert(!httpClient.includes(forbidden), `Hermes HTTP client must not include ${forbidden}.`);
  assert(!identity.includes(forbidden), `Hermes identity module must not include ${forbidden}.`);
  assert(!tools.includes(forbidden), `Hermes tools module must not include ${forbidden}.`);
}

console.log("Hermes runtime adapter validated.");
