import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  createAsanaProjectCreateTool,
  createAsanaProjectGetTool,
  createAsanaProjectsListTool,
  createAsanaProjectUpdateTool,
  createAsanaSectionCreateTool,
  createAsanaSectionsListTool,
  createAsanaTaskCommentTool,
  createAsanaTaskCreateTool,
  createAsanaTaskGetTool,
  createAsanaTaskMoveTool,
  createAsanaTasksListTool,
  createAsanaTasksSearchTool,
  createAsanaTaskUpdateTool,
  createAsanaTeamsListTool,
  createAsanaWorkspacesListTool,
} from "./src/asana-tools.js";
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
  createMicrosoftTeamsChannelGetTool,
  createMicrosoftTeamsChannelMessagesListTool,
  createMicrosoftTeamsChannelMessageSendTool,
  createMicrosoftTeamsChannelsListTool,
  createMicrosoftTeamsListTeamsTool,
} from "./src/teams-tools.js";
import {
  createOneDriveBase64FileUploadTool,
  createOneDriveDocxCreateTool,
  createOneDriveFolderCreateTool,
  createOneDriveItemDownloadTool,
  createOneDriveItemContentGetTool,
  createOneDriveItemGetTool,
  createOneDriveItemMoveTool,
  createOneDriveItemResolveByPathTool,
  createOneDriveItemShareTool,
  createOneDriveItemsListTool,
  createOneDriveItemsSearchTool,
  createOneDriveTextFileUploadTool,
} from "./src/onedrive-tools.js";
import {
  createOutlookCalendarsListTool,
  createOutlookEventCreateTool,
  createOutlookEventsListTool,
  createOutlookMailFoldersListTool,
  createOutlookMessageGetTool,
  createOutlookMessagesListTool,
  createOutlookMessageSendTool,
} from "./src/outlook-tools.js";
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
    "OAuth bridge tools for Entropic integrations, including hosted Asana, Outlook, OneDrive, Teams, and gws-backed Google Workspace helpers.",
  configSchema: () => createEntropicIntegrationsPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const pluginConfig = resolveEntropicIntegrationsPluginConfig(api.pluginConfig);
    configureGwsCommand(pluginConfig.gwsCommand);
    registerIntegrationGatewayMethods(api);
    const registerOptionalTool = (tool: AnyAgentTool) => {
      api.registerTool(tool, { optional: true });
    };
    // Asana
    registerOptionalTool(createAsanaWorkspacesListTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaTeamsListTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaProjectsListTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaProjectGetTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaProjectCreateTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaProjectUpdateTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaSectionsListTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaSectionCreateTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaTasksListTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaTasksSearchTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaTaskGetTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaTaskCreateTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaTaskUpdateTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaTaskMoveTool(api) as AnyAgentTool);
    registerOptionalTool(createAsanaTaskCommentTool(api) as AnyAgentTool);
    // Outlook
    registerOptionalTool(createOutlookMailFoldersListTool(api) as AnyAgentTool);
    registerOptionalTool(createOutlookMessagesListTool(api) as AnyAgentTool);
    registerOptionalTool(createOutlookMessageGetTool(api) as AnyAgentTool);
    api.registerTool((ctx) => createOutlookMessageSendTool(api, ctx) as AnyAgentTool, {
      optional: true,
      name: "outlook_message_send",
    });
    registerOptionalTool(createOutlookCalendarsListTool(api) as AnyAgentTool);
    registerOptionalTool(createOutlookEventsListTool(api) as AnyAgentTool);
    registerOptionalTool(createOutlookEventCreateTool(api) as AnyAgentTool);
    // OneDrive
    registerOptionalTool(createOneDriveItemsListTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveItemsSearchTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveItemResolveByPathTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveItemGetTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveItemContentGetTool(api) as AnyAgentTool);
    api.registerTool((ctx) => createOneDriveItemDownloadTool(api, ctx) as AnyAgentTool, {
      optional: true,
      name: "onedrive_item_download",
    });
    registerOptionalTool(createOneDriveItemShareTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveFolderCreateTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveTextFileUploadTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveBase64FileUploadTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveDocxCreateTool(api) as AnyAgentTool);
    registerOptionalTool(createOneDriveItemMoveTool(api) as AnyAgentTool);
    // Microsoft Teams
    registerOptionalTool(createMicrosoftTeamsListTeamsTool(api) as AnyAgentTool);
    registerOptionalTool(createMicrosoftTeamsChannelsListTool(api) as AnyAgentTool);
    registerOptionalTool(createMicrosoftTeamsChannelGetTool(api) as AnyAgentTool);
    registerOptionalTool(createMicrosoftTeamsChannelMessagesListTool(api) as AnyAgentTool);
    registerOptionalTool(createMicrosoftTeamsChannelMessageSendTool(api) as AnyAgentTool);
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
