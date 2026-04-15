import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { callMicrosoftTeamsAction, type MicrosoftTeamsAction } from "./teams-client.js";
import { jsonResult, readNumber, readString } from "./tool-utils.js";

async function runMicrosoftTeamsTool(
  action: MicrosoftTeamsAction,
  params: Record<string, unknown>,
) {
  return jsonResult(await callMicrosoftTeamsAction(action, params));
}

function readPageParams(params: Record<string, unknown>) {
  const limit = readNumber(params, "limit");
  const nextLink = readString(params, "nextLink");
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(nextLink ? { nextLink } : {}),
  };
}

export function createMicrosoftTeamsListTeamsTool(_api: OpenClawPluginApi) {
  return {
    name: "microsoft_teams_list",
    label: "Microsoft Teams List",
    description: "List Microsoft Teams workspaces joined by the connected account.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max teams to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior teams call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      return runMicrosoftTeamsTool("list_teams", readPageParams(params));
    },
  };
}

export function createMicrosoftTeamsChannelsListTool(_api: OpenClawPluginApi) {
  return {
    name: "microsoft_teams_channels_list",
    label: "Microsoft Teams Channels List",
    description: "List channels in a Microsoft Team.",
    parameters: Type.Object({
      teamId: Type.String({ description: "Microsoft Team id." }),
      limit: Type.Optional(Type.Number({ description: "Max channels to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior channels call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const teamId = readString(params, "teamId");
      if (!teamId) {
        throw new Error("teamId is required");
      }
      return runMicrosoftTeamsTool("list_channels", {
        teamId,
        ...readPageParams(params),
      });
    },
  };
}

export function createMicrosoftTeamsChannelGetTool(_api: OpenClawPluginApi) {
  return {
    name: "microsoft_teams_channel_get",
    label: "Microsoft Teams Channel Get",
    description: "Fetch a Microsoft Teams channel by id.",
    parameters: Type.Object({
      teamId: Type.String({ description: "Microsoft Team id." }),
      channelId: Type.String({ description: "Channel id." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const teamId = readString(params, "teamId");
      const channelId = readString(params, "channelId");
      if (!teamId || !channelId) {
        throw new Error("teamId and channelId are required");
      }
      return runMicrosoftTeamsTool("get_channel", {
        teamId,
        channelId,
      });
    },
  };
}

export function createMicrosoftTeamsChannelMessagesListTool(_api: OpenClawPluginApi) {
  return {
    name: "microsoft_teams_channel_messages_list",
    label: "Microsoft Teams Channel Messages List",
    description: "List messages in a Microsoft Teams channel.",
    parameters: Type.Object({
      teamId: Type.String({ description: "Microsoft Team id." }),
      channelId: Type.String({ description: "Channel id." }),
      limit: Type.Optional(Type.Number({ description: "Max messages to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior messages call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const teamId = readString(params, "teamId");
      const channelId = readString(params, "channelId");
      if (!teamId || !channelId) {
        throw new Error("teamId and channelId are required");
      }
      return runMicrosoftTeamsTool("list_channel_messages", {
        teamId,
        channelId,
        ...readPageParams(params),
      });
    },
  };
}

export function createMicrosoftTeamsChannelMessageSendTool(_api: OpenClawPluginApi) {
  return {
    name: "microsoft_teams_channel_message_send",
    label: "Microsoft Teams Channel Message Send",
    description: "Send a message to a Microsoft Teams channel.",
    parameters: Type.Object({
      teamId: Type.String({ description: "Microsoft Team id." }),
      channelId: Type.String({ description: "Channel id." }),
      content: Type.String({ description: "Message body. HTML content is allowed." }),
      subject: Type.Optional(Type.String({ description: "Optional subject for announcement-style posts." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const teamId = readString(params, "teamId");
      const channelId = readString(params, "channelId");
      const content = readString(params, "content");
      if (!teamId || !channelId || !content) {
        throw new Error("teamId, channelId, and content are required");
      }
      const subject = readString(params, "subject");
      return runMicrosoftTeamsTool("send_channel_message", {
        teamId,
        channelId,
        content,
        ...(subject ? { subject } : {}),
      });
    },
  };
}
