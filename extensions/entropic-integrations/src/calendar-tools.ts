import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { callGoogleCalendarAction } from "./google-calendar-client.js";
import {
  jsonResult,
  readNumber,
  readString,
} from "./tool-utils.js";

export function createCalendarListTool(_api: OpenClawPluginApi) {
  return {
    name: "calendar_list",
    label: "Calendar List",
    description: "List upcoming Google Calendar events.",
    parameters: Type.Object({
      timeMin: Type.Optional(Type.String({ description: "Start time ISO8601." })),
      timeMax: Type.Optional(Type.String({ description: "End time ISO8601." })),
      maxResults: Type.Optional(Type.Number({ description: "Max events to return (default 10)." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const timeMin = readString(params, "timeMin");
      const timeMax = readString(params, "timeMax");
      const maxResults = readNumber(params, "maxResults", 10) ?? 10;
      return jsonResult(
        await callGoogleCalendarAction("list_events", {
          ...(timeMin ? { timeMin } : {}),
          ...(timeMax ? { timeMax } : {}),
          maxResults,
        }),
      );
    },
  };
}

export function createCalendarCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "calendar_create",
    label: "Calendar Create",
    description: "Create a Google Calendar event.",
    parameters: Type.Object({
      summary: Type.String({ description: "Event summary/title." }),
      description: Type.Optional(Type.String({ description: "Event description." })),
      start: Type.String({ description: "Start time ISO8601." }),
      end: Type.String({ description: "End time ISO8601." }),
      attendees: Type.Optional(Type.Array(Type.String({ description: "Attendee email." }))),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const summary = readString(params, "summary");
      const start = readString(params, "start");
      const end = readString(params, "end");
      if (!summary || !start || !end) {
        throw new Error("summary, start, and end required");
      }
      const description = readString(params, "description");
      const attendees = Array.isArray(params.attendees)
        ? params.attendees.filter((value): value is string => typeof value === "string")
        : undefined;
      return jsonResult(
        await callGoogleCalendarAction("create_event", {
          summary,
          start,
          end,
          ...(description ? { description } : {}),
          ...(attendees?.length ? { attendees } : {}),
        }),
      );
    },
  };
}
