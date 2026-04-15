import { callHostedIntegrationAction } from "./hosted-client.js";

export type AsanaAction =
  | "list_workspaces"
  | "list_teams"
  | "list_projects"
  | "get_project"
  | "create_project"
  | "update_project"
  | "list_sections"
  | "create_section"
  | "list_tasks"
  | "search_tasks"
  | "get_task"
  | "create_task"
  | "update_task"
  | "move_task"
  | "comment_task";

export async function callAsanaAction(
  action: AsanaAction,
  params: Record<string, unknown>,
): Promise<unknown> {
  return callHostedIntegrationAction("asana", action, params);
}
