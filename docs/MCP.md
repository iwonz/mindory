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

## Client Configuration

Build the workspace before connecting a real MCP client:

```bash
pnpm typecheck
```

Then start the Mindory API separately and configure the MCP client to spawn the
stdio process. The MCP process is not a network daemon; the client owns the
child process and communicates over stdin/stdout.

Generic stdio client config:

```json
{
  "mcpServers": {
    "mindory": {
      "command": "node",
      "args": ["/absolute/path/to/mindory/apps/mcp/dist/stdio.js"],
      "env": {
        "MINDORY_MCP_ENABLED": "true",
        "MINDORY_MCP_TRANSPORT": "stdio",
        "MINDORY_MCP_API_URL": "http://localhost:3000",
        "MINDORY_MCP_API_TOKEN": "${MINDORY_MCP_API_TOKEN}"
      }
    }
  }
}
```

Alternative config that uses the workspace package script:

```json
{
  "mcpServers": {
    "mindory": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/mindory", "--filter", "@mindory/mcp", "start"],
      "env": {
        "MINDORY_MCP_ENABLED": "true",
        "MINDORY_MCP_TRANSPORT": "stdio",
        "MINDORY_MCP_API_URL": "http://localhost:3000",
        "MINDORY_MCP_API_TOKEN": "${MINDORY_MCP_API_TOKEN}"
      }
    }
  }
}
```

The same examples are stored in `apps/mcp/examples/stdio-client.json` and
`apps/mcp/examples/stdio-client-pnpm.json`. Replace
`/absolute/path/to/mindory` with the local repository path. Keep the token in an
environment variable or your MCP client's secret store rather than committing a
literal bearer token.

Local spawn smoke test:

```bash
pnpm mcp:smoke
```

The smoke test starts a fake Mindory HTTP API, spawns
`apps/mcp/dist/stdio.js` through the MCP SDK client transport, initializes the
server, lists tools and calls memory, artifact and unified search tools through
the HTTP boundary.

## Docker Compose Note

The Compose `mcp` service exists to prove the packaged stdio command can start
inside the shared image. It is not a remotely reachable MCP service. Real MCP
clients should use the stdio process configuration above and point
`MINDORY_MCP_API_URL` at the API they can reach.

## MVP Tools

- Session tools: create session, append message, read session and messages.
- Memory tools: remember, recall, explain, forget and list.
- Document tools: upload, status, reprocess, processing runs, search, read and
  list.
- Artifact tools: unified artifact search with artifact/span type filters and
  metadata filters.
- Search tools: unified multimodal search across document chunks, artifact
  spans and face observations.
- Face tools: list/read/rename/merge identities and list observations.
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
document_reprocess
document_processing_runs
document_search
document_read
document_list
artifact_search
unified_search
face_identity_list
face_identity_get
face_observation_list
face_identity_rename
face_identity_merge
context_build
job_get
job_list
job_retry
```

Token management is not exposed as an MCP tool. Job tools call the HTTP jobs API
added in `TASK-21`. Memory/context tools call the runtime paths updated in
`TASK-22`. `TASK-50` adds the multimodal surfaces through HTTP only; `TASK-81`
adds `unified_search` over `/v1/search`. MCP still does not access PostgreSQL,
Redis, object storage or vector indexes directly.
