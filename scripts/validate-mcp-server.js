import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "apps/mcp/src/index.ts",
  "apps/mcp/src/http-client.ts",
  "apps/mcp/src/server.ts",
  "apps/mcp/src/stdio.ts",
  "apps/mcp/src/tools.ts",
  "apps/mcp/scripts/smoke-stdio.js",
  "apps/mcp/examples/stdio-client.json",
  "apps/mcp/examples/stdio-client-pnpm.json"
];

const expectedTools = [
  "create_session",
  "append_message",
  "get_session",
  "get_session_messages",
  "get_session_context",
  "memory_remember",
  "memory_recall",
  "memory_explain",
  "memory_forget",
  "memory_list",
  "document_upload",
  "document_status",
  "document_search",
  "document_read",
  "document_list",
  "context_build",
  "job_get",
  "job_list",
  "job_retry"
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
const mcpPackage = readJson("apps/mcp/package.json");
const mcpIndex = read("apps/mcp/src/index.ts");
const httpClient = read("apps/mcp/src/http-client.ts");
const server = read("apps/mcp/src/server.ts");
const stdio = read("apps/mcp/src/stdio.ts");
const tools = read("apps/mcp/src/tools.ts");
const smoke = read("apps/mcp/scripts/smoke-stdio.js");
const clientExample = read("apps/mcp/examples/stdio-client.json");
const pnpmClientExample = read("apps/mcp/examples/stdio-client-pnpm.json");
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");
const docs = read("docs/MCP.md");
const deploymentDocs = read("docs/DEPLOYMENT.md");

assert(rootPackage.scripts?.["mcp:validate"] === "node scripts/validate-mcp-server.js", "Root package must expose mcp:validate.");
assert(rootPackage.scripts?.["mcp:smoke"] === "node apps/mcp/scripts/smoke-stdio.js", "Root package must expose mcp:smoke.");
assert(mcpPackage.exports?.["."], "@mindory/mcp must export its root module.");
assert(mcpPackage.bin?.["mindory-mcp"] === "./dist/stdio.js", "@mindory/mcp must expose a mindory-mcp stdio binary.");
assert(mcpPackage.scripts?.start === "node dist/stdio.js", "@mindory/mcp must expose a stdio start script.");
assert(mcpPackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/mcp must depend on @mindory/config.");
assert(mcpPackage.dependencies?.["@modelcontextprotocol/sdk"], "@mindory/mcp must depend on @modelcontextprotocol/sdk.");

for (const exportPath of ["./http-client.js", "./server.js", "./stdio.js", "./tools.js"]) {
  assert(mcpIndex.includes(`export * from "${exportPath}";`), `MCP index must export ${exportPath}.`);
}

for (const symbol of ["MindoryApiClient", "requestJson", "uploadDocument", "authorization", "Bearer"]) {
  assert(httpClient.includes(symbol), `MCP HTTP client must include ${symbol}.`);
}
assert(httpClient.includes("fetchImpl"), "MCP HTTP client must support injectable fetch.");

for (const symbol of ["MindoryMcpServer", "buildMindoryMcpServer", "listTools", "callTool", "MindoryMcpToolRegistry"]) {
  assert(server.includes(symbol) || tools.includes(symbol), `MCP server/tool registry must include ${symbol}.`);
}
assert(server.includes("config.mcp.apiUrl"), "MCP server must use configured API URL.");
assert(server.includes("config.mcp.apiToken"), "MCP server must use configured API token.");

for (const toolName of expectedTools) {
  assert(tools.includes(`"${toolName}"`), `MCP tools must include ${toolName}.`);
}

for (const route of [
  "/v1/sessions",
  "/v1/memories",
  "/v1/memories/search",
  "/v1/context/build",
  "/v1/documents",
  "/v1/documents/search",
  "/v1/jobs"
]) {
  assert(tools.includes(route), `MCP tools must call ${route}.`);
}

assert(tools.includes("sourceRefs"), "memory_remember tool must expose sourceRefs.");
assert(tools.includes("projectIds"), "context and search tools must expose projectIds.");
assert(tools.includes("tokenBudget"), "context build tool must expose tokenBudget.");
assert(tools.includes("mcpTextResult"), "MCP calls must return MCP text content results.");
for (const token of [
  "@modelcontextprotocol/sdk/server/index.js",
  "@modelcontextprotocol/sdk/server/stdio.js",
  "StdioServerTransport",
  "ListToolsRequestSchema",
  "CallToolRequestSchema",
  "buildMindoryMcpSdkServer",
  "runMindoryMcpStdio",
  "sdkServer.connect",
  "tools: mindoryServer.listTools().map(toSdkTool)",
  "mindoryServer.callTool"
]) {
  assert(stdio.includes(token), `MCP stdio runtime must include ${token}.`);
}
assert(!stdio.includes("mcp_transport_not_implemented"), "MCP stdio transport placeholder must be removed.");

for (const token of [
  "@modelcontextprotocol/sdk/client/index.js",
  "@modelcontextprotocol/sdk/client/stdio.js",
  "StdioClientTransport",
  "apps/mcp/dist/stdio.js",
  "client.listTools",
  "client.callTool",
  "memory_recall",
  "/v1/memories/search",
  "MINDORY_MCP_API_URL",
  "MINDORY_MCP_API_TOKEN"
]) {
  assert(smoke.includes(token), `MCP stdio smoke script must include ${token}.`);
}
for (const toolName of ["document_upload", "document_search", "memory_remember", "memory_recall", "context_build", "job_get", "job_list", "job_retry"]) {
  assert(smoke.includes(`"${toolName}"`), `MCP stdio smoke must assert ${toolName} is exposed.`);
}
for (const example of [clientExample, pnpmClientExample]) {
  assert(example.includes('"mcpServers"'), "MCP client examples must use mcpServers config shape.");
  assert(example.includes("MINDORY_MCP_API_URL"), "MCP client examples must include MINDORY_MCP_API_URL.");
  assert(example.includes("${MINDORY_MCP_API_TOKEN}"), "MCP client examples must reference token env var instead of hardcoding a secret.");
}
assert(clientExample.includes("apps/mcp/dist/stdio.js"), "Node-based MCP client example must run dist stdio entrypoint.");
assert(pnpmClientExample.includes("@mindory/mcp"), "pnpm MCP client example must use @mindory/mcp start script.");
for (const token of [
  "Generic stdio client config",
  "pnpm mcp:smoke",
  "not a network daemon",
  "apps/mcp/examples/stdio-client.json"
]) {
  assert(docs.includes(token), `MCP docs must include ${token}.`);
}
assert(
  deploymentDocs.includes("not exposed as a Compose") && deploymentDocs.includes("network service"),
  "Deployment docs must clarify MCP stdio is not a network service."
);

for (const forbidden of ["@mindory/db", "@mindory/queue", "@mindory/storage", "bullmq", "ioredis", "drizzle-orm", "pgTable", "new Pool", "new Client"]) {
  assert(!httpClient.includes(forbidden), `MCP HTTP client must not include ${forbidden}.`);
  assert(!tools.includes(forbidden), `MCP tools must not include ${forbidden}.`);
  assert(!server.includes(forbidden), `MCP server must not include ${forbidden}.`);
  assert(!stdio.includes(forbidden), `MCP stdio server must not include ${forbidden}.`);
}
for (const forbidden of ["@mindory/db", "@mindory/queue", "@mindory/storage", "bullmq", "ioredis", "drizzle-orm", "pgTable", "new Pool", "pg/lib"]) {
  assert(!smoke.includes(forbidden), `MCP stdio smoke must not include ${forbidden}.`);
}

for (const envName of ["MINDORY_MCP_ENABLED", "MINDORY_MCP_TRANSPORT", "MINDORY_MCP_API_URL", "MINDORY_MCP_API_TOKEN"]) {
  assert(config.includes(envName), `Config loader must read ${envName}.`);
  assert(envExample.includes(envName), `.env.example must include ${envName}.`);
  assert(compose.includes(envName), `Docker Compose env must include ${envName}.`);
}

console.log("MCP stdio server validated.");
