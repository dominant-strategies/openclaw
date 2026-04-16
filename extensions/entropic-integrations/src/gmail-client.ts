import { callHostedIntegrationAction } from "./hosted-client.js";

export type GmailAction =
  | "search_messages"
  | "get_message"
  | "send_message"
  | "create_draft";

export async function callGmailAction(
  action: GmailAction,
  params: Record<string, unknown>,
): Promise<unknown> {
  return callHostedIntegrationAction("google-email", action, params);
}
