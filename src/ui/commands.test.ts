import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Message } from "./types.js";

const athenaHome = mkdtempSync(join(tmpdir(), "athena-commands-"));
process.env.ATHENA_HOME = athenaHome;

interface RecordedContext {
  messages: Array<{ role: Message["role"]; content: string }>;
  restoredMessages: Message[];
}

function createBaseContext(overrides: Record<string, unknown> = {}) {
  const recorded: RecordedContext = {
    messages: [],
    restoredMessages: [],
  };

  const context = {
    orchestrator: {
      switchProvider: async () => undefined,
      setModel: async () => undefined,
      fetchModels: async () => [],
      setReasoningEffort: async () => undefined,
      getProvider: () => null,
      currentModel: "gpt-5.4",
      currentProvider: null,
      reasoningEffort: "medium",
      currentState: "idle",
      totalCostUsd: 0,
      sessionStore: {
        listSessionSummaries: () => [],
        getMessages: () => [],
      },
      resumeSession: async () => undefined,
      registerTools: () => undefined,
    },
    addMessage: (role: Message["role"], content: string) => {
      recorded.messages.push({ role, content });
      return recorded.messages.length;
    },
    updateMessage: (id: number, updates: Partial<Message>) => {
      const target = recorded.messages[id - 1];
      if (target && updates.content) {
        target.content = updates.content;
      }
    },
    setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => {
      recorded.restoredMessages = typeof messages === "function"
        ? messages(recorded.restoredMessages)
        : messages;
    },
    messages: [] as Message[],
    setIsStreaming: (_value: boolean) => undefined,
    connectionPool: {
      addMachine: () => undefined,
      removeMachine: () => undefined,
      connect: async () => undefined,
      getStatus: () => undefined,
    },
    metricStore: undefined,
    metricCollector: undefined,
    memoryStore: undefined,
    stickyManager: undefined,
    setStickyNotes: undefined,
    executor: undefined,
    restoreMessages: (messages: Array<{ role: string; content: string }>) => {
      recorded.restoredMessages = messages.map((message, index) => ({
        id: index + 1,
        role: message.role as Message["role"],
        content: message.content,
      }));
      return recorded.restoredMessages;
    },
    ...overrides,
  };

  return { context, recorded };
}

test("handleSlashCommand resumes a listed session by index", async () => {
  const { handleSlashCommand } = await import("./commands.js");
  const { context, recorded } = createBaseContext({
    orchestrator: {
      switchProvider: async () => undefined,
      setModel: async () => undefined,
      fetchModels: async () => [],
      setReasoningEffort: async () => undefined,
      getProvider: () => null,
      currentModel: "gpt-5.4",
      currentProvider: null,
      reasoningEffort: "medium",
      currentState: "idle",
      totalCostUsd: 0,
      sessionStore: {
        listSessionSummaries: () => [{
          id: "session-1",
          provider: "openai",
          firstUserMessage: "resume me",
          messageCount: 2,
          lastActiveAt: 1,
        }],
        getMessages: () => [
          { role: "user", content: "resume me" },
          { role: "assistant", content: "working" },
        ],
      },
      resumeSession: async () => undefined,
      registerTools: () => undefined,
    },
  });

  await handleSlashCommand("/resume", context as any);
  await handleSlashCommand("/resume 1", context as any);

  assert.match(recorded.messages[0]?.content ?? "", /Recent sessions:/);
  assert.equal(recorded.restoredMessages.length, 2);
  assert.match(recorded.messages.at(-1)?.content ?? "", /Session resumed/);
});

test("handleSlashCommand adds a machine configuration", async () => {
  const { handleSlashCommand } = await import("./commands.js");
  let connectedId: string | null = null;
  const { context, recorded } = createBaseContext({
    connectionPool: {
      addMachine: () => undefined,
      removeMachine: () => undefined,
      connect: async (id: string) => {
        connectedId = id;
      },
      getStatus: () => undefined,
    },
  });

  await handleSlashCommand("/machine add gpu user@example.com:2222 --auth agent", context as any);

  assert.equal(connectedId, "gpu");
  assert.match(recorded.messages[0]?.content ?? "", /Added machine "gpu"/);
});

test("handleSlashCommand reports missing hub configuration", async () => {
  const { handleSlashCommand } = await import("./commands.js");
  const { context, recorded } = createBaseContext();

  await handleSlashCommand("/hub status", context as any);

  assert.match(recorded.messages[0]?.content ?? "", /AgentHub not configured/);
});

test("handleSlashCommand streams a writeup through the provider", async () => {
  const { handleSlashCommand } = await import("./commands.js");
  let closed = false;
  const provider = {
    createSession: async () => ({ id: "writeup-session", providerId: "openai", createdAt: 0, lastActiveAt: 0 }),
    send: async function* () {
      yield { type: "text", text: "draft", delta: "draft" };
      yield { type: "text", text: " complete", delta: " complete" };
    },
    closeSession: async () => {
      closed = true;
    },
  };

  const { context, recorded } = createBaseContext({
    messages: [{ id: 1, role: "user", content: "hello" }],
    orchestrator: {
      switchProvider: async () => undefined,
      setModel: async () => undefined,
      fetchModels: async () => [],
      setReasoningEffort: async () => undefined,
      getProvider: () => null,
      currentModel: "gpt-5.4",
      currentProvider: provider,
      reasoningEffort: "medium",
      currentState: "idle",
      totalCostUsd: 0,
      sessionStore: {
        listSessionSummaries: () => [],
        getMessages: () => [],
      },
      resumeSession: async () => undefined,
      registerTools: () => undefined,
    },
  });

  await handleSlashCommand("/writeup", context as any);

  assert.match(recorded.messages[0]?.content ?? "", /Generating writeup/);
  assert.equal(recorded.messages.at(-1)?.content, "draft complete");
  assert.equal(closed, true);
});

test.after(() => {
  rmSync(athenaHome, { recursive: true, force: true });
  delete process.env.ATHENA_HOME;
});
