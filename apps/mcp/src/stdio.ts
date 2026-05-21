#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadMindoryConfig, type MindoryConfig } from "@mindory/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { buildMindoryMcpServer, type MindoryMcpServer } from "./server.js";
import type { McpToolDefinition } from "./tools.js";

export type McpServerErrorCode =
  | "mcp_disabled";

export class McpServerError extends Error {
  readonly code: McpServerErrorCode;

  constructor(code: McpServerErrorCode, message: string) {
    super(message);
    this.name = "McpServerError";
    this.code = code;
  }
}

export interface MindoryMcpStdioOptions {
  config?: MindoryConfig;
  server?: MindoryMcpServer;
}

export function buildMindoryMcpSdkServer(mindoryServer: MindoryMcpServer): Server {
  const sdkServer = new Server({
    name: "mindory",
    version: "0.0.0"
  }, {
    capabilities: {
      tools: {}
    },
    instructions: "Use Mindory tools to read and write source-backed memory through the configured Mindory HTTP API."
  });

  sdkServer.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: mindoryServer.listTools().map(toSdkTool)
  }));

  sdkServer.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => (
    mindoryServer.callTool(request.params.name, request.params.arguments ?? {}) as Promise<CallToolResult>
  ));

  return sdkServer;
}

export async function runMindoryMcpStdio(options: MindoryMcpStdioOptions = {}): Promise<void> {
  const config = options.config ?? loadMindoryConfig();
  if (!config.mcp.enabled) {
    throw new McpServerError("mcp_disabled", "MCP server is disabled by MINDORY_MCP_ENABLED=false.");
  }

  const mindoryServer = options.server ?? buildMindoryMcpServer({ config });
  const sdkServer = buildMindoryMcpSdkServer(mindoryServer);
  await sdkServer.connect(new StdioServerTransport());
}

function toSdkTool(definition: McpToolDefinition): Tool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema as Tool["inputSchema"]
  };
}

if (isDirectRun()) {
  runMindoryMcpStdio().catch((error: unknown) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    console.error(normalizedError.message);
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}
