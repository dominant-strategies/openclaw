import { Buffer } from "node:buffer";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { callGmailAction } from "./gmail-client.js";
import {
  jsonResult,
  readNumber,
  readString,
} from "./tool-utils.js";

function isAscii(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) > 0x7f) {
      return false;
    }
  }
  return true;
}

function encodeHeader(value: string): string {
  if (isAscii(value)) {
    return value;
  }
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

export function createGmailSearchTool(_api: OpenClawPluginApi) {
  return {
    name: "gmail_search",
    label: "Gmail Search",
    description: "Search Gmail messages using Gmail query syntax.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ description: "Gmail search query (e.g., from:alice newer_than:7d)." }),
      ),
      maxResults: Type.Optional(
        Type.Number({ description: "Max messages to return (default 10)." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const query = readString(params, "query") || "in:inbox";
      const maxResults = readNumber(params, "maxResults", 10) ?? 10;
      return jsonResult(
        await callGmailAction("search_messages", {
          query,
          maxResults,
        }),
      );
    },
  };
}

export function createGmailGetTool(_api: OpenClawPluginApi) {
  return {
    name: "gmail_get",
    label: "Gmail Get",
    description: "Fetch a Gmail message by id.",
    parameters: Type.Object({
      id: Type.String({ description: "Gmail message id." }),
      format: Type.Optional(
        Type.String({ description: "Format: metadata or full (default metadata)." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const msgId = readString(params, "id");
      if (!msgId) {
        throw new Error("id required");
      }
      const format = readString(params, "format") || "metadata";
      return jsonResult(
        await callGmailAction("get_message", {
          id: msgId,
          format,
        }),
      );
    },
  };
}

export function createGmailSendTool(_api: OpenClawPluginApi) {
  return {
    name: "gmail_send",
    label: "Gmail Send",
    description: "Send an email via Gmail.",
    parameters: Type.Object({
      to: Type.Union([Type.String(), Type.Array(Type.String())], {
        description: "Recipient email(s).",
      }),
      subject: Type.String({ description: "Email subject." }),
      body: Type.String({ description: "Email body (plain text)." }),
      cc: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
      bcc: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const toRaw = params.to;
      const subject = readString(params, "subject");
      const body = readString(params, "body");
      if (!subject || !body) {
        throw new Error("subject and body required");
      }

      const normalizeList = (value: unknown): string[] => {
        if (Array.isArray(value)) {
          return value
            .filter((v) => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean);
        }
        if (typeof value === "string") {
          const trimmed = value.trim();
          return trimmed ? [trimmed] : [];
        }
        return [];
      };

      const to = normalizeList(toRaw);
      if (to.length === 0) {
        throw new Error("to required");
      }
      const cc = normalizeList(params.cc);
      const bcc = normalizeList(params.bcc);

      const lines = [
        `To: ${to.join(", ")}`,
        cc.length ? `Cc: ${cc.join(", ")}` : "",
        bcc.length ? `Bcc: ${bcc.join(", ")}` : "",
        `Subject: ${encodeHeader(subject)}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ].filter(Boolean);

      const rawEmail = lines.join("\r\n");
      const encodedEmail = Buffer.from(rawEmail, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      return jsonResult(
        await callGmailAction("send_message", {
          raw: encodedEmail,
        }),
      );
    },
  };
}

export function createGmailDraftTool(_api: OpenClawPluginApi) {
  return {
    name: "gmail_draft",
    label: "Gmail Draft",
    description: "Create an email draft in Gmail (saves without sending).",
    parameters: Type.Object({
      to: Type.Union([Type.String(), Type.Array(Type.String())], {
        description: "Recipient email(s).",
      }),
      subject: Type.String({ description: "Email subject." }),
      body: Type.String({ description: "Email body (plain text)." }),
      cc: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
      bcc: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const toRaw = params.to;
      const subject = readString(params, "subject");
      const body = readString(params, "body");
      if (!subject || !body) {
        throw new Error("subject and body required");
      }

      const normalizeList = (value: unknown): string[] => {
        if (Array.isArray(value)) {
          return value
            .filter((v) => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean);
        }
        if (typeof value === "string") {
          const trimmed = value.trim();
          return trimmed ? [trimmed] : [];
        }
        return [];
      };

      const to = normalizeList(toRaw);
      if (to.length === 0) {
        throw new Error("to required");
      }
      const cc = normalizeList(params.cc);
      const bcc = normalizeList(params.bcc);

      const lines = [
        `To: ${to.join(", ")}`,
        cc.length ? `Cc: ${cc.join(", ")}` : "",
        bcc.length ? `Bcc: ${bcc.join(", ")}` : "",
        `Subject: ${encodeHeader(subject)}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ].filter(Boolean);

      const rawEmail = lines.join("\r\n");
      const encodedEmail = Buffer.from(rawEmail, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      return jsonResult(
        await callGmailAction("create_draft", {
          raw: encodedEmail,
        }),
      );
    },
  };
}
