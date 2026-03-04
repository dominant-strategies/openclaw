import type { Tool as McpToolDef } from "@modelcontextprotocol/sdk/types.js";
import { Type, type TSchema } from "@sinclair/typebox";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import type { McpBridgeClient } from "./client.js";

/**
 * Convert a JSON Schema object (from MCP tool inputSchema) into a TypeBox TSchema.
 */
function jsonSchemaToTypebox(schema: Record<string, unknown>): TSchema {
  const type = schema.type as string | undefined;
  if (!type || type === "object") {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set((schema.required ?? []) as string[]);
    const props: Record<string, TSchema> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      const converted = jsonSchemaToTypebox(propSchema);
      props[key] = required.has(key) ? converted : Type.Optional(converted);
    }
    return Type.Object(props);
  }
  const description = schema.description as string | undefined;
  const opts = description ? { description } : {};
  switch (type) {
    case "string":
      if (schema.enum) {
        return Type.Union(
          (schema.enum as string[]).map((v) => Type.Literal(v)),
          opts,
        );
      }
      return Type.String(opts);
    case "number":
    case "integer":
      return Type.Number(opts);
    case "boolean":
      return Type.Boolean(opts);
    case "array": {
      const items = (schema.items ?? {}) as Record<string, unknown>;
      return Type.Array(jsonSchemaToTypebox(items), opts);
    }
    default:
      return Type.Unknown(opts);
  }
}

/**
 * Wrap a single MCP tool definition into an OpenClaw AnyAgentTool.
 */
export function wrapMcpTool(params: {
  mcpClient: McpBridgeClient;
  mcpTool: McpToolDef;
}): AnyAgentTool {
  const { mcpClient, mcpTool } = params;
  const prefix = mcpClient.prefix;
  const toolName = `${prefix}_${mcpTool.name}`;
  const inputSchema = (mcpTool.inputSchema ?? {}) as Record<string, unknown>;
  const parameters = jsonSchemaToTypebox(inputSchema);

  return {
    label: `${prefix}:${mcpTool.name}`,
    name: toolName,
    description: mcpTool.description ?? `MCP tool from ${prefix} server`,
    parameters,
    execute: async (_toolCallId: string, args: Record<string, unknown>) => {
      const result = await mcpClient.callTool(mcpTool.name, args);
      const textParts: string[] = [];
      for (const item of result.content ?? []) {
        if (item.type === "text" && item.text) {
          textParts.push(item.text);
        } else if (item.type === "image") {
          textParts.push(`[image: ${item.mimeType ?? "image/png"}]`);
        } else if (item.type === "resource") {
          const text =
            typeof (item as Record<string, unknown>).resource === "object"
              ? JSON.stringify((item as Record<string, unknown>).resource)
              : String(item);
          textParts.push(text);
        }
      }
      const text = textParts.join("\n") || "(empty result)";
      return {
        content: [{ type: "text" as const, text }],
        details: {
          serverId: mcpClient.serverId,
          mcpTool: mcpTool.name,
          isError: result.isError,
        },
      };
    },
  };
}

/**
 * Discover tools from an MCP server and wrap them as OpenClaw agent tools.
 */
export async function discoverAndWrapTools(mcpClient: McpBridgeClient): Promise<AnyAgentTool[]> {
  const mcpTools = await mcpClient.listTools();
  return mcpTools.map((mcpTool) => wrapMcpTool({ mcpClient, mcpTool }));
}
