import { randomUUID } from "node:crypto";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  StopReason,
  ThinkingContent,
  TextContent,
  ToolCall,
  Tool,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isNonSecretApiKeyMarker } from "./model-auth-markers.js";
import { OLLAMA_DEFAULT_BASE_URL } from "./ollama-defaults.js";
import {
  buildAssistantMessage as buildStreamAssistantMessage,
  buildAssistantMessageWithZeroUsage,
  buildStreamErrorAssistantMessage,
  buildUsageWithNoCost,
} from "./stream-message-shared.js";

const log = createSubsystemLogger("ollama-stream");

export const OLLAMA_NATIVE_BASE_URL = OLLAMA_DEFAULT_BASE_URL;

export function resolveOllamaBaseUrlForRun(params: {
  modelBaseUrl?: string;
  providerBaseUrl?: string;
}): string {
  const providerBaseUrl = params.providerBaseUrl?.trim();
  if (providerBaseUrl) {
    return providerBaseUrl;
  }
  const modelBaseUrl = params.modelBaseUrl?.trim();
  if (modelBaseUrl) {
    return modelBaseUrl;
  }
  return OLLAMA_NATIVE_BASE_URL;
}

// ── Ollama /api/chat request types ──────────────────────────────────────────

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  think?: boolean | "low" | "medium" | "high";
  tools?: OllamaTool[];
  options?: Record<string, unknown>;
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

const MAX_SAFE_INTEGER_ABS_STR = String(Number.MAX_SAFE_INTEGER);

function isAsciiDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function parseJsonNumberToken(
  input: string,
  start: number,
): { token: string; end: number; isInteger: boolean } | null {
  let idx = start;
  if (input[idx] === "-") {
    idx += 1;
  }
  if (idx >= input.length) {
    return null;
  }

  if (input[idx] === "0") {
    idx += 1;
  } else if (isAsciiDigit(input[idx]) && input[idx] !== "0") {
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  } else {
    return null;
  }

  let isInteger = true;
  if (input[idx] === ".") {
    isInteger = false;
    idx += 1;
    if (!isAsciiDigit(input[idx])) {
      return null;
    }
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  }

  if (input[idx] === "e" || input[idx] === "E") {
    isInteger = false;
    idx += 1;
    if (input[idx] === "+" || input[idx] === "-") {
      idx += 1;
    }
    if (!isAsciiDigit(input[idx])) {
      return null;
    }
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  }

  return {
    token: input.slice(start, idx),
    end: idx,
    isInteger,
  };
}

function isUnsafeIntegerLiteral(token: string): boolean {
  const digits = token[0] === "-" ? token.slice(1) : token;
  if (digits.length < MAX_SAFE_INTEGER_ABS_STR.length) {
    return false;
  }
  if (digits.length > MAX_SAFE_INTEGER_ABS_STR.length) {
    return true;
  }
  return digits > MAX_SAFE_INTEGER_ABS_STR;
}

function quoteUnsafeIntegerLiterals(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let idx = 0;

  while (idx < input.length) {
    const ch = input[idx] ?? "";
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      idx += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      idx += 1;
      continue;
    }

    if (ch === "-" || isAsciiDigit(ch)) {
      const parsed = parseJsonNumberToken(input, idx);
      if (parsed) {
        if (parsed.isInteger && isUnsafeIntegerLiteral(parsed.token)) {
          out += `"${parsed.token}"`;
        } else {
          out += parsed.token;
        }
        idx = parsed.end;
        continue;
      }
    }

    out += ch;
    idx += 1;
  }

  return out;
}

function parseJsonPreservingUnsafeIntegers(input: string): unknown {
  return JSON.parse(quoteUnsafeIntegerLiterals(input)) as unknown;
}

// ── Ollama /api/chat response types ─────────────────────────────────────────

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
    thinking?: string;
    reasoning?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

function extractOllamaReasoningText(message: OllamaChatResponse["message"] | undefined): string {
  if (!message) {
    return "";
  }
  const parts: string[] = [];
  if (typeof message.thinking === "string" && message.thinking) {
    parts.push(message.thinking);
  }
  if (
    typeof message.reasoning === "string" &&
    message.reasoning &&
    message.reasoning !== message.thinking
  ) {
    parts.push(message.reasoning);
  }
  return parts.join("");
}

function isOllamaGptOssModel(modelId: string): boolean {
  return /\bgpt-oss\b/i.test(modelId);
}

function resolveOllamaThinkSetting(params: {
  modelId: string;
  reasoning?: unknown;
}): boolean | "low" | "medium" | "high" | undefined {
  const { reasoning } = params;
  if (reasoning === undefined || reasoning === null) {
    return undefined;
  }

  if (reasoning === false) {
    return isOllamaGptOssModel(params.modelId) ? undefined : false;
  }
  if (reasoning === true) {
    return isOllamaGptOssModel(params.modelId) ? "low" : true;
  }

  if (typeof reasoning !== "string") {
    return undefined;
  }

  const normalized = reasoning.trim().toLowerCase();
  if (!normalized || normalized === "off") {
    return isOllamaGptOssModel(params.modelId) ? undefined : false;
  }

  if (isOllamaGptOssModel(params.modelId)) {
    if (normalized === "medium") {
      return "medium";
    }
    if (normalized === "high" || normalized === "xhigh") {
      return "high";
    }
    return "low";
  }

  return true;
}

function resolveOllamaStopReason(params: {
  response: OllamaChatResponse;
  hasToolCalls: boolean;
}): StopReason {
  if (params.hasToolCalls) {
    return "toolUse";
  }
  if (params.response.done_reason === "length") {
    return "length";
  }
  return "stop";
}

// ── Message conversion ──────────────────────────────────────────────────────

type InputContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function extractOllamaImages(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "image"; data: string } => part.type === "image")
    .map((part) => part.data);
}

function extractToolCalls(content: unknown): OllamaToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const parts = content as InputContentPart[];
  const result: OllamaToolCall[] = [];
  for (const part of parts) {
    if (part.type === "toolCall") {
      result.push({ function: { name: part.name, arguments: part.arguments } });
    } else if (part.type === "tool_use") {
      result.push({ function: { name: part.name, arguments: part.input } });
    }
  }
  return result;
}

export function convertToOllamaMessages(
  messages: Array<{ role: string; content: unknown }>,
  system?: string,
): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    const { role } = msg;

    if (role === "user") {
      const text = extractTextContent(msg.content);
      const images = extractOllamaImages(msg.content);
      result.push({
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
      });
    } else if (role === "assistant") {
      const text = extractTextContent(msg.content);
      const toolCalls = extractToolCalls(msg.content);
      result.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (role === "tool" || role === "toolResult") {
      // SDK uses "toolResult" (camelCase) for tool result messages.
      // Ollama API expects "tool" role with tool_name per the native spec.
      const text = extractTextContent(msg.content);
      const toolName =
        typeof (msg as { toolName?: unknown }).toolName === "string"
          ? (msg as { toolName?: string }).toolName
          : undefined;
      result.push({
        role: "tool",
        content: text,
        ...(toolName ? { tool_name: toolName } : {}),
      });
    }
  }

  return result;
}

// ── Tool extraction ─────────────────────────────────────────────────────────

function extractOllamaTools(tools: Tool[] | undefined): OllamaTool[] {
  if (!tools || !Array.isArray(tools)) {
    return [];
  }
  const result: OllamaTool[] = [];
  for (const tool of tools) {
    if (typeof tool.name !== "string" || !tool.name) {
      continue;
    }
    result.push({
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: (tool.parameters ?? {}) as Record<string, unknown>,
      },
    });
  }
  return result;
}

// ── Response conversion ─────────────────────────────────────────────────────

export function buildAssistantMessage(
  response: OllamaChatResponse,
  modelInfo: { api: string; provider: string; id: string },
): AssistantMessage {
  const content: (TextContent | ThinkingContent | ToolCall)[] = [];
  const reasoning = extractOllamaReasoningText(response.message);
  if (reasoning) {
    content.push({ type: "thinking", thinking: reasoning });
  }

  const text = response.message.content || "";
  if (text) {
    content.push({ type: "text", text });
  }

  const toolCalls = response.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      content.push({
        type: "toolCall",
        id: `ollama_call_${randomUUID()}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      });
    }
  }

  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const stopReason = resolveOllamaStopReason({
    response,
    hasToolCalls: Boolean(hasToolCalls),
  });

  return buildStreamAssistantMessage({
    model: modelInfo,
    content,
    stopReason,
    usage: buildUsageWithNoCost({
      input: response.prompt_eval_count ?? 0,
      output: response.eval_count ?? 0,
    }),
  });
}

// ── NDJSON streaming parser ─────────────────────────────────────────────────

export async function* parseNdjsonStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<OllamaChatResponse> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        yield parseJsonPreservingUnsafeIntegers(trimmed) as OllamaChatResponse;
      } catch {
        log.warn(`Skipping malformed NDJSON line: ${trimmed.slice(0, 120)}`);
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield parseJsonPreservingUnsafeIntegers(buffer.trim()) as OllamaChatResponse;
    } catch {
      log.warn(`Skipping malformed trailing data: ${buffer.trim().slice(0, 120)}`);
    }
  }
}

// ── Main StreamFn factory ───────────────────────────────────────────────────

function resolveOllamaChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const normalizedBase = trimmed.replace(/\/v1$/i, "");
  const apiBase = normalizedBase || OLLAMA_NATIVE_BASE_URL;
  return `${apiBase}/api/chat`;
}

function resolveOllamaModelHeaders(model: {
  headers?: unknown;
}): Record<string, string> | undefined {
  if (!model.headers || typeof model.headers !== "object" || Array.isArray(model.headers)) {
    return undefined;
  }
  return model.headers as Record<string, string>;
}

export function createOllamaStreamFn(
  baseUrl: string,
  defaultHeaders?: Record<string, string>,
): StreamFn {
  const chatUrl = resolveOllamaChatUrl(baseUrl);

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const ollamaMessages = convertToOllamaMessages(
          context.messages ?? [],
          context.systemPrompt,
        );

        const ollamaTools = extractOllamaTools(context.tools);

        // Ollama defaults to num_ctx=4096 which is too small for large
        // system prompts + many tool definitions. Use model's contextWindow.
        const ollamaOptions: Record<string, unknown> = { num_ctx: model.contextWindow ?? 65536 };
        if (typeof options?.temperature === "number") {
          ollamaOptions.temperature = options.temperature;
        }
        if (typeof options?.maxTokens === "number") {
          ollamaOptions.num_predict = options.maxTokens;
        }
        const think = resolveOllamaThinkSetting({
          modelId: model.id,
          reasoning: options?.reasoning,
        });

        const body: OllamaChatRequest = {
          model: model.id,
          messages: ollamaMessages,
          stream: true,
          ...(think !== undefined ? { think } : {}),
          ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
          options: ollamaOptions,
        };

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...defaultHeaders,
          ...options?.headers,
        };
        if (
          options?.apiKey &&
          (!headers.Authorization || !isNonSecretApiKeyMarker(options.apiKey))
        ) {
          headers.Authorization = `Bearer ${options.apiKey}`;
        }

        const response = await fetch(chatUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "unknown error");
          throw new Error(`Ollama API error ${response.status}: ${errorText}`);
        }

        if (!response.body) {
          throw new Error("Ollama API returned empty response body");
        }

        const reader = response.body.getReader();
        const output = buildAssistantMessageWithZeroUsage({
          model: {
            api: model.api,
            provider: model.provider,
            id: model.id,
          },
          content: [],
          stopReason: "stop",
        });
        stream.push({
          type: "start",
          partial: output,
        });

        let textBlock: TextContent | undefined;
        let textIndex = -1;
        let thinkingBlock: ThinkingContent | undefined;
        let thinkingIndex = -1;
        const streamedToolCalls: ToolCall[] = [];
        let finalResponse: OllamaChatResponse | undefined;

        for await (const chunk of parseNdjsonStream(reader)) {
          if (chunk.message?.content) {
            if (!textBlock) {
              textBlock = { type: "text", text: "" };
              output.content.push(textBlock);
              textIndex = output.content.length - 1;
              stream.push({
                type: "text_start",
                contentIndex: textIndex,
                partial: output,
              });
            }
            textBlock.text += chunk.message.content;
            stream.push({
              type: "text_delta",
              contentIndex: textIndex,
              delta: chunk.message.content,
              partial: output,
            });
          }

          const reasoningDelta = extractOllamaReasoningText(chunk.message);
          if (reasoningDelta) {
            if (!thinkingBlock) {
              thinkingBlock = { type: "thinking", thinking: "" };
              output.content.push(thinkingBlock);
              thinkingIndex = output.content.length - 1;
              stream.push({
                type: "thinking_start",
                contentIndex: thinkingIndex,
                partial: output,
              });
            }
            thinkingBlock.thinking += reasoningDelta;
            stream.push({
              type: "thinking_delta",
              contentIndex: thinkingIndex,
              delta: reasoningDelta,
              partial: output,
            });
          }

          if (chunk.message?.tool_calls) {
            for (const toolCall of chunk.message.tool_calls) {
              const streamedToolCall: ToolCall = {
                type: "toolCall",
                id: `ollama_call_${randomUUID()}`,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              };
              streamedToolCalls.push(streamedToolCall);
              output.content.push(streamedToolCall);
              const toolIndex = output.content.length - 1;
              stream.push({
                type: "toolcall_start",
                contentIndex: toolIndex,
                partial: output,
              });
              stream.push({
                type: "toolcall_end",
                contentIndex: toolIndex,
                toolCall: streamedToolCall,
                partial: output,
              });
            }
          }

          if (chunk.done) {
            finalResponse = chunk;
            break;
          }
        }

        if (!finalResponse) {
          throw new Error("Ollama API stream ended without a final response");
        }

        if (thinkingBlock) {
          stream.push({
            type: "thinking_end",
            contentIndex: thinkingIndex,
            content: thinkingBlock.thinking,
            partial: output,
          });
        }
        if (textBlock) {
          stream.push({
            type: "text_end",
            contentIndex: textIndex,
            content: textBlock.text,
            partial: output,
          });
        }

        const hasToolCalls = streamedToolCalls.length > 0;
        const stopReason = resolveOllamaStopReason({
          response: finalResponse,
          hasToolCalls,
        });
        output.stopReason = stopReason;
        output.usage = buildUsageWithNoCost({
          input: finalResponse.prompt_eval_count ?? 0,
          output: finalResponse.eval_count ?? 0,
        });

        const reason: Extract<StopReason, "stop" | "length" | "toolUse"> =
          stopReason === "toolUse" || stopReason === "length" ? stopReason : "stop";

        stream.push({
          type: "done",
          reason,
          message: output,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({
          type: "error",
          reason: "error",
          error: buildStreamErrorAssistantMessage({
            model,
            errorMessage,
          }),
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}

export function createConfiguredOllamaStreamFn(params: {
  model: { baseUrl?: string; headers?: unknown };
  providerBaseUrl?: string;
}): StreamFn {
  const modelBaseUrl = typeof params.model.baseUrl === "string" ? params.model.baseUrl : undefined;
  return createOllamaStreamFn(
    resolveOllamaBaseUrlForRun({
      modelBaseUrl,
      providerBaseUrl: params.providerBaseUrl,
    }),
    resolveOllamaModelHeaders(params.model),
  );
}
