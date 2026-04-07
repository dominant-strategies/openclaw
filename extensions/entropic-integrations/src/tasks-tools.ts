import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { runGws } from "./gws.js";
import {
  asRecord,
  asRecordArray,
  jsonResult,
  readBoolean,
  readString,
  readStringField,
} from "./tool-utils.js";

export function createTasksListTool(_api: OpenClawPluginApi) {
  return {
    name: "tasks_list",
    label: "Tasks List",
    description:
      "List tasks from Google Tasks. Use taskListId to specify which list, or omit for the default list.",
    parameters: Type.Object({
      taskListId: Type.Optional(
        Type.String({ description: "Task list ID (omit for default list)." }),
      ),
      showCompleted: Type.Optional(
        Type.Boolean({ description: "Include completed tasks (default false)." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskListId = readString(params, "taskListId") || "@default";
      const showCompleted = readBoolean(params, "showCompleted", false) ?? false;

      const data = asRecord(
        await runGws(["tasks", "tasks", "list"], {
          params: {
            tasklist: taskListId,
            maxResults: 100,
            showCompleted,
          },
        }),
      );

      return jsonResult({
        tasks: asRecordArray(data?.items).map((task) => ({
          id: readStringField(task, "id"),
          title: readStringField(task, "title"),
          notes: readStringField(task, "notes") ?? null,
          status: readStringField(task, "status"),
          due: readStringField(task, "due") ?? null,
          updated: readStringField(task, "updated"),
        })),
      });
    },
  };
}

export function createTasksCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "tasks_create",
    label: "Tasks Create",
    description: "Create a new task in Google Tasks.",
    parameters: Type.Object({
      title: Type.String({ description: "Task title." }),
      notes: Type.Optional(Type.String({ description: "Task notes/description." })),
      due: Type.Optional(
        Type.String({
          description: "Due date in RFC 3339 format (e.g., '2026-03-15T00:00:00.000Z').",
        }),
      ),
      taskListId: Type.Optional(
        Type.String({ description: "Task list ID (omit for default list)." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const title = readString(params, "title");
      if (!title) {
        throw new Error("title is required");
      }
      const taskListId = readString(params, "taskListId") || "@default";

      const payload: Record<string, unknown> = { title };
      const notes = readString(params, "notes");
      if (notes) {
        payload.notes = notes;
      }
      const due = readString(params, "due");
      if (due) {
        payload.due = due;
      }

      const data = asRecord(
        await runGws(["tasks", "tasks", "insert"], {
          params: { tasklist: taskListId },
          json: payload,
        }),
      );

      return jsonResult({
        id: readStringField(data, "id"),
        title: readStringField(data, "title"),
        status: readStringField(data, "status"),
        due: readStringField(data, "due") ?? null,
      });
    },
  };
}

export function createTasksUpdateTool(_api: OpenClawPluginApi) {
  return {
    name: "tasks_update",
    label: "Tasks Update",
    description: "Update an existing task in Google Tasks (mark complete, change title, etc.).",
    parameters: Type.Object({
      taskId: Type.String({ description: "The task ID." }),
      taskListId: Type.Optional(
        Type.String({ description: "Task list ID (omit for default list)." }),
      ),
      title: Type.Optional(Type.String({ description: "New title." })),
      notes: Type.Optional(Type.String({ description: "New notes." })),
      status: Type.Optional(
        Type.String({ description: "Task status: 'needsAction' or 'completed'." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskId = readString(params, "taskId");
      if (!taskId) {
        throw new Error("taskId is required");
      }
      const taskListId = readString(params, "taskListId") || "@default";

      const patch: Record<string, unknown> = {};
      const title = readString(params, "title");
      if (title) {
        patch.title = title;
      }
      const notes = readString(params, "notes");
      if (notes !== undefined) {
        patch.notes = notes;
      }
      const status = readString(params, "status");
      if (status) {
        patch.status = status;
      }

      const data = asRecord(
        await runGws(["tasks", "tasks", "patch"], {
          params: { tasklist: taskListId, task: taskId },
          json: patch,
        }),
      );

      return jsonResult({
        id: readStringField(data, "id"),
        title: readStringField(data, "title"),
        status: readStringField(data, "status"),
        due: readStringField(data, "due") ?? null,
        updated: readStringField(data, "updated"),
      });
    },
  };
}
