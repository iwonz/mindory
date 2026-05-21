import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "apps/mcp/src/index.ts",
  "apps/mcp/src/http-client.ts",
  "apps/mcp/src/server.ts",
  "apps/mcp/src/stdio.ts",
  "apps/mcp/src/tools.ts"
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
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");

assert(rootPackage.scripts?.["mcp:validate"] === "node scripts/validate-mcp-server.js", "Root package must expose mcp:validate.");
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

for (const forbidden of ["@mindory/db", "drizzle-orm", "pgTable", "new Pool", "new Client"]) {
  assert(!httpClient.includes(forbidden), `MCP HTTP client must not include ${forbidden}.`);
  assert(!tools.includes(forbidden), `MCP tools must not include ${forbidden}.`);
  assert(!server.includes(forbidden), `MCP server must not include ${forbidden}.`);
  assert(!stdio.includes(forbidden), `MCP stdio server must not include ${forbidden}.`);
}

for (const envName of ["MINDORY_MCP_ENABLED", "MINDORY_MCP_TRANSPORT", "MINDORY_MCP_API_URL", "MINDORY_MCP_API_TOKEN"]) {
  assert(config.includes(envName), `Config loader must read ${envName}.`);
  assert(envExample.includes(envName), `.env.example must include ${envName}.`);
  assert(compose.includes(envName), `Docker Compose env must include ${envName}.`);
}

console.log("MCP stdio server validated.");
