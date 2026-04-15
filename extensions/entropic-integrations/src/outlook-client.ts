import { callHostedIntegrationAction } from "./hosted-client.js";

export type OutlookAction =
  | "list_mail_folders"
  | "list_messages"
  | "get_message"
  | "send_message"
  | "list_calendars"
  | "list_events"
  | "create_event";

export async function callOutlookAction(
  action: OutlookAction,
  params: Record<string, unknown>,
): Promise<unknown> {
  return callHostedIntegrationAction("outlook", action, params);
}
