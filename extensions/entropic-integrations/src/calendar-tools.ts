import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getGoogleAccessToken } from "./google.js";
import {
  asRecord,
  asRecordArray,
  jsonResult,
  readNumber,
  readString,
  readStringField,
  readStringList,
} from "./tool-utils.js";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary";

async function calendarFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${CALENDAR_API_BASE}/${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

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
      const token = await getGoogleAccessToken("google_calendar");
      const timeMin = readString(params, "timeMin");
      const timeMax = readString(params, "timeMax");
      const maxResults = readNumber(params, "maxResults", 10) ?? 10;

      const search = new URLSearchParams({
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(maxResults),
      });
      if (timeMin) {
        search.set("timeMin", timeMin);
      }
      if (timeMax) {
        search.set("timeMax", timeMax);
      }

      const data = await calendarFetch<Record<string, unknown>>(
        `events?${search.toString()}`,
        token,
      );
      const events = asRecordArray(data.items).map((item) => {
        const start = asRecord(item.start);
        const end = asRecord(item.end);
        return {
          id: readStringField(item, "id"),
          summary: readStringField(item, "summary"),
          start: readStringField(start, "dateTime") ?? readStringField(start, "date"),
          end: readStringField(end, "dateTime") ?? readStringField(end, "date"),
          attendees: readStringList(item.attendees, "email"),
        };
      });

      return jsonResult({ events });
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
      const token = await getGoogleAccessToken("google_calendar");
      const description = readString(params, "description");
      const attendees = Array.isArray(params.attendees)
        ? params.attendees.filter((value): value is string => typeof value === "string")
        : undefined;

      const payload = {
        summary,
        description,
        start: { dateTime: start },
        end: { dateTime: end },
        attendees: attendees?.map((email) => ({ email })),
      };

      const data = await calendarFetch<Record<string, unknown>>("events", token, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      return jsonResult({
        id: readStringField(data, "id"),
        status: readStringField(data, "status") ?? "created",
      });
    },
  };
}
