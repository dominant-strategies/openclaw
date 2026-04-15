import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { callAsanaAction, type AsanaAction } from "./asana-client.js";
import { jsonResult, readBoolean, readNumber, readString } from "./tool-utils.js";

async function runAsanaTool(action: AsanaAction, params: Record<string, unknown>) {
  return jsonResult(await callAsanaAction(action, params));
}

function readPageParams(params: Record<string, unknown>) {
  const limit = readNumber(params, "limit");
  const offset = readString(params, "offset");
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(offset ? { offset } : {}),
  };
}

export function createAsanaWorkspacesListTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_workspaces_list",
    label: "Asana Workspaces List",
    description: "List Asana workspaces and organizations available to the connected account.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max records to return (default 50)." })),
      offset: Type.Optional(Type.String({ description: "Pagination offset from a prior call." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      return runAsanaTool("list_workspaces", readPageParams(params));
    },
  };
}

export function createAsanaTeamsListTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_teams_list",
    label: "Asana Teams List",
    description: "List teams inside an Asana workspace or organization.",
    parameters: Type.Object({
      workspaceGid: Type.String({ description: "Workspace or organization gid." }),
      limit: Type.Optional(Type.Number({ description: "Max records to return (default 50)." })),
      offset: Type.Optional(Type.String({ description: "Pagination offset from a prior call." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceGid = readString(params, "workspaceGid");
      if (!workspaceGid) {
        throw new Error("workspaceGid is required");
      }
      return runAsanaTool("list_teams", {
        workspace_gid: workspaceGid,
        ...readPageParams(params),
      });
    },
  };
}

export function createAsanaProjectsListTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_projects_list",
    label: "Asana Projects List",
    description: "List Asana projects (boards) for a workspace or team.",
    parameters: Type.Object({
      workspaceGid: Type.Optional(
        Type.String({ description: "Workspace gid. Provide this or teamGid." }),
      ),
      teamGid: Type.Optional(
        Type.String({ description: "Team gid. Provide this or workspaceGid." }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max records to return (default 50)." })),
      offset: Type.Optional(Type.String({ description: "Pagination offset from a prior call." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceGid = readString(params, "workspaceGid");
      const teamGid = readString(params, "teamGid");
      if (!workspaceGid && !teamGid) {
        throw new Error("workspaceGid or teamGid is required");
      }
      if (workspaceGid && teamGid) {
        throw new Error("Provide workspaceGid or teamGid, not both");
      }
      return runAsanaTool("list_projects", {
        ...(workspaceGid ? { workspace_gid: workspaceGid } : {}),
        ...(teamGid ? { team_gid: teamGid } : {}),
        ...readPageParams(params),
      });
    },
  };
}

export function createAsanaProjectGetTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_project_get",
    label: "Asana Project Get",
    description: "Fetch a single Asana project or board by gid.",
    parameters: Type.Object({
      projectGid: Type.String({ description: "Project gid." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const projectGid = readString(params, "projectGid");
      if (!projectGid) {
        throw new Error("projectGid is required");
      }
      return runAsanaTool("get_project", { project_gid: projectGid });
    },
  };
}

export function createAsanaProjectCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_project_create",
    label: "Asana Project Create",
    description: "Create a new Asana project or board.",
    parameters: Type.Object({
      name: Type.String({ description: "Project name." }),
      workspaceGid: Type.String({ description: "Workspace gid." }),
      teamGid: Type.Optional(
        Type.String({ description: "Team gid when required by the workspace." }),
      ),
      notes: Type.Optional(Type.String({ description: "Optional project description." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const name = readString(params, "name");
      const workspaceGid = readString(params, "workspaceGid");
      if (!name || !workspaceGid) {
        throw new Error("name and workspaceGid are required");
      }
      const teamGid = readString(params, "teamGid");
      const notes = readString(params, "notes");
      return runAsanaTool("create_project", {
        name,
        workspace_gid: workspaceGid,
        ...(teamGid ? { team_gid: teamGid } : {}),
        ...(notes ? { notes } : {}),
      });
    },
  };
}

export function createAsanaProjectUpdateTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_project_update",
    label: "Asana Project Update",
    description: "Rename, describe, or archive an Asana project.",
    parameters: Type.Object({
      projectGid: Type.String({ description: "Project gid." }),
      name: Type.Optional(Type.String({ description: "New project name." })),
      notes: Type.Optional(Type.String({ description: "Updated project notes." })),
      archived: Type.Optional(Type.Boolean({ description: "Archive or unarchive the project." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const projectGid = readString(params, "projectGid");
      if (!projectGid) {
        throw new Error("projectGid is required");
      }
      const name = readString(params, "name");
      const notes = readString(params, "notes");
      const archived = readBoolean(params, "archived");
      if (!name && !notes && archived === undefined) {
        throw new Error("Provide at least one field to update");
      }
      return runAsanaTool("update_project", {
        project_gid: projectGid,
        ...(name ? { name } : {}),
        ...(notes ? { notes } : {}),
        ...(archived !== undefined ? { archived } : {}),
      });
    },
  };
}

export function createAsanaSectionsListTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_sections_list",
    label: "Asana Sections List",
    description: "List sections (board columns) for an Asana project.",
    parameters: Type.Object({
      projectGid: Type.String({ description: "Project gid." }),
      limit: Type.Optional(Type.Number({ description: "Max records to return (default 50)." })),
      offset: Type.Optional(Type.String({ description: "Pagination offset from a prior call." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const projectGid = readString(params, "projectGid");
      if (!projectGid) {
        throw new Error("projectGid is required");
      }
      return runAsanaTool("list_sections", {
        project_gid: projectGid,
        ...readPageParams(params),
      });
    },
  };
}

export function createAsanaSectionCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_section_create",
    label: "Asana Section Create",
    description: "Create a new section (board column) in an Asana project.",
    parameters: Type.Object({
      projectGid: Type.String({ description: "Project gid." }),
      name: Type.String({ description: "Section name." }),
      insertBeforeSectionGid: Type.Optional(
        Type.String({ description: "Insert the new section before this section gid." }),
      ),
      insertAfterSectionGid: Type.Optional(
        Type.String({ description: "Insert the new section after this section gid." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const projectGid = readString(params, "projectGid");
      const name = readString(params, "name");
      if (!projectGid || !name) {
        throw new Error("projectGid and name are required");
      }
      const insertBeforeSectionGid = readString(params, "insertBeforeSectionGid");
      const insertAfterSectionGid = readString(params, "insertAfterSectionGid");
      if (insertBeforeSectionGid && insertAfterSectionGid) {
        throw new Error("Provide insertBeforeSectionGid or insertAfterSectionGid, not both");
      }
      return runAsanaTool("create_section", {
        project_gid: projectGid,
        name,
        ...(insertBeforeSectionGid ? { insert_before_section_gid: insertBeforeSectionGid } : {}),
        ...(insertAfterSectionGid ? { insert_after_section_gid: insertAfterSectionGid } : {}),
      });
    },
  };
}

export function createAsanaTasksListTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_tasks_list",
    label: "Asana Tasks List",
    description: "List tasks from an Asana project or a specific section/column.",
    parameters: Type.Object({
      projectGid: Type.Optional(
        Type.String({ description: "Project gid. Provide this or sectionGid." }),
      ),
      sectionGid: Type.Optional(
        Type.String({ description: "Section gid. Provide this or projectGid." }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max records to return (default 50)." })),
      offset: Type.Optional(Type.String({ description: "Pagination offset from a prior call." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const projectGid = readString(params, "projectGid");
      const sectionGid = readString(params, "sectionGid");
      if (!projectGid && !sectionGid) {
        throw new Error("projectGid or sectionGid is required");
      }
      if (projectGid && sectionGid) {
        throw new Error("Provide projectGid or sectionGid, not both");
      }
      return runAsanaTool("list_tasks", {
        ...(projectGid ? { project_gid: projectGid } : {}),
        ...(sectionGid ? { section_gid: sectionGid } : {}),
        ...readPageParams(params),
      });
    },
  };
}

export function createAsanaTasksSearchTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_tasks_search",
    label: "Asana Tasks Search",
    description:
      "Search tasks across an Asana workspace, with optional board, column, assignee, and completion filters.",
    parameters: Type.Object({
      workspaceGid: Type.String({ description: "Workspace gid." }),
      query: Type.Optional(Type.String({ description: "Free-text search query." })),
      projectGid: Type.Optional(Type.String({ description: "Restrict search to a project gid." })),
      sectionGid: Type.Optional(Type.String({ description: "Restrict search to a section gid." })),
      assigneeGid: Type.Optional(
        Type.String({ description: "Restrict search to an assignee gid or 'me'." }),
      ),
      completed: Type.Optional(Type.Boolean({ description: "Whether to search completed tasks." })),
      limit: Type.Optional(Type.Number({ description: "Max records to return (default 50)." })),
      offset: Type.Optional(Type.String({ description: "Pagination offset from a prior call." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceGid = readString(params, "workspaceGid");
      if (!workspaceGid) {
        throw new Error("workspaceGid is required");
      }
      const query = readString(params, "query");
      const projectGid = readString(params, "projectGid");
      const sectionGid = readString(params, "sectionGid");
      const assigneeGid = readString(params, "assigneeGid");
      const completed = readBoolean(params, "completed");
      return runAsanaTool("search_tasks", {
        workspace_gid: workspaceGid,
        ...(query ? { query } : {}),
        ...(projectGid ? { project_gid: projectGid } : {}),
        ...(sectionGid ? { section_gid: sectionGid } : {}),
        ...(assigneeGid ? { assignee_gid: assigneeGid } : {}),
        ...(completed !== undefined ? { completed } : {}),
        ...readPageParams(params),
      });
    },
  };
}

export function createAsanaTaskGetTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_task_get",
    label: "Asana Task Get",
    description: "Fetch a single Asana task by gid.",
    parameters: Type.Object({
      taskGid: Type.String({ description: "Task gid." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskGid = readString(params, "taskGid");
      if (!taskGid) {
        throw new Error("taskGid is required");
      }
      return runAsanaTool("get_task", { task_gid: taskGid });
    },
  };
}

export function createAsanaTaskCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_task_create",
    label: "Asana Task Create",
    description: "Create a new Asana task or subtask, optionally placing it onto a board column.",
    parameters: Type.Object({
      name: Type.String({ description: "Task title." }),
      workspaceGid: Type.Optional(
        Type.String({ description: "Workspace gid for standalone tasks." }),
      ),
      projectGid: Type.Optional(Type.String({ description: "Project gid to attach the task to." })),
      sectionGid: Type.Optional(
        Type.String({ description: "Section gid to place the task into." }),
      ),
      parentTaskGid: Type.Optional(
        Type.String({ description: "Parent task gid to create a subtask under." }),
      ),
      notes: Type.Optional(Type.String({ description: "Task notes or description." })),
      assigneeGid: Type.Optional(Type.String({ description: "Assignee gid or 'me'." })),
      dueOn: Type.Optional(Type.String({ description: "Due date in YYYY-MM-DD format." })),
      dueAt: Type.Optional(Type.String({ description: "Due timestamp in RFC 3339 format." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const name = readString(params, "name");
      if (!name) {
        throw new Error("name is required");
      }
      const workspaceGid = readString(params, "workspaceGid");
      const projectGid = readString(params, "projectGid");
      const sectionGid = readString(params, "sectionGid");
      const parentTaskGid = readString(params, "parentTaskGid");
      const notes = readString(params, "notes");
      const assigneeGid = readString(params, "assigneeGid");
      const dueOn = readString(params, "dueOn");
      const dueAt = readString(params, "dueAt");
      if (!workspaceGid && !projectGid && !parentTaskGid) {
        throw new Error("workspaceGid, projectGid, or parentTaskGid is required");
      }
      return runAsanaTool("create_task", {
        name,
        ...(workspaceGid ? { workspace_gid: workspaceGid } : {}),
        ...(projectGid ? { project_gid: projectGid } : {}),
        ...(sectionGid ? { section_gid: sectionGid } : {}),
        ...(parentTaskGid ? { parent_task_gid: parentTaskGid } : {}),
        ...(notes ? { notes } : {}),
        ...(assigneeGid ? { assignee_gid: assigneeGid } : {}),
        ...(dueOn ? { due_on: dueOn } : {}),
        ...(dueAt ? { due_at: dueAt } : {}),
      });
    },
  };
}

export function createAsanaTaskUpdateTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_task_update",
    label: "Asana Task Update",
    description: "Rename a task, change ownership or due date, or mark it complete/incomplete.",
    parameters: Type.Object({
      taskGid: Type.String({ description: "Task gid." }),
      name: Type.Optional(Type.String({ description: "Updated task title." })),
      notes: Type.Optional(Type.String({ description: "Updated task notes." })),
      assigneeGid: Type.Optional(Type.String({ description: "Assignee gid or 'me'." })),
      dueOn: Type.Optional(Type.String({ description: "Due date in YYYY-MM-DD format." })),
      dueAt: Type.Optional(Type.String({ description: "Due timestamp in RFC 3339 format." })),
      completed: Type.Optional(
        Type.Boolean({ description: "Mark the task complete or incomplete." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskGid = readString(params, "taskGid");
      if (!taskGid) {
        throw new Error("taskGid is required");
      }
      const name = readString(params, "name");
      const notes = readString(params, "notes");
      const assigneeGid = readString(params, "assigneeGid");
      const dueOn = readString(params, "dueOn");
      const dueAt = readString(params, "dueAt");
      const completed = readBoolean(params, "completed");
      if (!name && !notes && !assigneeGid && !dueOn && !dueAt && completed === undefined) {
        throw new Error("Provide at least one task field to update");
      }
      return runAsanaTool("update_task", {
        task_gid: taskGid,
        ...(name ? { name } : {}),
        ...(notes ? { notes } : {}),
        ...(assigneeGid ? { assignee_gid: assigneeGid } : {}),
        ...(dueOn ? { due_on: dueOn } : {}),
        ...(dueAt ? { due_at: dueAt } : {}),
        ...(completed !== undefined ? { completed } : {}),
      });
    },
  };
}

export function createAsanaTaskMoveTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_task_move",
    label: "Asana Task Move",
    description: "Move a task into a different Asana section or reorder it inside a section.",
    parameters: Type.Object({
      taskGid: Type.String({ description: "Task gid." }),
      sectionGid: Type.String({ description: "Destination section gid." }),
      insertBeforeTaskGid: Type.Optional(
        Type.String({ description: "Insert before this task gid." }),
      ),
      insertAfterTaskGid: Type.Optional(
        Type.String({ description: "Insert after this task gid." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskGid = readString(params, "taskGid");
      const sectionGid = readString(params, "sectionGid");
      if (!taskGid || !sectionGid) {
        throw new Error("taskGid and sectionGid are required");
      }
      const insertBeforeTaskGid = readString(params, "insertBeforeTaskGid");
      const insertAfterTaskGid = readString(params, "insertAfterTaskGid");
      if (insertBeforeTaskGid && insertAfterTaskGid) {
        throw new Error("Provide insertBeforeTaskGid or insertAfterTaskGid, not both");
      }
      return runAsanaTool("move_task", {
        task_gid: taskGid,
        section_gid: sectionGid,
        ...(insertBeforeTaskGid ? { insert_before_task_gid: insertBeforeTaskGid } : {}),
        ...(insertAfterTaskGid ? { insert_after_task_gid: insertAfterTaskGid } : {}),
      });
    },
  };
}

export function createAsanaTaskCommentTool(_api: OpenClawPluginApi) {
  return {
    name: "asana_task_comment",
    label: "Asana Task Comment",
    description: "Add a comment to an Asana task.",
    parameters: Type.Object({
      taskGid: Type.String({ description: "Task gid." }),
      text: Type.String({ description: "Comment text." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskGid = readString(params, "taskGid");
      const text = readString(params, "text");
      if (!taskGid || !text) {
        throw new Error("taskGid and text are required");
      }
      return runAsanaTool("comment_task", {
        task_gid: taskGid,
        text,
      });
    },
  };
}
