import { loadMindoryConfig, type MindoryConfig } from "@mindory/config";
import { MindoryApiClient, type MindoryApiClientOptions } from "./http-client.js";
import { MindoryMcpToolRegistry, type McpToolCallResult, type McpToolDefinition } from "./tools.js";

export interface MindoryMcpServerOptions {
  config?: MindoryConfig;
  apiClient?: MindoryApiClient;
}

export class MindoryMcpServer {
  readonly tools: MindoryMcpToolRegistry;

  constructor(tools: MindoryMcpToolRegistry) {
    this.tools = tools;
  }

  listTools(): McpToolDefinition[] {
    return this.tools.listTools();
  }

  async callTool(name: string, args: unknown): Promise<McpToolCallResult> {
    return this.tools.callTool(name, args);
  }
}

export function buildMindoryMcpServer(options: MindoryMcpServerOptions = {}): MindoryMcpServer {
  const config = options.config ?? loadMindoryConfig();
  const clientOptions: MindoryApiClientOptions = {
    baseUrl: config.mcp.apiUrl || config.api.publicUrl
  };
  if (config.mcp.apiToken) {
    clientOptions.token = config.mcp.apiToken;
  }
  const apiClient = options.apiClient ?? new MindoryApiClient(clientOptions);

  return new MindoryMcpServer(new MindoryMcpToolRegistry(apiClient));
}
