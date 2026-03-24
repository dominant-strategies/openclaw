import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLcmConfig } from "./db/config.js";
import { closeLcmConnection, createLcmDatabaseConnection } from "./db/connection.js";
import { LcmContextEngine } from "./engine.js";
import type { LcmDependencies } from "./types.js";

const tempDirs = new Set<string>();

afterEach(async () => {
  closeLcmConnection();
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

function createDeps(dbPath: string): LcmDependencies {
  return {
    config: resolveLcmConfig({} as NodeJS.ProcessEnv, { databasePath: dbPath }),
    complete: async () => ({ content: [] }),
    callGateway: async () => ({}),
    resolveModel: () => ({ provider: "openai", model: "gpt-4.1-mini" }),
    getApiKey: async () => undefined,
    requireApiKey: async () => "test-key",
    parseAgentSessionKey: () => null,
    isSubagentSessionKey: () => false,
    normalizeAgentId: (id) => id?.trim() || "main",
    buildSubagentSystemPrompt: () => "",
    readLatestAssistantReply: () => undefined,
    resolveAgentDir: () => "",
    resolveSessionIdFromSessionKey: async () => undefined,
    agentLaneSubagent: "subagent",
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };
}

describe("LcmContextEngine bootstrap", () => {
  it("imports first-run session history in batches instead of one giant bulk array", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lossless-claw-bootstrap-"));
    tempDirs.add(dir);

    const sessionFile = join(dir, "session.jsonl");
    const dbPath = join(dir, "lcm.db");
    const transcript = Array.from({ length: 300 }, (_, index) =>
      JSON.stringify({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message ${index}`,
      }),
    ).join("\n");
    await writeFile(sessionFile, transcript, "utf8");

    const db = createLcmDatabaseConnection(dbPath);
    const engine = new LcmContextEngine(createDeps(dbPath), db);
    const conversationStore = engine.getConversationStore();
    const originalCreateMessagesBulk = conversationStore.createMessagesBulk.bind(conversationStore);
    const createMessagesBulkSpy = vi.fn(originalCreateMessagesBulk);
    conversationStore.createMessagesBulk = createMessagesBulkSpy;

    const result = await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey: "agent:main:thread:test",
      sessionFile,
    });

    expect(result.bootstrapped).toBe(true);
    expect(result.importedMessages).toBe(300);
    expect(createMessagesBulkSpy).toHaveBeenCalledTimes(3);

    const conversation = await conversationStore.getConversationForSession({
      sessionId: "sess-1",
      sessionKey: "agent:main:thread:test",
    });
    expect(conversation).not.toBeNull();
    expect(await conversationStore.getMessageCount(conversation!.conversationId)).toBe(300);
  });
});
