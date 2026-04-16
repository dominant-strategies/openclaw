import { callHostedIntegrationAction } from "./hosted-client.js";

export type GoogleCalendarAction = "list_events" | "create_event";

export async function callGoogleCalendarAction(
  action: GoogleCalendarAction,
  params: Record<string, unknown>,
): Promise<unknown> {
  return callHostedIntegrationAction("google-calendar", action, params);
}
