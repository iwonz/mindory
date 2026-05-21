# MCP

The MCP server is an agent-facing interface over the Mindory HTTP API. It is not
the core source of truth.

## Current Boundary

`TASK-11` adds the MCP package in `apps/mcp`. `TASK-23` wires the package to the
official MCP SDK stdio transport. It exposes:

- `MindoryApiClient` for HTTP API calls;
- MCP-compatible JSON tool definitions;
- `MindoryMcpToolRegistry` with `listTools` and `callTool`;
- `MindoryMcpServer` as a transport-agnostic server wrapper;
- `runMindoryMcpStdio`, which creates an MCP SDK `Server`, registers
  `tools/list` and `tools/call` handlers, and connects `StdioServerTransport`.

MCP tools call the HTTP API. They must not read or write PostgreSQL, Redis,
object storage or vector indexes directly.

The package exposes the `mindory-mcp` binary and `pnpm --filter @mindory/mcp
start` command for stdio clients. Tool execution still requires a running
Mindory API and, when auth is configured, `MINDORY_MCP_API_TOKEN`.

## MVP Tools

- Session tools: create session, append message, read session and messages.
- Memory tools: remember, recall, explain, forget and list.
- Document tools: upload, status, search, read and list.
- Context tools: build prompt-ready context.
- Job tools: read, list and retry processing jobs.

Current tool names:

```text
create_session
append_message
get_session
get_session_messages
get_session_context
memory_remember
memory_recall
memory_explain
memory_forget
memory_list
document_upload
document_status
document_search
document_read
document_list
context_build
job_get
job_list
job_retry
```

Token management is not exposed as an MCP tool. Job tools call the HTTP jobs API
added in `TASK-21`. Memory/context tools call the runtime paths updated in
`TASK-22`.
