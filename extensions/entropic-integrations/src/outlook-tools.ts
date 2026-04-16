import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
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

const OUTLOOK_ATTACHMENT_MIME_BY_EXT: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

function resolveWorkspaceFilePath(params: {
  workspaceDir: string;
  rawPath: string;
}) {
  const workspaceRoot = path.resolve(params.workspaceDir);
  const trimmed = params.rawPath.trim();
  if (!trimmed) {
    throw new Error("attachmentPaths entries must not be empty");
  }

  let candidate = trimmed;
  if (path.isAbsolute(candidate)) {
    candidate = path.normalize(candidate);
  } else {
    candidate = path.resolve(workspaceRoot, candidate);
  }

  const relative = path.relative(workspaceRoot, candidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Attachment path must stay inside the current workspace: ${trimmed}`);
  }

  return {
    absolutePath: candidate,
    relativePath: relative || path.basename(candidate),
  };
}

function detectAttachmentMime(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return OUTLOOK_ATTACHMENT_MIME_BY_EXT[ext] || "application/octet-stream";
}

async function readWorkspaceAttachments(
  ctx: OpenClawPluginToolContext | undefined,
  rawPaths: string[],
) {
  const workspaceDir = ctx?.workspaceDir?.trim();
  if (!workspaceDir) {
    throw new Error("Workspace path is unavailable, so attachments cannot be loaded.");
  }

  const attachments = [];
  for (const rawPath of rawPaths) {
    const { absolutePath, relativePath } = resolveWorkspaceFilePath({
      workspaceDir,
      rawPath,
    });
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error(`Attachment not found in workspace: ${rawPath}`);
    }
    const bytes = await fs.readFile(absolutePath);
    attachments.push({
      name: path.basename(absolutePath),
      contentType: detectAttachmentMime(absolutePath),
      contentBase64: bytes.toString("base64"),
      sizeBytes: bytes.byteLength,
      workspacePath: relativePath,
    });
  }

  return attachments;
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

export function createOutlookMessageSendTool(
  _api: OpenClawPluginApi,
  ctx?: OpenClawPluginToolContext,
) {
  return {
    name: "outlook_message_send",
    label: "Outlook Message Send",
    description: "Send an Outlook email message, optionally with attachments from the current workspace.",
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
      attachmentPaths: Type.Optional(
        Type.Array(
          Type.String({
            description:
              "Workspace file paths to attach, relative to the current workspace or absolute under /data/workspace.",
          }),
        ),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const to = readStringArray(params.to);
      const cc = readStringArray(params.cc);
      const bcc = readStringArray(params.bcc);
      const subject = readString(params, "subject");
      const body = readString(params, "body");
      const saveToSentItems = readBoolean(params, "saveToSentItems");
      const attachmentPaths = readStringArray(params.attachmentPaths);
      if (!subject || !body || to.length === 0) {
        throw new Error("to, subject, and body are required");
      }
      const attachments =
        attachmentPaths.length > 0
          ? await readWorkspaceAttachments(ctx, attachmentPaths)
          : [];
      return runOutlookTool("send_message", {
        to,
        ...(cc.length > 0 ? { cc } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
        subject,
        body,
        ...(attachments.length > 0 ? { attachments } : {}),
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
