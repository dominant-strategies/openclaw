import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { callOutlookAction, type OutlookAction } from "./outlook-client.js";
import {
  jsonResult,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
} from "./tool-utils.js";

async function runOutlookTool(action: OutlookAction, params: Record<string, unknown>) {
  return jsonResult(await callOutlookAction(action, params));
}

function readPageParams(params: Record<string, unknown>) {
  const limit = readNumber(params, "limit");
  const nextLink = readString(params, "nextLink");
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(nextLink ? { nextLink } : {}),
  };
}

export function createOutlookMailFoldersListTool(_api: OpenClawPluginApi) {
  return {
    name: "outlook_mail_folders_list",
    label: "Outlook Mail Folders List",
    description: "List Outlook mail folders for the connected account.",
    parameters: Type.Object({
      includeHiddenFolders: Type.Optional(
        Type.Boolean({ description: "Include hidden system folders." }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max folders to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior Outlook folder list call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      return runOutlookTool("list_mail_folders", {
        ...(readBoolean(params, "includeHiddenFolders") !== undefined
          ? { includeHiddenFolders: readBoolean(params, "includeHiddenFolders") }
          : {}),
        ...readPageParams(params),
      });
    },
  };
}

export function createOutlookMessagesListTool(_api: OpenClawPluginApi) {
  return {
    name: "outlook_messages_list",
    label: "Outlook Messages List",
    description: "List Outlook messages, optionally scoped to a specific mail folder.",
    parameters: Type.Object({
      folderId: Type.Optional(Type.String({ description: "Optional mail folder id." })),
      unreadOnly: Type.Optional(Type.Boolean({ description: "Only return unread messages." })),
      limit: Type.Optional(Type.Number({ description: "Max messages to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior Outlook messages call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const folderId = readString(params, "folderId");
      const unreadOnly = readBoolean(params, "unreadOnly");
      return runOutlookTool("list_messages", {
        ...(folderId ? { folderId } : {}),
        ...(unreadOnly !== undefined ? { unreadOnly } : {}),
        ...readPageParams(params),
      });
    },
  };
}

export function createOutlookMessageGetTool(_api: OpenClawPluginApi) {
  return {
    name: "outlook_message_get",
    label: "Outlook Message Get",
    description: "Fetch a single Outlook message by id.",
    parameters: Type.Object({
      messageId: Type.String({ description: "Outlook message id." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const messageId = readString(params, "messageId");
      if (!messageId) {
        throw new Error("messageId is required");
      }
      return runOutlookTool("get_message", { messageId });
    },
  };
}

export function createOutlookMessageSendTool(_api: OpenClawPluginApi) {
  return {
    name: "outlook_message_send",
    label: "Outlook Message Send",
    description: "Send an Outlook email message.",
    parameters: Type.Object({
      to: Type.Array(Type.String({ description: "Primary recipient email address." })),
      cc: Type.Optional(Type.Array(Type.String({ description: "CC recipient email address." }))),
      bcc: Type.Optional(
        Type.Array(Type.String({ description: "BCC recipient email address." })),
      ),
      subject: Type.String({ description: "Email subject." }),
      body: Type.String({ description: "Plain-text email body." }),
      saveToSentItems: Type.Optional(
        Type.Boolean({ description: "Whether Outlook should keep a copy in Sent Items." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const to = readStringArray(params.to);
      const cc = readStringArray(params.cc);
      const bcc = readStringArray(params.bcc);
      const subject = readString(params, "subject");
      const body = readString(params, "body");
      const saveToSentItems = readBoolean(params, "saveToSentItems");
      if (!subject || !body || to.length === 0) {
        throw new Error("to, subject, and body are required");
      }
      return runOutlookTool("send_message", {
        to,
        ...(cc.length > 0 ? { cc } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
        subject,
        body,
        ...(saveToSentItems !== undefined ? { saveToSentItems } : {}),
      });
    },
  };
}

export function createOutlookCalendarsListTool(_api: OpenClawPluginApi) {
  return {
    name: "outlook_calendars_list",
    label: "Outlook Calendars List",
    description: "List Outlook calendars available to the connected account.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max calendars to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior calendars call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      return runOutlookTool("list_calendars", readPageParams(params));
    },
  };
}

export function createOutlookEventsListTool(_api: OpenClawPluginApi) {
  return {
    name: "outlook_events_list",
    label: "Outlook Events List",
    description:
      "List Outlook calendar events, optionally scoped to a calendar or time window.",
    parameters: Type.Object({
      calendarId: Type.Optional(Type.String({ description: "Optional calendar id." })),
      startDateTime: Type.Optional(
        Type.String({ description: "ISO datetime for calendarView start." }),
      ),
      endDateTime: Type.Optional(
        Type.String({ description: "ISO datetime for calendarView end." }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max events to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior events call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const calendarId = readString(params, "calendarId");
      const startDateTime = readString(params, "startDateTime");
      const endDateTime = readString(params, "endDateTime");
      return runOutlookTool("list_events", {
        ...(calendarId ? { calendarId } : {}),
        ...(startDateTime ? { startDateTime } : {}),
        ...(endDateTime ? { endDateTime } : {}),
        ...readPageParams(params),
      });
    },
  };
}

export function createOutlookEventCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "outlook_event_create",
    label: "Outlook Event Create",
    description: "Create an Outlook calendar event.",
    parameters: Type.Object({
      subject: Type.String({ description: "Event title." }),
      startDateTime: Type.String({ description: "ISO datetime for the event start." }),
      endDateTime: Type.String({ description: "ISO datetime for the event end." }),
      timeZone: Type.Optional(Type.String({ description: "Time zone, default UTC." })),
      calendarId: Type.Optional(Type.String({ description: "Optional target calendar id." })),
      body: Type.Optional(Type.String({ description: "Optional event body." })),
      location: Type.Optional(Type.String({ description: "Optional location label." })),
      attendees: Type.Optional(
        Type.Array(Type.String({ description: "Attendee email address." })),
      ),
      isAllDay: Type.Optional(Type.Boolean({ description: "Create as an all-day event." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const subject = readString(params, "subject");
      const startDateTime = readString(params, "startDateTime");
      const endDateTime = readString(params, "endDateTime");
      if (!subject || !startDateTime || !endDateTime) {
        throw new Error("subject, startDateTime, and endDateTime are required");
      }
      const calendarId = readString(params, "calendarId");
      const timeZone = readString(params, "timeZone");
      const body = readString(params, "body");
      const location = readString(params, "location");
      const attendees = readStringArray(params.attendees);
      const isAllDay = readBoolean(params, "isAllDay");
      return runOutlookTool("create_event", {
        subject,
        startDateTime,
        endDateTime,
        ...(calendarId ? { calendarId } : {}),
        ...(timeZone ? { timeZone } : {}),
        ...(body ? { body } : {}),
        ...(location ? { location } : {}),
        ...(attendees.length > 0 ? { attendees } : {}),
        ...(isAllDay !== undefined ? { isAllDay } : {}),
      });
    },
  };
}
