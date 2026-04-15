import { callHostedIntegrationAction } from "./hosted-client.js";

export type MicrosoftTeamsAction =
  | "list_teams"
  | "list_channels"
  | "get_channel"
  | "list_channel_messages"
  | "send_channel_message";

export async function callMicrosoftTeamsAction(
  action: MicrosoftTeamsAction,
  params: Record<string, unknown>,
): Promise<unknown> {
  return callHostedIntegrationAction("microsoft-teams", action, params);
}
