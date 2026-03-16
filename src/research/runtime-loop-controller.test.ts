import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AgentEvent,
  Attachment,
  ModelInfo,
  ModelProvider,
  ReasoningEffort,
  Session,
  SessionConfig,
  ToolDefinition,
} from "../providers/types.js";
import { SessionStore } from "../store/session-store.js";
import { TeamStore } from "./team-store.js";
import { MemoryStore } from "../memory/memory-store.js";
import { GraphMemory } from "../memory/graph-memory.js";
import { TeamOrchestrator } from "./team-orchestrator.js";
import { ResearchSessionBootstrapper } from "./session-bootstrap.js";
import { Orchestrator } from "../core/orchestrator.js";
import { ResearchLoopController } from "./runtime-loop-controller.js";
import { closeDb } from "../store/database.js";

class FakeProvider implements ModelProvider {
  readonly name = "openai" as const;
  readonly displayName = "Fake OpenAI";
  readonly capabilities = {
    attachmentSupport: "full",
    builtinWebSearch: false,
    authModes: ["oauth"],
    sessionPersistence: "local",
  } as const;
  currentModel = "gpt-5.4";
  reasoningEffort: ReasoningEffort = "medium";

  constructor(private sessionStore: SessionStore) {}

  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  async authenticate(): Promise<void> {}

  async createSession(_config: SessionConfig): Promise<Session> {
    return this.sessionStore.createSession(this.name, this.currentModel);
  }

  async resumeSession(id: string): Promise<Session> {
    const session = this.sessionStore.getSession(id);
    if (!session) {
      throw new Error(`missing session ${id}`);
    }
    return session;
  }

  async *send(
    _session: Session,
    message: string,
    _tools: ToolDefinition[],
    _attachments?: Attachment[],
  ): AsyncGenerator<AgentEvent> {
    yield { type: "text", text: `ack:${message}`, delta: `ack:${message}` };
    yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 } };
  }

  interrupt(_session: Session): void {}

  resetHistory(_session: Session, _briefingMessage: string): void {}

  async closeSession(_session: Session): Promise<void> {}

  async fetchModels(): Promise<ModelInfo[]> {
    return [{ id: this.currentModel, name: this.currentModel }];
  }
}

test("loop controller centralizes explicit run bootstrap without orchestrator hooks", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-loop-controller-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const memoryStore = new MemoryStore("pending");
    const graphMemory = new GraphMemory(memoryStore);
    const teamOrchestrator = new TeamOrchestrator(teamStore, graphMemory, () => "pending");
    const bootstrapper = new ResearchSessionBootstrapper(teamStore, teamOrchestrator);
    const orchestrator = new Orchestrator({
      defaultProvider: "openai",
      systemPrompt: "test system prompt",
      sessionStore,
    });
    orchestrator.registerProvider(new FakeProvider(sessionStore));

    const controller = new ResearchLoopController(orchestrator, bootstrapper, teamStore);

    for await (const _event of controller.sendUserPrompt("Create a bounded improvement run")) {
      // drain
    }

    const session = sessionStore.listSessions(1)[0];
    assert.ok(session);
    const run = teamStore.listRecentTeamRuns(session.id, 1)[0];
    assert.ok(run);
    assert.equal(run.goal, "Create a bounded improvement run");
    assert.equal(run.automationPolicy.mode, "supervised-auto");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("loop controller computes autonomous continuation from active run state", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-loop-continuation-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const memoryStore = new MemoryStore("pending");
    const graphMemory = new GraphMemory(memoryStore);
    const teamOrchestrator = new TeamOrchestrator(teamStore, graphMemory, () => "pending");
    const bootstrapper = new ResearchSessionBootstrapper(teamStore, teamOrchestrator);
    const orchestrator = new Orchestrator({
      defaultProvider: "openai",
      systemPrompt: "test system prompt",
      sessionStore,
    });
    orchestrator.registerProvider(new FakeProvider(sessionStore));
    const controller = new ResearchLoopController(orchestrator, bootstrapper, teamStore);

    for await (const _event of controller.sendUserPrompt("Keep improving the loop until blocked")) {
      // drain
    }

    const session = sessionStore.listSessions(1)[0];
    assert.ok(session);
    const continuation = controller.getAutonomousContinuationForSession(session.id, {
      isStreaming: false,
      isSleeping: false,
      monitorActive: false,
    });

    assert.ok(continuation);
    assert.match(continuation.prompt, /Autonomous continuation/);
    assert.match(continuation.label, /Autonomous loop continuing/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
