import { callHostedIntegrationAction } from "./hosted-client.js";

export type OneDriveAction =
  | "list_items"
  | "search_items"
  | "resolve_item_by_path"
  | "get_item"
  | "get_item_content"
  | "download_item"
  | "create_share_link"
  | "create_folder"
  | "upload_text_file"
  | "upload_base64_file"
  | "move_item";

export async function callOneDriveAction(
  action: OneDriveAction,
  params: Record<string, unknown>,
): Promise<unknown> {
  return callHostedIntegrationAction("onedrive", action, params);
}
