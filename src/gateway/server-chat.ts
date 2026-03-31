import { DEFAULT_HEARTBEAT_ACK_MAX_CHARS, stripHeartbeatToken } from "../auto-reply/heartbeat.js";
import { normalizeVerboseLevel } from "../auto-reply/thinking.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { loadConfig } from "../config/config.js";
import { type AgentEventPayload, getAgentRunContext } from "../infra/agent-events.js";
import { resolveHeartbeatVisibility } from "../infra/heartbeat-visibility.js";
import { stripInlineDirectiveTagsForDisplay } from "../utils/directive-tags.js";
import {
  deriveGatewaySessionLifecycleSnapshot,
  persistGatewaySessionLifecycleEvent,
} from "./session-lifecycle-state.js";
import { loadGatewaySessionRow, loadSessionEntry } from "./session-utils.js";
import { formatForLog } from "./ws-log.js";

function resolveHeartbeatAckMaxChars(): number {
  try {
    const cfg = loadConfig();
    return Math.max(
      0,
      cfg.agents?.defaults?.heartbeat?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
    );
  } catch {
    return DEFAULT_HEARTBEAT_ACK_MAX_CHARS;
  }
}

function resolveHeartbeatContext(runId: string, sourceRunId?: string) {
  const primary = getAgentRunContext(runId);
  if (primary?.isHeartbeat) {
    return primary;
  }
  if (sourceRunId && sourceRunId !== runId) {
    const source = getAgentRunContext(sourceRunId);
    if (source?.isHeartbeat) {
      return source;
    }
  }
  return primary;
}

/**
 * Check if heartbeat ACK/noise should be hidden from interactive chat surfaces.
 */
function shouldHideHeartbeatChatOutput(runId: string, sourceRunId?: string): boolean {
  const runContext = resolveHeartbeatContext(runId, sourceRunId);
  if (!runContext?.isHeartbeat) {
    return false;
  }

  try {
    const cfg = loadConfig();
    const visibility = resolveHeartbeatVisibility({ cfg, channel: "webchat" });
    return !visibility.showOk;
  } catch {
    // Default to suppressing if we can't load config
    return true;
  }
}

function normalizeHeartbeatChatFinalText(params: {
  runId: string;
  sourceRunId?: string;
  text: string;
}): { suppress: boolean; text: string } {
  if (!shouldHideHeartbeatChatOutput(params.runId, params.sourceRunId)) {
    return { suppress: false, text: params.text };
  }

  const stripped = stripHeartbeatToken(params.text, {
    mode: "heartbeat",
    maxAckChars: resolveHeartbeatAckMaxChars(),
  });
  if (!stripped.didStrip) {
    return { suppress: false, text: params.text };
  }
  if (stripped.shouldSkip) {
    return { suppress: true, text: "" };
  }
  return { suppress: false, text: stripped.text };
}

function isSilentReplyLeadFragment(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  if (!/^[A-Z_]+$/.test(normalized)) {
    return false;
  }
  if (normalized === SILENT_REPLY_TOKEN) {
    return false;
  }
  return SILENT_REPLY_TOKEN.startsWith(normalized);
}

function appendUniqueSuffix(base: string, suffix: string): string {
  if (!suffix) {
    return base;
  }
  if (!base) {
    return suffix;
  }
  if (base.endsWith(suffix)) {
    return base;
  }
  const maxOverlap = Math.min(base.length, suffix.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (base.slice(-overlap) === suffix.slice(0, overlap)) {
      return base + suffix.slice(overlap);
    }
  }
  return base + suffix;
}

function resolveMergedAssistantText(params: {
  previousText: string;
  nextText: string;
  nextDelta: string;
}) {
  const { previousText, nextText, nextDelta } = params;
  if (nextText && previousText) {
    if (nextText.startsWith(previousText)) {
      return nextText;
    }
    if (previousText.startsWith(nextText) && !nextDelta) {
      return previousText;
    }
  }
  if (nextDelta) {
    return appendUniqueSuffix(previousText, nextDelta);
  }
  if (nextText) {
    return nextText;
  }
  return previousText;
}

export type ChatRunEntry = {
  sessionKey: string;
  clientRunId: string;
};

export type ChatRunRegistry = {
  add: (sessionId: string, entry: ChatRunEntry) => void;
  peek: (sessionId: string) => ChatRunEntry | undefined;
  shift: (sessionId: string) => ChatRunEntry | undefined;
  remove: (sessionId: string, clientRunId: string, sessionKey?: string) => ChatRunEntry | undefined;
  clear: () => void;
};

export function createChatRunRegistry(): ChatRunRegistry {
  const chatRunSessions = new Map<string, ChatRunEntry[]>();

  const add = (sessionId: string, entry: ChatRunEntry) => {
    const queue = chatRunSessions.get(sessionId);
    if (queue) {
      queue.push(entry);
    } else {
      chatRunSessions.set(sessionId, [entry]);
    }
  };

  const peek = (sessionId: string) => chatRunSessions.get(sessionId)?.[0];

  const shift = (sessionId: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const entry = queue.shift();
    if (!queue.length) {
      chatRunSessions.delete(sessionId);
    }
    return entry;
  };

  const remove = (sessionId: string, clientRunId: string, sessionKey?: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const idx = queue.findIndex(
      (entry) =>
        entry.clientRunId === clientRunId && (sessionKey ? entry.sessionKey === sessionKey : true),
    );
    if (idx < 0) {
      return undefined;
    }
    const [entry] = queue.splice(idx, 1);
    if (!queue.length) {
      chatRunSessions.delete(sessionId);
    }
    return entry;
  };

  const clear = () => {
    chatRunSessions.clear();
  };

  return { add, peek, shift, remove, clear };
}

export type ChatRunState = {
  registry: ChatRunRegistry;
  buffers: Map<string, ChatMessageBuffer>;
  deltaSentAt: Map<string, number>;
  /** Signature of the last broadcast assistant payload, used to avoid duplicate flushes. */
  deltaLastBroadcastSignature: Map<string, string>;
  abortedRuns: Map<string, number>;
  clear: () => void;
};

type ChatToolCallBuffer = {
  toolCallId: string;
  name: string;
  phase: string;
  isError: boolean;
  argsText?: string;
  detailText?: string;
};

export type ChatMessageBuffer = {
  text: string;
  reasoningText: string;
  toolCalls: ChatToolCallBuffer[];
};

function createEmptyChatMessageBuffer(): ChatMessageBuffer {
  return {
    text: "",
    reasoningText: "",
    toolCalls: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncateToolPreview(text: string, maxChars = 480): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function formatScalarPreview(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => formatScalarPreview(entry))
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, 3);
    return items.length > 0 ? items.join(", ") : undefined;
  }
  return undefined;
}

function formatToolArgsText(args: unknown): string | undefined {
  if (!isRecord(args)) {
    return undefined;
  }
  const direct =
    readStringField(args, [
      "url",
      "query",
      "q",
      "path",
      "file_path",
      "filePath",
      "command",
      "cmd",
    ]) ?? readStringField(args, ["prompt", "name", "target"]);
  if (direct) {
    return truncateToolPreview(direct, 220);
  }
  const entries = Object.entries(args)
    .map(([key, value]) => {
      const preview = formatScalarPreview(value);
      if (!preview) {
        return null;
      }
      return `${key}: ${preview}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 3);
  if (entries.length === 0) {
    return undefined;
  }
  return truncateToolPreview(entries.join(" · "), 220);
}

function extractToolResultText(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const parts = content
    .map((item) => {
      if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
        return undefined;
      }
      const trimmed = item.text.trim();
      return trimmed ? trimmed : undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("\n");
}

function formatSearchResultPreview(details: Record<string, unknown>): string | undefined {
  const rawResults = Array.isArray(details.results) ? details.results : [];
  const query = readStringField(details, ["query", "q"]);
  const lines = rawResults
    .slice(0, 3)
    .map((entry, index) => {
      if (!isRecord(entry)) {
        return undefined;
      }
      const title = readStringField(entry, ["title", "name"]);
      const url = readStringField(entry, ["url", "link", "href"]);
      const snippet = readStringField(entry, ["snippet", "description", "summary"]);
      const primary = title ?? url ?? `Result ${index + 1}`;
      const detail = url && url !== primary ? `\n${url}` : "";
      const snippetLine = snippet ? `\n${snippet}` : "";
      return `${index + 1}. ${primary}${detail}${snippetLine}`;
    })
    .filter((entry): entry is string => Boolean(entry));
  if (lines.length === 0) {
    return undefined;
  }
  const prefix = query
    ? `Results for ${query}`
    : `${rawResults.length} result${rawResults.length === 1 ? "" : "s"}`;
  return truncateToolPreview([prefix, ...lines].join("\n"));
}

function formatWebFetchPreview(details: Record<string, unknown>): string | undefined {
  const title = readStringField(details, ["title"]);
  const url = readStringField(details, ["finalUrl", "final_url", "url"]);
  const extractor = readStringField(details, ["extractor"]);
  const warning = readStringField(details, ["warning"]);
  const statusValue = details.status;
  const status =
    typeof statusValue === "number" && Number.isFinite(statusValue)
      ? `HTTP ${statusValue}`
      : typeof statusValue === "string" && statusValue.trim()
        ? statusValue.trim()
        : undefined;
  const lines = [
    title,
    url,
    status,
    extractor ? `Extractor: ${extractor}` : undefined,
    warning,
  ].filter((entry): entry is string => Boolean(entry));
  if (lines.length === 0) {
    return undefined;
  }
  return truncateToolPreview(lines.join("\n"));
}

function formatToolResultDetailText(toolName: string, result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  const details = isRecord(result.details) ? result.details : undefined;
  if (details) {
    if (toolName === "web_fetch") {
      const preview = formatWebFetchPreview(details);
      if (preview) {
        return preview;
      }
    }
    const searchPreview = formatSearchResultPreview(details);
    if (searchPreview) {
      return searchPreview;
    }
    const genericLines = [
      readStringField(details, ["title", "name"]),
      readStringField(details, ["finalUrl", "final_url", "url", "path"]),
      readStringField(details, ["message", "summary"]),
    ].filter((entry): entry is string => Boolean(entry));
    if (genericLines.length > 0) {
      return truncateToolPreview(genericLines.join("\n"));
    }
  }
  const text = extractToolResultText(result);
  if (!text) {
    return undefined;
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (lines.length === 0) {
    return undefined;
  }
  return truncateToolPreview(lines.join("\n"));
}

function getOrCreateChatMessageBuffer(
  buffers: Map<string, ChatMessageBuffer>,
  clientRunId: string,
): ChatMessageBuffer {
  const existing = buffers.get(clientRunId);
  if (existing) {
    return existing;
  }
  const created = createEmptyChatMessageBuffer();
  buffers.set(clientRunId, created);
  return created;
}

function buildChatMessageContent(params: {
  buffer: ChatMessageBuffer;
  visibleText: string;
}): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  const reasoningText = params.buffer.reasoningText.trim();
  if (reasoningText) {
    content.push({ type: "thinking", thinking: reasoningText });
  }
  for (const toolCall of params.buffer.toolCalls) {
    content.push({
      type: "toolCall",
      id: toolCall.toolCallId,
      name: toolCall.name,
      phase: toolCall.phase,
      ...(toolCall.argsText ? { argsText: toolCall.argsText } : {}),
      ...(toolCall.detailText ? { detailText: toolCall.detailText } : {}),
      ...(toolCall.isError ? { isError: true } : {}),
    });
  }
  if (params.visibleText) {
    content.push({ type: "text", text: params.visibleText });
  }
  return content;
}

function buildChatMessageSignature(content: Array<Record<string, unknown>>): string {
  return JSON.stringify(content);
}

function applyToolEventToBuffer(
  buffer: ChatMessageBuffer,
  data: Record<string, unknown>,
  limit = 24,
): boolean {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const toolCallIdRaw = typeof data.toolCallId === "string" ? data.toolCallId.trim() : "";
  const toolCallId = toolCallIdRaw || name;
  if (!toolCallId || !name) {
    return false;
  }
  const phase = typeof data.phase === "string" ? data.phase : "start";
  const isError = data.isError === true;
  const existingIndex = buffer.toolCalls.findIndex((entry) => entry.toolCallId === toolCallId);
  const existing = existingIndex >= 0 ? buffer.toolCalls[existingIndex] : undefined;
  const nextEntry: ChatToolCallBuffer = {
    toolCallId,
    name,
    phase,
    isError,
    argsText: formatToolArgsText(data.args) ?? existing?.argsText,
    detailText:
      formatToolResultDetailText(
        name,
        phase === "update" ? data.partialResult : phase === "result" ? data.result : undefined,
      ) ?? existing?.detailText,
  };
  if (existingIndex < 0) {
    buffer.toolCalls = [...buffer.toolCalls, nextEntry].slice(-limit);
    return true;
  }
  const existingEntry = buffer.toolCalls[existingIndex];
  if (
    existingEntry.name === nextEntry.name &&
    existingEntry.phase === nextEntry.phase &&
    existingEntry.isError === nextEntry.isError &&
    existingEntry.argsText === nextEntry.argsText &&
    existingEntry.detailText === nextEntry.detailText
  ) {
    return false;
  }
  const nextToolCalls = [...buffer.toolCalls];
  nextToolCalls[existingIndex] = nextEntry;
  buffer.toolCalls = nextToolCalls;
  return true;
}

export function createChatRunState(): ChatRunState {
  const registry = createChatRunRegistry();
  const buffers = new Map<string, ChatMessageBuffer>();
  const deltaSentAt = new Map<string, number>();
  const deltaLastBroadcastSignature = new Map<string, string>();
  const abortedRuns = new Map<string, number>();

  const clear = () => {
    registry.clear();
    buffers.clear();
    deltaSentAt.clear();
    deltaLastBroadcastSignature.clear();
    abortedRuns.clear();
  };

  return {
    registry,
    buffers,
    deltaSentAt,
    deltaLastBroadcastSignature,
    abortedRuns,
    clear,
  };
}

export type ToolEventRecipientRegistry = {
  add: (runId: string, connId: string) => void;
  get: (runId: string) => ReadonlySet<string> | undefined;
  markFinal: (runId: string) => void;
};

export type SessionEventSubscriberRegistry = {
  subscribe: (connId: string) => void;
  unsubscribe: (connId: string) => void;
  getAll: () => ReadonlySet<string>;
  clear: () => void;
};

export type SessionMessageSubscriberRegistry = {
  subscribe: (connId: string, sessionKey: string) => void;
  unsubscribe: (connId: string, sessionKey: string) => void;
  unsubscribeAll: (connId: string) => void;
  get: (sessionKey: string) => ReadonlySet<string>;
  clear: () => void;
};

type ToolRecipientEntry = {
  connIds: Set<string>;
  updatedAt: number;
  finalizedAt?: number;
};

const TOOL_EVENT_RECIPIENT_TTL_MS = 10 * 60 * 1000;
const TOOL_EVENT_RECIPIENT_FINAL_GRACE_MS = 30 * 1000;

export function createSessionEventSubscriberRegistry(): SessionEventSubscriberRegistry {
  const connIds = new Set<string>();
  const empty = new Set<string>();

  return {
    subscribe: (connId: string) => {
      const normalized = connId.trim();
      if (!normalized) {
        return;
      }
      connIds.add(normalized);
    },
    unsubscribe: (connId: string) => {
      const normalized = connId.trim();
      if (!normalized) {
        return;
      }
      connIds.delete(normalized);
    },
    getAll: () => (connIds.size > 0 ? connIds : empty),
    clear: () => {
      connIds.clear();
    },
  };
}

export function createSessionMessageSubscriberRegistry(): SessionMessageSubscriberRegistry {
  const sessionToConnIds = new Map<string, Set<string>>();
  const connToSessionKeys = new Map<string, Set<string>>();
  const empty = new Set<string>();

  const normalize = (value: string): string => value.trim();

  return {
    subscribe: (connId: string, sessionKey: string) => {
      const normalizedConnId = normalize(connId);
      const normalizedSessionKey = normalize(sessionKey);
      if (!normalizedConnId || !normalizedSessionKey) {
        return;
      }
      const connIds = sessionToConnIds.get(normalizedSessionKey) ?? new Set<string>();
      connIds.add(normalizedConnId);
      sessionToConnIds.set(normalizedSessionKey, connIds);

      const sessionKeys = connToSessionKeys.get(normalizedConnId) ?? new Set<string>();
      sessionKeys.add(normalizedSessionKey);
      connToSessionKeys.set(normalizedConnId, sessionKeys);
    },
    unsubscribe: (connId: string, sessionKey: string) => {
      const normalizedConnId = normalize(connId);
      const normalizedSessionKey = normalize(sessionKey);
      if (!normalizedConnId || !normalizedSessionKey) {
        return;
      }
      const connIds = sessionToConnIds.get(normalizedSessionKey);
      if (connIds) {
        connIds.delete(normalizedConnId);
        if (connIds.size === 0) {
          sessionToConnIds.delete(normalizedSessionKey);
        }
      }
      const sessionKeys = connToSessionKeys.get(normalizedConnId);
      if (sessionKeys) {
        sessionKeys.delete(normalizedSessionKey);
        if (sessionKeys.size === 0) {
          connToSessionKeys.delete(normalizedConnId);
        }
      }
    },
    unsubscribeAll: (connId: string) => {
      const normalizedConnId = normalize(connId);
      if (!normalizedConnId) {
        return;
      }
      const sessionKeys = connToSessionKeys.get(normalizedConnId);
      if (!sessionKeys) {
        return;
      }
      for (const sessionKey of sessionKeys) {
        const connIds = sessionToConnIds.get(sessionKey);
        if (!connIds) {
          continue;
        }
        connIds.delete(normalizedConnId);
        if (connIds.size === 0) {
          sessionToConnIds.delete(sessionKey);
        }
      }
      connToSessionKeys.delete(normalizedConnId);
    },
    get: (sessionKey: string) => {
      const normalizedSessionKey = normalize(sessionKey);
      if (!normalizedSessionKey) {
        return empty;
      }
      return sessionToConnIds.get(normalizedSessionKey) ?? empty;
    },
    clear: () => {
      sessionToConnIds.clear();
      connToSessionKeys.clear();
    },
  };
}

export function createToolEventRecipientRegistry(): ToolEventRecipientRegistry {
  const recipients = new Map<string, ToolRecipientEntry>();

  const prune = () => {
    if (recipients.size === 0) {
      return;
    }
    const now = Date.now();
    for (const [runId, entry] of recipients) {
      const cutoff = entry.finalizedAt
        ? entry.finalizedAt + TOOL_EVENT_RECIPIENT_FINAL_GRACE_MS
        : entry.updatedAt + TOOL_EVENT_RECIPIENT_TTL_MS;
      if (now >= cutoff) {
        recipients.delete(runId);
      }
    }
  };

  const add = (runId: string, connId: string) => {
    if (!runId || !connId) {
      return;
    }
    const now = Date.now();
    const existing = recipients.get(runId);
    if (existing) {
      existing.connIds.add(connId);
      existing.updatedAt = now;
    } else {
      recipients.set(runId, {
        connIds: new Set([connId]),
        updatedAt: now,
      });
    }
    prune();
  };

  const get = (runId: string) => {
    const entry = recipients.get(runId);
    if (!entry) {
      return undefined;
    }
    entry.updatedAt = Date.now();
    prune();
    return entry.connIds;
  };

  const markFinal = (runId: string) => {
    const entry = recipients.get(runId);
    if (!entry) {
      return;
    }
    entry.finalizedAt = Date.now();
    prune();
  };

  return { add, get, markFinal };
}

export type ChatEventBroadcast = (
  event: string,
  payload: unknown,
  opts?: { dropIfSlow?: boolean },
) => void;

export type NodeSendToSession = (sessionKey: string, event: string, payload: unknown) => void;

export type AgentEventHandlerOptions = {
  broadcast: ChatEventBroadcast;
  broadcastToConnIds: (
    event: string,
    payload: unknown,
    connIds: ReadonlySet<string>,
    opts?: { dropIfSlow?: boolean },
  ) => void;
  nodeSendToSession: NodeSendToSession;
  agentRunSeq: Map<string, number>;
  chatRunState: ChatRunState;
  resolveSessionKeyForRun: (runId: string) => string | undefined;
  clearAgentRunContext: (runId: string) => void;
  toolEventRecipients: ToolEventRecipientRegistry;
  sessionEventSubscribers: SessionEventSubscriberRegistry;
};

export function createAgentEventHandler({
  broadcast,
  broadcastToConnIds,
  nodeSendToSession,
  agentRunSeq,
  chatRunState,
  resolveSessionKeyForRun,
  clearAgentRunContext,
  toolEventRecipients,
  sessionEventSubscribers,
}: AgentEventHandlerOptions) {
  const buildSessionEventSnapshot = (sessionKey: string, evt?: AgentEventPayload) => {
    const row = loadGatewaySessionRow(sessionKey);
    const lifecyclePatch = evt
      ? deriveGatewaySessionLifecycleSnapshot({
          session: row
            ? {
                updatedAt: row.updatedAt ?? undefined,
                status: row.status,
                startedAt: row.startedAt,
                endedAt: row.endedAt,
                runtimeMs: row.runtimeMs,
                abortedLastRun: row.abortedLastRun,
              }
            : undefined,
          event: evt,
        })
      : {};
    const session = row ? { ...row, ...lifecyclePatch } : undefined;
    const snapshotSource = session ?? lifecyclePatch;
    return {
      ...(session ? { session } : {}),
      totalTokens: row?.totalTokens,
      totalTokensFresh: row?.totalTokensFresh,
      contextTokens: row?.contextTokens,
      estimatedCostUsd: row?.estimatedCostUsd,
      modelProvider: row?.modelProvider,
      model: row?.model,
      status: snapshotSource.status,
      startedAt: snapshotSource.startedAt,
      endedAt: snapshotSource.endedAt,
      runtimeMs: snapshotSource.runtimeMs,
      updatedAt: snapshotSource.updatedAt,
      abortedLastRun: snapshotSource.abortedLastRun,
    };
  };

  const emitChatDelta = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    text: string,
    delta?: unknown,
    opts?: { force?: boolean },
  ) => {
    const cleanedText = stripInlineDirectiveTagsForDisplay(text).text;
    const cleanedDelta =
      typeof delta === "string" ? stripInlineDirectiveTagsForDisplay(delta).text : "";
    const buffer = getOrCreateChatMessageBuffer(chatRunState.buffers, clientRunId);
    const previousText = buffer.text;
    const mergedText = resolveMergedAssistantText({
      previousText,
      nextText: cleanedText,
      nextDelta: cleanedDelta,
    });
    buffer.text = mergedText;
    if (isSilentReplyText(mergedText, SILENT_REPLY_TOKEN)) {
      return;
    }
    if (isSilentReplyLeadFragment(mergedText)) {
      return;
    }
    if (shouldHideHeartbeatChatOutput(clientRunId, sourceRunId)) {
      return;
    }
    const now = Date.now();
    const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
    if (!opts?.force && now - last < 150) {
      return;
    }
    const content = buildChatMessageContent({
      buffer,
      visibleText: mergedText.trim(),
    });
    if (content.length === 0) {
      return;
    }
    const signature = buildChatMessageSignature(content);
    if (!opts?.force && chatRunState.deltaLastBroadcastSignature.get(clientRunId) === signature) {
      return;
    }
    chatRunState.deltaSentAt.set(clientRunId, now);
    chatRunState.deltaLastBroadcastSignature.set(clientRunId, signature);
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content,
        timestamp: now,
      },
    };
    broadcast("chat", payload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const resolveBufferedChatTextState = (clientRunId: string, sourceRunId: string) => {
    const buffer = chatRunState.buffers.get(clientRunId) ?? createEmptyChatMessageBuffer();
    const bufferedText = stripInlineDirectiveTagsForDisplay(buffer.text).text.trim();
    const normalizedHeartbeatText = normalizeHeartbeatChatFinalText({
      runId: clientRunId,
      sourceRunId,
      text: bufferedText,
    });
    const text = normalizedHeartbeatText.text.trim();
    const shouldSuppressSilent =
      normalizedHeartbeatText.suppress || isSilentReplyText(text, SILENT_REPLY_TOKEN);
    return { text, shouldSuppressSilent };
  };

  const flushBufferedChatDeltaIfNeeded = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
  ) => {
    const buffer = chatRunState.buffers.get(clientRunId) ?? createEmptyChatMessageBuffer();
    const { text, shouldSuppressSilent } = resolveBufferedChatTextState(clientRunId, sourceRunId);
    const shouldSuppressSilentLeadFragment = isSilentReplyLeadFragment(text);
    const shouldSuppressHeartbeatStreaming = shouldHideHeartbeatChatOutput(
      clientRunId,
      sourceRunId,
    );
    const content = buildChatMessageContent({
      buffer,
      visibleText: text,
    });
    if (
      content.length === 0 ||
      shouldSuppressSilent ||
      shouldSuppressSilentLeadFragment ||
      shouldSuppressHeartbeatStreaming
    ) {
      return;
    }

    const signature = buildChatMessageSignature(content);
    if (chatRunState.deltaLastBroadcastSignature.get(clientRunId) === signature) {
      return;
    }

    const now = Date.now();
    const flushPayload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content,
        timestamp: now,
      },
    };
    broadcast("chat", flushPayload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", flushPayload);
    chatRunState.deltaLastBroadcastSignature.set(clientRunId, signature);
    chatRunState.deltaSentAt.set(clientRunId, now);
  };

  const emitChatFinal = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    jobState: "done" | "error",
    error?: unknown,
    stopReason?: string,
  ) => {
    const buffer = chatRunState.buffers.get(clientRunId) ?? createEmptyChatMessageBuffer();
    const { text, shouldSuppressSilent } = resolveBufferedChatTextState(clientRunId, sourceRunId);
    // Flush any throttled delta so streaming clients receive the complete text
    // before the final event. The 150 ms throttle in emitChatDelta may have
    // suppressed the most recent chunk, leaving the client with stale text.
    // Only flush if the buffer has grown since the last broadcast to avoid duplicates.
    flushBufferedChatDeltaIfNeeded(sessionKey, clientRunId, sourceRunId, seq);
    chatRunState.deltaLastBroadcastSignature.delete(clientRunId);
    chatRunState.buffers.delete(clientRunId);
    chatRunState.deltaSentAt.delete(clientRunId);
    if (jobState === "done") {
      const content = buildChatMessageContent({
        buffer,
        visibleText: text,
      });
      const payload = {
        runId: clientRunId,
        sessionKey,
        seq,
        state: "final" as const,
        ...(stopReason && { stopReason }),
        message:
          content.length > 0 && !shouldSuppressSilent
            ? {
                role: "assistant",
                content,
                timestamp: Date.now(),
              }
            : undefined,
      };
      broadcast("chat", payload);
      nodeSendToSession(sessionKey, "chat", payload);
      return;
    }
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "error" as const,
      errorMessage: error ? formatForLog(error) : undefined,
    };
    broadcast("chat", payload);
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const resolveToolVerboseLevel = (runId: string, sessionKey?: string) => {
    const runContext = getAgentRunContext(runId);
    const runVerbose = normalizeVerboseLevel(runContext?.verboseLevel);
    if (runVerbose) {
      return runVerbose;
    }
    if (!sessionKey) {
      return "off";
    }
    try {
      const { cfg, entry } = loadSessionEntry(sessionKey);
      const sessionVerbose = normalizeVerboseLevel(entry?.verboseLevel);
      if (sessionVerbose) {
        return sessionVerbose;
      }
      const defaultVerbose = normalizeVerboseLevel(cfg.agents?.defaults?.verboseDefault);
      return defaultVerbose ?? "off";
    } catch {
      return "off";
    }
  };

  return (evt: AgentEventPayload) => {
    const chatLink = chatRunState.registry.peek(evt.runId);
    const eventSessionKey =
      typeof evt.sessionKey === "string" && evt.sessionKey.trim() ? evt.sessionKey : undefined;
    const isControlUiVisible = getAgentRunContext(evt.runId)?.isControlUiVisible ?? true;
    const sessionKey =
      chatLink?.sessionKey ?? eventSessionKey ?? resolveSessionKeyForRun(evt.runId);
    const clientRunId = chatLink?.clientRunId ?? evt.runId;
    const eventRunId = chatLink?.clientRunId ?? evt.runId;
    const eventForClients = chatLink ? { ...evt, runId: eventRunId } : evt;
    const isAborted =
      chatRunState.abortedRuns.has(clientRunId) || chatRunState.abortedRuns.has(evt.runId);
    // Include sessionKey so Control UI can filter tool streams per session.
    const agentPayload = sessionKey ? { ...eventForClients, sessionKey } : eventForClients;
    const last = agentRunSeq.get(evt.runId) ?? 0;
    const isToolEvent = evt.stream === "tool";
    const toolVerbose = isToolEvent ? resolveToolVerboseLevel(evt.runId, sessionKey) : "off";
    // Build tool payload: strip result/partialResult unless verbose=full
    const toolPayload =
      isToolEvent && toolVerbose !== "full"
        ? (() => {
            const data = evt.data ? { ...evt.data } : {};
            delete data.result;
            delete data.partialResult;
            return sessionKey
              ? { ...eventForClients, sessionKey, data }
              : { ...eventForClients, data };
          })()
        : agentPayload;
    if (last > 0 && evt.seq !== last + 1) {
      broadcast("agent", {
        runId: eventRunId,
        stream: "error",
        ts: Date.now(),
        sessionKey,
        data: {
          reason: "seq gap",
          expected: last + 1,
          received: evt.seq,
        },
      });
    }
    agentRunSeq.set(evt.runId, evt.seq);
    if (isToolEvent) {
      const toolPhase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
      // Flush pending assistant text before tool-start events so clients can
      // render complete pre-tool text above tool cards (not truncated by delta throttle).
      if (toolPhase === "start" && isControlUiVisible && sessionKey && !isAborted) {
        flushBufferedChatDeltaIfNeeded(sessionKey, clientRunId, evt.runId, evt.seq);
      }
      // Always broadcast tool events to registered WS recipients with
      // tool-events capability, regardless of verboseLevel. The verbose
      // setting only controls whether tool details are sent as channel
      // messages to messaging surfaces (Telegram, Discord, etc.).
      const recipients = toolEventRecipients.get(evt.runId);
      if (recipients && recipients.size > 0) {
        broadcastToConnIds("agent", toolPayload, recipients);
      }
      // Session subscribers power operator UIs that attach to an existing
      // in-flight session after the run has already started. Those clients do
      // not know the runId in advance, so they cannot register as run-scoped
      // tool recipients. Mirror tool lifecycle onto a session-scoped event so
      // they can render live pending tool cards without polling history.
      if (sessionKey) {
        const sessionSubscribers = sessionEventSubscribers.getAll();
        if (sessionSubscribers.size > 0) {
          broadcastToConnIds("session.tool", toolPayload, sessionSubscribers, { dropIfSlow: true });
        }
      }
    } else {
      broadcast("agent", agentPayload);
    }

    const lifecyclePhase =
      evt.stream === "lifecycle" && typeof evt.data?.phase === "string" ? evt.data.phase : null;

    if (isControlUiVisible && sessionKey) {
      // Send tool events to node/channel subscribers only when verbose is enabled;
      // WS clients already received the event above via broadcastToConnIds.
      if (!isToolEvent || toolVerbose !== "off") {
        nodeSendToSession(sessionKey, "agent", isToolEvent ? toolPayload : agentPayload);
      }
      if (!isAborted && evt.stream === "assistant" && typeof evt.data?.text === "string") {
        emitChatDelta(sessionKey, clientRunId, evt.runId, evt.seq, evt.data.text, evt.data.delta);
      } else if (
        !isAborted &&
        (evt.stream === "thinking" || evt.stream === "reasoning") &&
        typeof evt.data?.text === "string"
      ) {
        const buffer = getOrCreateChatMessageBuffer(chatRunState.buffers, clientRunId);
        const nextReasoning = evt.data.text.trim();
        if (nextReasoning !== buffer.reasoningText) {
          buffer.reasoningText = nextReasoning;
          emitChatDelta(sessionKey, clientRunId, evt.runId, evt.seq, buffer.text, undefined, {
            force: true,
          });
        }
      } else if (!isAborted && isToolEvent) {
        const buffer = getOrCreateChatMessageBuffer(chatRunState.buffers, clientRunId);
        if (applyToolEventToBuffer(buffer, evt.data)) {
          emitChatDelta(sessionKey, clientRunId, evt.runId, evt.seq, buffer.text, undefined, {
            force: true,
          });
        }
      } else if (!isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        const evtStopReason =
          typeof evt.data?.stopReason === "string" ? evt.data.stopReason : undefined;
        if (chatLink) {
          const finished = chatRunState.registry.shift(evt.runId);
          if (!finished) {
            clearAgentRunContext(evt.runId);
            return;
          }
          emitChatFinal(
            finished.sessionKey,
            finished.clientRunId,
            evt.runId,
            evt.seq,
            lifecyclePhase === "error" ? "error" : "done",
            evt.data?.error,
            evtStopReason,
          );
        } else {
          emitChatFinal(
            sessionKey,
            eventRunId,
            evt.runId,
            evt.seq,
            lifecyclePhase === "error" ? "error" : "done",
            evt.data?.error,
            evtStopReason,
          );
        }
      } else if (isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        chatRunState.abortedRuns.delete(clientRunId);
        chatRunState.abortedRuns.delete(evt.runId);
        chatRunState.buffers.delete(clientRunId);
        chatRunState.deltaSentAt.delete(clientRunId);
        chatRunState.deltaLastBroadcastSignature.delete(clientRunId);
        if (chatLink) {
          chatRunState.registry.remove(evt.runId, clientRunId, sessionKey);
        }
      }
    }

    if (lifecyclePhase === "end" || lifecyclePhase === "error") {
      toolEventRecipients.markFinal(evt.runId);
      clearAgentRunContext(evt.runId);
      agentRunSeq.delete(evt.runId);
      agentRunSeq.delete(clientRunId);
    }

    if (
      sessionKey &&
      (lifecyclePhase === "start" || lifecyclePhase === "end" || lifecyclePhase === "error")
    ) {
      void persistGatewaySessionLifecycleEvent({ sessionKey, event: evt }).catch(() => undefined);
      const sessionEventConnIds = sessionEventSubscribers.getAll();
      if (sessionEventConnIds.size > 0) {
        broadcastToConnIds(
          "sessions.changed",
          {
            sessionKey,
            phase: lifecyclePhase,
            runId: evt.runId,
            ts: evt.ts,
            ...buildSessionEventSnapshot(sessionKey, evt),
          },
          sessionEventConnIds,
          { dropIfSlow: true },
        );
      }
    }
  };
}
