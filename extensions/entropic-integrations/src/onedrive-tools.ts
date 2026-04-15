import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { callOneDriveAction, type OneDriveAction } from "./onedrive-client.js";
import { createDocxFromText } from "./docx.js";
import {
  asRecord,
  jsonResult,
  readBoolean,
  readNumber,
  readString,
  readStringField,
} from "./tool-utils.js";

async function runOneDriveTool(action: OneDriveAction, params: Record<string, unknown>) {
  return jsonResult(await callOneDriveAction(action, params));
}

function readPageParams(params: Record<string, unknown>) {
  const limit = readNumber(params, "limit");
  const nextLink = readString(params, "nextLink");
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(nextLink ? { nextLink } : {}),
  };
}

function readItemLocator(params: Record<string, unknown>) {
  const itemId = readString(params, "itemId");
  const path = readString(params, "path");
  if (!itemId && !path) {
    throw new Error("itemId or path is required");
  }
  if (itemId && path) {
    throw new Error("Provide itemId or path, not both");
  }
  return {
    ...(itemId ? { itemId } : {}),
    ...(path ? { path } : {}),
  };
}

function readPayloadNumber(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function resolveWorkspaceDestination(params: {
  workspaceDir: string;
  requestedPath?: string;
  fallbackName: string;
}) {
  const workspaceRoot = path.resolve(params.workspaceDir);
  const rawRelative = params.requestedPath?.trim() || params.fallbackName.trim();
  const normalizedRelative = rawRelative.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedRelative) {
    throw new Error("A destination file path is required");
  }

  const destination = path.resolve(workspaceRoot, normalizedRelative);
  const relative = path.relative(workspaceRoot, destination);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("outputPath must stay inside the current workspace");
  }

  return {
    destination,
    relativePath: relative || path.basename(destination),
  };
}

async function loadDownloadBytes(payload: Record<string, unknown>) {
  const inlineBase64 = readStringField(payload, "content_base64");
  if (inlineBase64) {
    return Buffer.from(inlineBase64, "base64");
  }

  const downloadUrl = readStringField(payload, "download_url");
  if (!downloadUrl) {
    return null;
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`OneDrive download URL fetch failed with ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes;
}

async function saveOneDriveDownloadToWorkspace(params: {
  ctx: OpenClawPluginToolContext;
  payload: Record<string, unknown>;
  outputPath?: string;
}) {
  const workspaceDir = params.ctx.workspaceDir?.trim();
  if (!workspaceDir) {
    return {
      saved: false as const,
      reason: "Workspace path is unavailable for this tool run.",
    };
  }

  const item = asRecord(params.payload.item);
  const fallbackName =
    readStringField(item, "name") || readStringField(item, "id") || "onedrive-download";
  const { destination, relativePath } = resolveWorkspaceDestination({
    workspaceDir,
    requestedPath: params.outputPath,
    fallbackName,
  });
  const bytes = await loadDownloadBytes(params.payload);
  if (!bytes) {
    return {
      saved: false as const,
      reason: "No file bytes were returned for this OneDrive item.",
    };
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return {
    saved: true as const,
    absolutePath: destination,
    relativePath,
    sizeBytes: bytes.byteLength,
  };
}

export function createOneDriveItemsListTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_items_list",
    label: "OneDrive Items List",
    description: "List files and folders from the OneDrive root or a specific folder.",
    parameters: Type.Object({
      itemId: Type.Optional(Type.String({ description: "Optional parent folder item id." })),
      limit: Type.Optional(Type.Number({ description: "Max items to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior OneDrive list call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const itemId = readString(params, "itemId");
      return runOneDriveTool("list_items", {
        ...(itemId ? { itemId } : {}),
        ...readPageParams(params),
      });
    },
  };
}

export function createOneDriveItemsSearchTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_items_search",
    label: "OneDrive Items Search",
    description: "Search OneDrive files and folders by name or indexed text.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query." }),
      limit: Type.Optional(Type.Number({ description: "Max items to return (default 25)." })),
      nextLink: Type.Optional(
        Type.String({ description: "Pagination link returned by a prior OneDrive search call." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const query = readString(params, "query");
      if (!query) {
        throw new Error("query is required");
      }
      return runOneDriveTool("search_items", {
        query,
        ...readPageParams(params),
      });
    },
  };
}

export function createOneDriveItemGetTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_item_get",
    label: "OneDrive Item Get",
    description: "Fetch metadata for a OneDrive file or folder by item id.",
    parameters: Type.Object({
      itemId: Type.String({ description: "OneDrive item id." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const itemId = readString(params, "itemId");
      if (!itemId) {
        throw new Error("itemId is required");
      }
      return runOneDriveTool("get_item", { itemId });
    },
  };
}

export function createOneDriveItemResolveByPathTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_item_resolve_path",
    label: "OneDrive Item Resolve Path",
    description: "Resolve a OneDrive item by its path from the drive root.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path relative to the OneDrive root, e.g. Reports/Q1/plan.pdf",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const path = readString(params, "path");
      if (!path) {
        throw new Error("path is required");
      }
      return runOneDriveTool("resolve_item_by_path", { path });
    },
  };
}

export function createOneDriveItemContentGetTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_item_content_get",
    label: "OneDrive Item Content Get",
    description: "Fetch the contents of a OneDrive item. Best for text-like files.",
    parameters: Type.Object({
      itemId: Type.String({ description: "OneDrive item id." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const itemId = readString(params, "itemId");
      if (!itemId) {
        throw new Error("itemId is required");
      }
      return runOneDriveTool("get_item_content", { itemId });
    },
  };
}

export function createOneDriveItemDownloadTool(
  _api: OpenClawPluginApi,
  ctx?: OpenClawPluginToolContext,
) {
  return {
    name: "onedrive_item_download",
    label: "OneDrive Item Download",
    description:
      "Download a OneDrive file. Saves it into the active workspace by default and also returns download metadata.",
    parameters: Type.Object({
      itemId: Type.Optional(Type.String({ description: "OneDrive item id." })),
      path: Type.Optional(
        Type.String({ description: "Path relative to the OneDrive root." }),
      ),
      maxBytes: Type.Optional(
        Type.Number({
          description: "Maximum bytes to inline as base64 before returning URL-only metadata.",
        }),
      ),
      saveToWorkspace: Type.Optional(
        Type.Boolean({
          description:
            "Whether to save the file into the current workspace. Defaults to true.",
        }),
      ),
      outputPath: Type.Optional(
        Type.String({
          description:
            "Optional relative workspace path for the saved file, e.g. imports/report.pdf",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const maxBytes = readNumber(params, "maxBytes");
      const payload = asRecord(
        await callOneDriveAction("download_item", {
          ...readItemLocator(params),
          ...(maxBytes !== undefined ? { maxBytes } : {}),
        }),
      );
      if (!payload) {
        throw new Error("OneDrive did not return a download payload");
      }

      const saveToWorkspace = readBoolean(params, "saveToWorkspace", true) !== false;
      const outputPath = readString(params, "outputPath");
      const item = asRecord(payload.item);
      const itemName = readStringField(item, "name") || "OneDrive file";

      let workspaceResult:
        | {
            saved: true;
            absolutePath: string;
            relativePath: string;
            sizeBytes: number;
          }
        | { saved: false; reason: string }
        | null = null;

      if (saveToWorkspace) {
        workspaceResult = await saveOneDriveDownloadToWorkspace({
          ctx: ctx ?? {},
          payload,
          outputPath,
        });
      }

      const responsePayload = {
        item: payload.item ?? null,
        download_url: readStringField(payload, "download_url") ?? null,
        download_available: payload.download_available === true,
        content_type: readStringField(payload, "content_type") ?? null,
        size_bytes: readPayloadNumber(payload, "size_bytes"),
        too_large: payload.too_large === true,
        max_bytes: readPayloadNumber(payload, "max_bytes"),
        expires_at: readStringField(payload, "expires_at") ?? null,
        saved_to_workspace: workspaceResult?.saved === true,
        workspace_path: workspaceResult?.saved ? workspaceResult.absolutePath : null,
        workspace_relative_path: workspaceResult?.saved ? workspaceResult.relativePath : null,
        save_error:
          workspaceResult && !workspaceResult.saved ? workspaceResult.reason : null,
        download_url_present: typeof readStringField(payload, "download_url") === "string",
        inline_bytes_present: typeof readStringField(payload, "content_base64") === "string",
      };

      const summary = workspaceResult?.saved
        ? `Downloaded ${itemName} from OneDrive and saved it to the workspace at ${workspaceResult.relativePath}.`
        : `Downloaded ${itemName} from OneDrive.${
            responsePayload.save_error ? ` Workspace save was skipped: ${responsePayload.save_error}` : ""
          }`;

      return {
        content: [{ type: "text" as const, text: summary }],
        details: responsePayload,
      };
    },
  };
}

export function createOneDriveItemShareTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_item_share",
    label: "OneDrive Item Share",
    description: "Create a OneDrive share link for an item.",
    parameters: Type.Object({
      itemId: Type.String({ description: "OneDrive item id." }),
      type: Type.Optional(
        Type.String({ description: "Share link type such as view or edit." }),
      ),
      scope: Type.Optional(
        Type.String({ description: "Share link scope such as organization or anonymous." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const itemId = readString(params, "itemId");
      if (!itemId) {
        throw new Error("itemId is required");
      }
      const type = readString(params, "type");
      const scope = readString(params, "scope");
      return runOneDriveTool("create_share_link", {
        itemId,
        ...(type ? { type } : {}),
        ...(scope ? { scope } : {}),
      });
    },
  };
}

export function createOneDriveFolderCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_folder_create",
    label: "OneDrive Folder Create",
    description: "Create a folder in OneDrive.",
    parameters: Type.Object({
      name: Type.String({ description: "Folder name." }),
      parentItemId: Type.Optional(Type.String({ description: "Optional parent folder item id." })),
      conflictBehavior: Type.Optional(
        Type.String({ description: "Graph conflict behavior, default rename." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const name = readString(params, "name");
      if (!name) {
        throw new Error("name is required");
      }
      const parentItemId = readString(params, "parentItemId");
      const conflictBehavior = readString(params, "conflictBehavior");
      return runOneDriveTool("create_folder", {
        name,
        ...(parentItemId ? { parentItemId } : {}),
        ...(conflictBehavior ? { conflictBehavior } : {}),
      });
    },
  };
}

export function createOneDriveTextFileUploadTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_text_file_upload",
    label: "OneDrive Text File Upload",
    description: "Upload or replace a text file in OneDrive.",
    parameters: Type.Object({
      filename: Type.String({ description: "Target file name." }),
      content: Type.String({ description: "Text content to upload." }),
      parentItemId: Type.Optional(Type.String({ description: "Optional parent folder item id." })),
      conflictBehavior: Type.Optional(
        Type.String({ description: "Graph conflict behavior, default replace." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const filename = readString(params, "filename");
      const content = readString(params, "content");
      if (!filename || content === undefined) {
        throw new Error("filename and content are required");
      }
      const parentItemId = readString(params, "parentItemId");
      const conflictBehavior = readString(params, "conflictBehavior");
      return runOneDriveTool("upload_text_file", {
        filename,
        content,
        ...(parentItemId ? { parentItemId } : {}),
        ...(conflictBehavior ? { conflictBehavior } : {}),
      });
    },
  };
}

export function createOneDriveBase64FileUploadTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_base64_file_upload",
    label: "OneDrive Base64 File Upload",
    description:
      "Upload arbitrary file bytes to OneDrive using a base64-encoded payload.",
    parameters: Type.Object({
      filename: Type.String({ description: "Target file name." }),
      contentBase64: Type.String({ description: "Base64-encoded file bytes." }),
      parentItemId: Type.Optional(Type.String({ description: "Optional parent folder item id." })),
      conflictBehavior: Type.Optional(
        Type.String({ description: "Graph conflict behavior, default replace." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const filename = readString(params, "filename");
      const contentBase64 = readString(params, "contentBase64");
      if (!filename || !contentBase64) {
        throw new Error("filename and contentBase64 are required");
      }
      const parentItemId = readString(params, "parentItemId");
      const conflictBehavior = readString(params, "conflictBehavior");
      return runOneDriveTool("upload_base64_file", {
        filename,
        contentBase64,
        ...(parentItemId ? { parentItemId } : {}),
        ...(conflictBehavior ? { conflictBehavior } : {}),
      });
    },
  };
}

export function createOneDriveDocxCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_docx_create",
    label: "OneDrive DOCX Create",
    description:
      "Create a real .docx Word document in OneDrive from plain text content.",
    parameters: Type.Object({
      filename: Type.String({ description: "Target file name. .docx is appended if missing." }),
      content: Type.String({ description: "Document body text." }),
      parentItemId: Type.Optional(Type.String({ description: "Optional parent folder item id." })),
      conflictBehavior: Type.Optional(
        Type.String({ description: "Graph conflict behavior, default replace." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      let filename = readString(params, "filename");
      const content = readString(params, "content");
      if (!filename || content === undefined) {
        throw new Error("filename and content are required");
      }
      if (!filename.toLowerCase().endsWith(".docx")) {
        filename = `${filename}.docx`;
      }
      const parentItemId = readString(params, "parentItemId");
      const conflictBehavior = readString(params, "conflictBehavior");
      const bytes = await createDocxFromText({
        title: filename.replace(/\.docx$/i, ""),
        content,
      });
      return runOneDriveTool("upload_base64_file", {
        filename,
        contentBase64: Buffer.from(bytes).toString("base64"),
        ...(parentItemId ? { parentItemId } : {}),
        ...(conflictBehavior ? { conflictBehavior } : {}),
      });
    },
  };
}

export function createOneDriveItemMoveTool(_api: OpenClawPluginApi) {
  return {
    name: "onedrive_item_move",
    label: "OneDrive Item Move",
    description: "Move or rename a OneDrive item.",
    parameters: Type.Object({
      itemId: Type.String({ description: "OneDrive item id." }),
      parentItemId: Type.Optional(Type.String({ description: "Destination parent folder id." })),
      name: Type.Optional(Type.String({ description: "Optional new item name." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const itemId = readString(params, "itemId");
      if (!itemId) {
        throw new Error("itemId is required");
      }
      const parentItemId = readString(params, "parentItemId");
      const name = readString(params, "name");
      if (!parentItemId && !name) {
        throw new Error("parentItemId or name is required");
      }
      return runOneDriveTool("move_item", {
        itemId,
        ...(parentItemId ? { parentItemId } : {}),
        ...(name ? { name } : {}),
      });
    },
  };
}
