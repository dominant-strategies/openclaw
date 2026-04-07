import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { runGws } from "./gws.js";
import { asRecord, asRecordArray, jsonResult, readString, readStringField } from "./tool-utils.js";

function extractText(body: unknown): string {
  const bodyRecord = asRecord(body);
  if (!bodyRecord?.content) {
    return "";
  }
  const parts: string[] = [];
  for (const element of asRecordArray(bodyRecord.content)) {
    const paragraph = asRecord(element.paragraph);
    if (paragraph?.elements) {
      for (const paragraphElement of asRecordArray(paragraph.elements)) {
        const textRun = asRecord(paragraphElement.textRun);
        const content = readStringField(textRun, "content");
        if (content) {
          parts.push(content);
        }
      }
    }
    const table = asRecord(element.table);
    if (table?.tableRows) {
      for (const row of asRecordArray(table.tableRows)) {
        const cells: string[] = [];
        for (const cell of asRecordArray(row.tableCells)) {
          cells.push(extractText(cell));
        }
        parts.push(cells.join("\t"));
      }
    }
  }
  return parts.join("");
}

export function createDocsReadTool(_api: OpenClawPluginApi) {
  return {
    name: "docs_read",
    label: "Docs Read",
    description: "Read the text content of a Google Doc.",
    parameters: Type.Object({
      documentId: Type.String({ description: "The Google Doc ID (from the URL)." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const documentId = readString(params, "documentId");
      if (!documentId) {
        throw new Error("documentId is required");
      }

      const doc = asRecord(
        await runGws(["docs", "documents", "get"], {
          params: { documentId },
        }),
      );
      const text = extractText(doc?.body);

      return jsonResult({
        documentId: readStringField(doc, "documentId"),
        title: readStringField(doc, "title"),
        content: text,
      });
    },
  };
}

export function createDocsEditTool(_api: OpenClawPluginApi) {
  return {
    name: "docs_edit",
    label: "Docs Edit",
    description: "Edit a Google Doc by inserting or replacing text.",
    parameters: Type.Object({
      documentId: Type.String({ description: "The Google Doc ID." }),
      insertText: Type.Optional(
        Type.String({ description: "Text to insert at the end of the document." }),
      ),
      replaceText: Type.Optional(
        Type.Object({
          find: Type.String({ description: "Text to find." }),
          replace: Type.String({ description: "Replacement text." }),
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const documentId = readString(params, "documentId");
      if (!documentId) {
        throw new Error("documentId is required");
      }

      const insertText = readString(params, "insertText");
      const replaceText = asRecord(params.replaceText);
      const replaceFind = readStringField(replaceText, "find");
      const replaceValue = readStringField(replaceText, "replace");

      if (!insertText && (!replaceFind || !replaceValue)) {
        throw new Error("Either insertText or replaceText is required");
      }

      const requests: Record<string, unknown>[] = [];

      if (replaceFind && replaceValue) {
        requests.push({
          replaceAllText: {
            containsText: { text: replaceFind, matchCase: true },
            replaceText: replaceValue,
          },
        });
      }

      if (insertText) {
        requests.push({
          insertText: {
            endOfSegmentLocation: { segmentId: "" },
            text: insertText,
          },
        });
      }

      const result = asRecord(
        await runGws(["docs", "documents", "batchUpdate"], {
          params: { documentId },
          json: { requests },
        }),
      );

      return jsonResult({
        documentId: readStringField(result, "documentId"),
        replies: result?.replies,
      });
    },
  };
}

export function createDocsCreateTool(_api: OpenClawPluginApi) {
  return {
    name: "docs_create",
    label: "Docs Create",
    description: "Create a new Google Doc.",
    parameters: Type.Object({
      title: Type.String({ description: "Document title." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const title = readString(params, "title");
      if (!title) {
        throw new Error("title is required");
      }

      const data = asRecord(
        await runGws(["docs", "documents", "create"], {
          json: { title },
        }),
      );

      return jsonResult({
        documentId: readStringField(data, "documentId"),
        title: readStringField(data, "title"),
      });
    },
  };
}
