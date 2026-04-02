import { afterEach, describe, expect, it } from "vitest";
import { enqueueFollowupRun } from "../queue.js";
import { clearFollowupQueue, getExistingFollowupQueue } from "./state.js";
import type { FollowupRun, QueueSettings } from "./types.js";

const QUEUE_KEY = "agent:main:queue:enqueue-materialize";

afterEach(() => {
  clearFollowupQueue(QUEUE_KEY);
});

function createRun(run?: Partial<FollowupRun["run"]>): FollowupRun {
  return {
    prompt: "queued prompt",
    enqueuedAt: Date.now(),
    run: {
      agentId: "agent",
      agentDir: "/tmp/agent",
      sessionId: "session-1",
      sessionKey: QUEUE_KEY,
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp/workspace",
      config: {} as FollowupRun["run"]["config"],
      provider: "openai",
      model: "gpt-5.4",
      timeoutMs: 30_000,
      blockReplyBreak: "message_end",
      ...run,
    },
  };
}

const SETTINGS: QueueSettings = {
  mode: "followup",
  debounceMs: 0,
  cap: 10,
  dropPolicy: "summarize",
};

describe("enqueueFollowupRun queued model materialization", () => {
  it("uses queued selection for unpinned deferred runs", () => {
    enqueueFollowupRun(
      QUEUE_KEY,
      createRun({
        queuedProvider: "anthropic",
        queuedModel: "claude-opus-4-6",
      }),
      SETTINGS,
      "message-id",
      undefined,
      false,
    );

    const queue = getExistingFollowupQueue(QUEUE_KEY);
    expect(queue?.lastRun).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    expect(queue?.items[0]?.run).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
  });

  it("keeps pinned deferred runs on their pinned model", () => {
    enqueueFollowupRun(
      QUEUE_KEY,
      createRun({
        pinnedModel: true,
        queuedProvider: "openai",
        queuedModel: "gpt-5.4",
      }),
      SETTINGS,
      "message-id",
      undefined,
      false,
    );

    const queue = getExistingFollowupQueue(QUEUE_KEY);
    expect(queue?.lastRun).toMatchObject({
      provider: "openai",
      model: "gpt-5.4",
      pinnedModel: true,
    });
    expect(queue?.items[0]?.run).toMatchObject({
      provider: "openai",
      model: "gpt-5.4",
      pinnedModel: true,
    });
  });
});
