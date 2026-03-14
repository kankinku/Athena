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
import { buildResearchReportInput } from "./reporting.js";
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

test("first prompt bootstraps a research run and reportable state", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-phase2-bootstrap-"));
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
    const provider = new FakeProvider(sessionStore);

    orchestrator.registerProvider(provider);
    orchestrator.setBeforeSendHook(({ session, message, provider }) => {
      bootstrapper.ensurePromptRun({
        sessionId: session.id,
        prompt: message,
        provider: provider.name,
        model: provider.currentModel,
      });
    });

    for await (const _event of orchestrator.send("Phase 2 bootstrap prompt")) {
      // drain
    }
    for await (const _event of orchestrator.send("Follow-up prompt should reuse the same run")) {
      // drain
    }

    const session = sessionStore.listSessions(1)[0];
    assert.ok(session);

    const runs = teamStore.listRecentTeamRuns(session.id, 10);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].workflowState, "running");
    assert.equal(runs[0].status, "active");
    assert.equal((runs[0].latestOutput as { source?: string } | undefined)?.source, "initial_prompt");

    const sources = teamStore.listIngestionSources(session.id);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].sourceType, "manual");
    assert.match(sources[0].notes ?? "", /Phase 2 bootstrap prompt/);

    const reportInput = buildResearchReportInput(session.id, teamStore, sessionStore, { transcriptLimit: 20 });
    assert.match(reportInput, /## Team Runs/);
    assert.match(reportInput, /## Ingestion Sources/);
    assert.match(reportInput, /Phase 2 bootstrap prompt/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
