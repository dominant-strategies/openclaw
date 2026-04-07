import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createCalendarListTool, createCalendarCreateTool } from "./src/calendar-tools.js";
import {
  createEntropicIntegrationsPluginConfigSchema,
  resolveEntropicIntegrationsPluginConfig,
} from "./src/config.js";
import { createContactsListTool, createContactsSearchTool } from "./src/contacts-tools.js";
import { createDocsReadTool, createDocsEditTool, createDocsCreateTool } from "./src/docs-tools.js";
import {
  createDriveListTool,
  createDriveSearchTool,
  createDriveDownloadTool,
  createDriveUploadTool,
  createDriveShareTool,
  createDriveCreateFolderTool,
} from "./src/drive-tools.js";
import { registerIntegrationGatewayMethods } from "./src/gateway.js";
import {
  createGmailSearchTool,
  createGmailSendTool,
  createGmailGetTool,
  createGmailDraftTool,
} from "./src/gmail-tools.js";
import { configureGwsCommand } from "./src/gws.js";
import {
  createSheetsReadTool,
  createSheetsWriteTool,
  createSheetsCreateTool,
  createSheetsAppendTool,
} from "./src/sheets-tools.js";
import {
  createTasksListTool,
  createTasksCreateTool,
  createTasksUpdateTool,
} from "./src/tasks-tools.js";

const plugin = {
  id: "entropic-integrations",
  name: "Entropic Integrations",
  description:
    "OAuth bridge tools for Entropic integrations, with gws-backed Google Workspace helpers.",
  configSchema: () => createEntropicIntegrationsPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const pluginConfig = resolveEntropicIntegrationsPluginConfig(api.pluginConfig);
    configureGwsCommand(pluginConfig.gwsCommand);
    registerIntegrationGatewayMethods(api);
    const registerOptionalTool = (tool: AnyAgentTool) => {
      api.registerTool(tool, { optional: true });
    };
    // Gmail
    registerOptionalTool(createGmailSearchTool(api) as AnyAgentTool);
    registerOptionalTool(createGmailGetTool(api) as AnyAgentTool);
    registerOptionalTool(createGmailSendTool(api) as AnyAgentTool);
    registerOptionalTool(createGmailDraftTool(api) as AnyAgentTool);
    // Calendar
    registerOptionalTool(createCalendarListTool(api) as AnyAgentTool);
    registerOptionalTool(createCalendarCreateTool(api) as AnyAgentTool);
    // Drive
    registerOptionalTool(createDriveListTool(api) as AnyAgentTool);
    registerOptionalTool(createDriveSearchTool(api) as AnyAgentTool);
    registerOptionalTool(createDriveDownloadTool(api) as AnyAgentTool);
    registerOptionalTool(createDriveUploadTool(api) as AnyAgentTool);
    registerOptionalTool(createDriveShareTool(api) as AnyAgentTool);
    registerOptionalTool(createDriveCreateFolderTool(api) as AnyAgentTool);
    // Sheets
    registerOptionalTool(createSheetsReadTool(api) as AnyAgentTool);
    registerOptionalTool(createSheetsWriteTool(api) as AnyAgentTool);
    registerOptionalTool(createSheetsCreateTool(api) as AnyAgentTool);
    registerOptionalTool(createSheetsAppendTool(api) as AnyAgentTool);
    // Docs
    registerOptionalTool(createDocsReadTool(api) as AnyAgentTool);
    registerOptionalTool(createDocsEditTool(api) as AnyAgentTool);
    registerOptionalTool(createDocsCreateTool(api) as AnyAgentTool);
    // Contacts
    registerOptionalTool(createContactsListTool(api) as AnyAgentTool);
    registerOptionalTool(createContactsSearchTool(api) as AnyAgentTool);
    // Tasks
    registerOptionalTool(createTasksListTool(api) as AnyAgentTool);
    registerOptionalTool(createTasksCreateTool(api) as AnyAgentTool);
    registerOptionalTool(createTasksUpdateTool(api) as AnyAgentTool);
  },
};

export default plugin;
