import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createCalendarListTool, createCalendarCreateTool } from "./src/calendar-tools.js";
import { registerIntegrationGatewayMethods } from "./src/gateway.js";
import {
  createGmailSearchTool,
  createGmailSendTool,
  createGmailGetTool,
} from "./src/gmail-tools.js";

const plugin = {
  id: "nova-integrations",
  name: "Nova Integrations",
  description: "OAuth bridge tools for Nova integrations",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    registerIntegrationGatewayMethods(api);
    api.registerTool(createGmailSearchTool(api), { optional: true });
    api.registerTool(createGmailGetTool(api), { optional: true });
    api.registerTool(createGmailSendTool(api), { optional: true });
    api.registerTool(createCalendarListTool(api), { optional: true });
    api.registerTool(createCalendarCreateTool(api), { optional: true });
  },
};

export default plugin;
