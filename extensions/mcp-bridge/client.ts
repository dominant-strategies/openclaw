import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool as McpToolDef } from "@modelcontextprotocol/sdk/types.js";

export type McpServerConfig = {
  id: string;
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  toolPrefix?: string;
  oauth?: {
    accessToken?: string;
  };
};

export type McpCallToolResult = {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    [k: string]: unknown;
  }>;
  isError?: boolean;
  [k: string]: unknown;
};

export type McpBridgeClient = {
  readonly serverId: string;
  readonly prefix: string;
  connect(): Promise<void>;
  listTools(): Promise<McpToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult>;
  updateAccessToken(token: string): void;
  close(): Promise<void>;
};

export function createMcpBridgeClient(config: McpServerConfig): McpBridgeClient {
  const serverId = config.id;
  const prefix = config.toolPrefix?.trim() || config.id;
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;
  let accessToken = config.oauth?.accessToken ?? "";

  function buildTransport(): StreamableHTTPClientTransport {
    const headers: Record<string, string> = { ...config.headers };
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
    });
  }

  return {
    get serverId() {
      return serverId;
    },
    get prefix() {
      return prefix;
    },

    async connect() {
      if (client) {
        try {
          await client.close();
        } catch {
          // ignore
        }
      }
      transport = buildTransport();
      client = new Client({ name: "openclaw-mcp-bridge", version: "1.0.0" });
      await client.connect(transport);
    },

    async listTools(): Promise<McpToolDef[]> {
      if (!client) {
        throw new Error(`MCP server "${serverId}" is not connected`);
      }
      const result = await client.listTools();
      return result.tools;
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
      if (!client) {
        throw new Error(`MCP server "${serverId}" is not connected`);
      }
      const result = await client.callTool({ name, arguments: args });
      return result as McpCallToolResult;
    },

    updateAccessToken(token: string) {
      accessToken = token;
    },

    async close() {
      if (client) {
        try {
          await client.close();
        } catch {
          // ignore
        }
        client = null;
        transport = null;
      }
    },
  };
}
