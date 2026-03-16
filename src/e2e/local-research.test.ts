import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { ConnectionPool } from "../remote/connection-pool.js";
import { RemoteExecutor } from "../remote/executor.js";
import { GraphMemory } from "../memory/graph-memory.js";
import { MemoryStore } from "../memory/memory-store.js";
import { closeDb } from "../store/database.js";
import { SessionStore } from "../store/session-store.js";
import { ResearchAutomationManager } from "../research/automation-manager.js";
import { SimulationRunner } from "../research/simulation-runner.js";
import { TeamOrchestrator } from "../research/team-orchestrator.js";
import { TeamStore } from "../research/team-store.js";
import type { ExperimentCharter } from "../research/contracts.js";

function createCharter(): ExperimentCharter {
  const command = process.platform === "win32"
    ? "echo loss=0.73 & echo run complete"
    : "echo loss=0.73; echo run complete";

  return {
    experimentId: "exp-local-e2e",
    proposalId: "proposal-local-e2e",
    machineId: "local",
    command,
    evaluationMetric: "loss",
    metricNames: ["loss"],
    patchScope: ["trainer"],
    allowedChangeUnit: "trainer",
    budget: { maxConcurrentRuns: 1, maxWallClockMinutes: 5 },
    rollbackPlan: "git restore trainer.py",
    description: "Run a local no-op experiment",
  };
}

test("local research e2e: launch, finish, and finalize a local simulation", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-local-e2e-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const graphMemory = new GraphMemory(new MemoryStore(session.id));
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);
    const pool = new ConnectionPool();
    const executor = new RemoteExecutor(pool);
    const runner = new SimulationRunner(
      executor,
      pool,
      {
        getTaskSummary: () => ({ loss: { latest: 0.73, count: 1 } }),
      } as never,
      {
        collectAll: async () => undefined,
        removeSource: () => undefined,
      } as never,
      {
        createBranch: async () => undefined,
      } as never,
      teamStore,
      () => session.id,
      () => ({ totalCostUsd: 0, lastInputTokens: 0 }),
    );
    const manager = new ResearchAutomationManager(
      teamStore,
      orchestrator,
      runner,
      executor,
      {
        collectAll: async () => undefined,
        removeSource: () => undefined,
      } as never,
    );

    const run = orchestrator.startRun("Benchmark the training loop locally");
    orchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-local-e2e",
      title: "Local baseline",
      summary: "Launch a local process and track the result",
      targetModules: ["trainer"],
      expectedGain: "low",
      expectedRisk: "low",
      codeChangeScope: ["trainer"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 5 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],
    });

    const launched = await runner.launch(createCharter());
    await sleep(400);
    const updates = await manager.tickSession(session.id);

    const refreshedRun = teamStore.getTeamRun(run.id);
    const simulation = teamStore.getSimulationRun(launched.simulationId);

    assert.ok(updates.some((item) => item.id === run.id));
    assert.equal(launched.taskId.startsWith("local:"), true);
    // Zero-exit without evaluation metrics is correctly classified as inconclusive
    assert.equal(simulation?.status, "inconclusive");
    assert.equal(refreshedRun?.currentStage, "reporting");
    assert.equal((refreshedRun?.latestOutput as { outcomeStatus?: string } | undefined)?.outcomeStatus, "inconclusive");
    assert.match(simulation?.logPath ?? "", /\.log$/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
