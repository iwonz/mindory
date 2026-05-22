import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "apps/adapters/hermes/src/adapter.ts",
  "apps/adapters/hermes/src/example-host.ts",
  "apps/adapters/hermes/src/http-client.ts",
  "apps/adapters/hermes/src/identity.ts",
  "apps/adapters/hermes/src/index.ts",
  "apps/adapters/hermes/src/runtime-contract.ts",
  "apps/adapters/hermes/src/runtime-integration.ts",
  "apps/adapters/hermes/src/tools.ts",
  "apps/adapters/hermes/fixtures/runtime-contract.json",
  "scripts/smoke-hermes.js",
  "scripts/smoke-hermes-contract.js",
  "scripts/smoke-hermes-example-host.js",
  "scripts/smoke-hermes-runtime-harness.js"
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
const exampleHost = read("apps/adapters/hermes/src/example-host.ts");
const httpClient = read("apps/adapters/hermes/src/http-client.ts");
const identity = read("apps/adapters/hermes/src/identity.ts");
const index = read("apps/adapters/hermes/src/index.ts");
const runtimeContract = read("apps/adapters/hermes/src/runtime-contract.ts");
const runtimeIntegration = read("apps/adapters/hermes/src/runtime-integration.ts");
const tools = read("apps/adapters/hermes/src/tools.ts");
const fixture = read("apps/adapters/hermes/fixtures/runtime-contract.json");
const smoke = read("scripts/smoke-hermes.js");
const contractSmoke = read("scripts/smoke-hermes-contract.js");
const exampleHostSmoke = read("scripts/smoke-hermes-example-host.js");
const runtimeHarnessSmoke = read("scripts/smoke-hermes-runtime-harness.js");
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");
const docs = read("docs/HERMES_ADAPTER.md");

assert(rootPackage.scripts?.["hermes:validate"] === "node scripts/validate-hermes-adapter.js", "Root package must expose hermes:validate.");
assert(rootPackage.scripts?.["hermes:smoke"] === "node scripts/smoke-hermes.js", "Root package must expose hermes:smoke.");
assert(rootPackage.scripts?.["hermes:contract"] === "node scripts/smoke-hermes-contract.js", "Root package must expose hermes:contract.");
assert(rootPackage.scripts?.["hermes:example"] === "node scripts/smoke-hermes-example-host.js", "Root package must expose hermes:example.");
assert(rootPackage.scripts?.["hermes:harness"] === "node scripts/smoke-hermes-runtime-harness.js", "Root package must expose hermes:harness.");
assert(hermesPackage.exports?.["."], "@mindory/adapter-hermes must export its root module.");
assert(hermesPackage.exports?.["./example-host"], "@mindory/adapter-hermes must export its example host module.");
assert(hermesPackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/adapter-hermes must depend on @mindory/config.");

for (const exportPath of ["./adapter.js", "./example-host.js", "./http-client.js", "./identity.js", "./runtime-contract.js", "./runtime-integration.js", "./tools.js"]) {
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
  "MindoryHermesExampleHost",
  "createMindoryHermesExampleHost",
  "runTurn",
  "runLaterPrompt",
  "runCompletedTurn",
  "runCompletedTurn",
  "registerHook",
  "installMindoryHermesRuntime",
  "registeredHookNames",
  "uninstall"
]) {
  assert(exampleHost.includes(symbol), `Hermes example host must include ${symbol}.`);
}
for (const token of ["before_prompt", "after_response", "completed_turn", "HermesRuntimeIdentity", "HermesRuntimeAttachment"]) {
  assert(exampleHost.includes(token), `Hermes example host must include ${token}.`);
}

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

for (const symbol of [
  "MindoryHermesRuntimeBridge",
  "beforePrompt",
  "afterResponse",
  "handleCompletedTurn",
  "toIdentityInput",
  "HermesBeforePromptHook",
  "HermesAfterResponseHook",
  "HermesCompletedTurnHook",
  "buildMindoryHermesTools"
]) {
  assert(runtimeContract.includes(symbol), `Hermes runtime contract bridge must include ${symbol}.`);
}
assert(runtimeContract.includes("preparePromptContext(input)"), "Hermes runtime bridge must map before_prompt to preparePromptContext.");
assert(runtimeContract.includes("saveTurn(input)"), "Hermes runtime bridge must map after_response to saveTurn.");
assert(runtimeContract.includes("handleTurn(input)"), "Hermes runtime bridge must map completed_turn to handleTurn.");

for (const symbol of [
  "installMindoryHermesRuntime",
  "registerHermesHook",
  "attachMindoryPromptContext",
  "attachMindorySavedTurn",
  "attachMindoryLifecycleResult",
  "toHermesBeforePromptHook",
  "toHermesAfterResponseHook",
  "toHermesCompletedTurnHook"
]) {
  assert(runtimeIntegration.includes(symbol), `Hermes runtime integration must include ${symbol}.`);
}
for (const token of ["before_prompt", "after_response", "completed_turn", "registerHook", "addHook", "hooks", "promptPrefix", "messages", "uninstall"]) {
  assert(runtimeIntegration.includes(token), `Hermes runtime integration must include ${token}.`);
}

for (const symbol of ["HermesMindoryApiClient", "requestJson", "patchJson", "uploadAttachment", "FormData", "authorization", "Bearer"]) {
  assert(httpClient.includes(symbol), `Hermes HTTP client must include ${symbol}.`);
}
assert(httpClient.includes("fetchImpl"), "Hermes HTTP client must support injectable fetch.");

for (const toolName of [
  "memor_recall",
  "memor_remember",
  "memor_document_search",
  "memor_artifact_search",
  "memor_document_read",
  "memor_document_status",
  "memor_document_reprocess",
  "memor_face_identities",
  "memor_face_observations",
  "memor_face_rename",
  "memor_face_merge",
  "memor_explain"
]) {
  assert(tools.includes(toolName), `Hermes optional tools must include ${toolName}.`);
}
assert(tools.includes("sourceRefs"), "Hermes remember tool must preserve evidence sourceRefs.");
assert(tools.includes("ensureProjectPeerSession"), "Hermes tools must ensure identity before API calls.");
assert(tools.includes("/v1/artifacts/search"), "Hermes tools must call artifact search over HTTP.");
assert(tools.includes("/recompute"), "Hermes tools must call document recompute over HTTP.");
assert(tools.includes("/v1/faces/identities"), "Hermes tools must call face identity HTTP API.");
assert(tools.includes("metadataFilters"), "Hermes tools must pass metadata filters.");

assert(smoke.includes("handleTurn"), "Hermes smoke must exercise lifecycle helper.");
assert(smoke.includes("Context must be built before saving the current turn"), "Hermes smoke must verify context before turn save.");
assert(smoke.includes("Hermes tools must ensure identity"), "Hermes smoke must verify tool identity ensure.");
assert(smoke.includes("Hermes artifact tool must call artifact search"), "Hermes smoke must verify artifact search tool.");
assert(smoke.includes("Hermes face rename tool must call face identity PATCH"), "Hermes smoke must verify face rename tool.");
assert(smoke.includes("Later sessions must recall project-scoped context"), "Hermes smoke must verify later-session recall.");
for (const token of [
  "local_contract_fixture",
  "2026-05-21",
  "before_prompt",
  "after_response",
  "completed_turn",
  "hermes-attachment-1"
]) {
  assert(fixture.includes(token), `Hermes runtime fixture must include ${token}.`);
}
for (const token of [
  "MindoryHermesRuntimeBridge",
  "HermesMindoryApiClient",
  "beforePrompt",
  "afterResponse",
  "uploaded attachment response",
  "Later Hermes sessions must recall project-scoped context",
  "memor_recall",
  "memor_artifact_search"
]) {
  assert(contractSmoke.includes(token), `Hermes contract smoke must include ${token}.`);
}
for (const token of [
  "createMindoryHermesExampleHost",
  "runTurn",
  "runLaterPrompt",
  "source-backed Hermes answers",
  "hermes-example-attachment",
  "Hermes example host smoke scenario passed",
  "Bearer"
]) {
  assert(exampleHostSmoke.includes(token), `Hermes example host smoke must include ${token}.`);
}
for (const token of [
  "FakeCompatibleHermesRuntime",
  "installMindoryHermesRuntime",
  "before_prompt",
  "after_response",
  "completed_turn",
  "Hermes fake-compatible runtime harness passed",
  "Later Hermes session must recall project-scoped context"
]) {
  assert(runtimeHarnessSmoke.includes(token), `Hermes runtime harness smoke must include ${token}.`);
}
for (const token of [
  "Runtime Contract Fixture",
  "Runtime Integration Harness",
  "Example Host",
  "2026-05-21",
  "before_prompt",
  "after_response",
  "pnpm hermes:contract",
  "pnpm hermes:example",
  "pnpm hermes:harness"
]) {
  assert(docs.includes(token), `Hermes docs must include ${token}.`);
}

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
  assert(!runtimeContract.includes(forbidden), `Hermes runtime contract module must not include ${forbidden}.`);
  assert(!runtimeIntegration.includes(forbidden), `Hermes runtime integration module must not include ${forbidden}.`);
  assert(!tools.includes(forbidden), `Hermes tools module must not include ${forbidden}.`);
  assert(!exampleHost.includes(forbidden), `Hermes example host module must not include ${forbidden}.`);
}
for (const forbidden of ["@mindory/db", "drizzle-orm", "pgTable", "new Pool", "pg/lib", "@modelcontextprotocol/sdk", "from \"hermes", "from 'hermes"]) {
  assert(!contractSmoke.includes(forbidden), `Hermes contract smoke must not include ${forbidden}.`);
  assert(!exampleHostSmoke.includes(forbidden), `Hermes example host smoke must not include ${forbidden}.`);
  assert(!runtimeHarnessSmoke.includes(forbidden), `Hermes runtime harness smoke must not include ${forbidden}.`);
}

console.log("Hermes runtime adapter validated.");
