import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createMcpBridgeClient, type McpBridgeClient } from "./client.js";
import { discoverAndWrapTools } from "./tool-wrapper.js";

type McpServerEntry = {
  url: string;
  transport?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  toolPrefix?: string;
  oauth?: { accessToken?: string };
};

// Global registry of active MCP clients (survives plugin reload for token updates)
const activeClients = new Map<string, McpBridgeClient>();

async function connectMcpServers(
  api: OpenClawPluginApi,
  mcpServers: Record<string, McpServerEntry>,
) {
  for (const [serverId, serverConfig] of Object.entries(mcpServers)) {
    if (serverConfig.enabled === false) {
      api.logger.info(`MCP server "${serverId}" is disabled — skipping`);
      continue;
    }

    const client = createMcpBridgeClient({
      id: serverId,
      url: serverConfig.url,
      headers: serverConfig.headers,
      toolPrefix: serverConfig.toolPrefix,
      oauth: serverConfig.oauth,
    });

    try {
      await client.connect();
      const tools = await discoverAndWrapTools(client);
      activeClients.set(serverId, client);

      const toolNames = tools.map((t) => t.name);
      api.logger.info(
        `MCP server "${serverId}": discovered ${tools.length} tools [${toolNames.join(", ")}]`,
      );

      // Register tools as optional — they activate via tools.alsoAllow
      api.registerTool(() => tools, { names: toolNames, optional: true });
    } catch (err) {
      api.logger.error(
        `MCP server "${serverId}" failed to connect: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

const plugin = {
  id: "mcp-bridge",
  name: "MCP Bridge",
  description: "Bridges external MCP servers as OpenClaw agent tools",
  configSchema: {
    type: "object" as const,
    properties: {
      servers: { type: "object" as const },
    },
  },

  // IMPORTANT: register() must be synchronous — OpenClaw ignores async registration.
  // Async MCP connection is kicked off via fire-and-forget.
  register(api: OpenClawPluginApi) {
    const mcpServers =
      (api.pluginConfig?.servers as Record<string, McpServerEntry> | undefined) ??
      (api.config.mcpServers as Record<string, McpServerEntry> | undefined);
    if (!mcpServers || Object.keys(mcpServers).length === 0) {
      api.logger.info("No MCP servers configured — skipping");
      return;
    }

    // Fire-and-forget: connect MCP servers and register tools in the background.
    // api.registerTool() still works after register() returns because the api
    // object is closures over persistent plugin state.
    void connectMcpServers(api, mcpServers).catch((err) => {
      api.logger.error(
        `MCP bridge initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // Gateway RPC method to update OAuth tokens at runtime
    api.registerGatewayMethod("mcp.updateToken", async ({ params, respond }) => {
      const p = params as { serverId?: string; accessToken?: string } | undefined;
      if (!p?.serverId || !p?.accessToken) {
        respond(false, undefined, {
          code: "invalid_params",
          message: "Missing serverId or accessToken",
        });
        return;
      }
      const client = activeClients.get(p.serverId);
      if (!client) {
        respond(false, undefined, {
          code: "not_found",
          message: `MCP server "${p.serverId}" not found`,
        });
        return;
      }
      client.updateAccessToken(p.accessToken);
      // Reconnect to apply the new token
      try {
        await client.close();
        await client.connect();
        api.logger.info(`MCP server "${p.serverId}" reconnected with updated token`);
        respond(true, { ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(`MCP server "${p.serverId}" reconnect failed: ${msg}`);
        respond(false, undefined, {
          code: "mcp_reconnect_failed",
          message: msg,
        });
      }
    });

    // Clean up on gateway stop
    api.on("gateway_stop", async () => {
      for (const [id, client] of activeClients) {
        try {
          await client.close();
        } catch {
          // ignore
        }
        activeClients.delete(id);
      }
    });
  },
};

export default plugin;
