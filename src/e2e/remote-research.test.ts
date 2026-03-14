import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  return {
    experimentId: "exp-remote-e2e",
    proposalId: "proposal-remote-e2e",
    machineId: "gpu-1",
    repoPath: "/workspace/athena",
    command: "python remote_train.py",
    evaluationMetric: "loss",
    patchScope: ["trainer"],
    allowedChangeUnit: "trainer",
    budget: { maxConcurrentRuns: 1, maxWallClockMinutes: 20 },
    rollbackPlan: "git restore trainer.py",
    description: "Run a remote experiment through the same orchestration path",
  };
}

test("remote research e2e: remote machine task key and automation finalization are preserved", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-remote-e2e-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("claude", "claude-opus-4-6");
    const graphMemory = new GraphMemory(new MemoryStore(session.id));
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);
    const runner = new SimulationRunner(
      {
        execBackground: async () => ({ machineId: "gpu-1", pid: 9001, logPath: "/remote/athena/run.log" }),
        isRunning: async () => false,
        removeBackgroundProcess: () => undefined,
        readExitCode: async () => 0,
        tail: async () => "remote finished successfully",
      } as never,
      {
        exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      } as never,
      {
        getTaskSummary: () => ({ loss: { latest: 0.61, count: 4 } }),
      } as never,
      {
        collectAll: async () => undefined,
        removeSource: () => undefined,
      } as never,
      {
        createBranch: async () => "exp/remote-branch",
      } as never,
      teamStore,
      () => session.id,
      () => ({ totalCostUsd: 0.25, lastInputTokens: 1200 }),
    );
    const manager = new ResearchAutomationManager(
      teamStore,
      orchestrator,
      runner,
      {
        isRunning: async () => false,
        readExitCode: async () => 0,
        tail: async () => "remote finished successfully",
        removeBackgroundProcess: () => undefined,
      } as never,
      {
        collectAll: async () => undefined,
        removeSource: () => undefined,
      } as never,
    );

    const run = orchestrator.startRun("Benchmark the remote GPU machine");
    orchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-remote-e2e",
      title: "Remote baseline",
      summary: "Launch a remote task and finalize through automation",
      targetModules: ["trainer"],
      expectedGain: "moderate",
      expectedRisk: "low",
      codeChangeScope: ["trainer"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 20 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],
    });

    const launched = await runner.launch(createCharter());
    const updates = await manager.tickSession(session.id);
    const refreshedRun = teamStore.getTeamRun(run.id);
    const simulation = teamStore.getSimulationRun(launched.simulationId);

    assert.ok(updates.some((item) => item.id === run.id));
    assert.equal(launched.taskId, "gpu-1:9001");
    assert.equal(launched.branchName, "exp/remote-branch");
    assert.equal(simulation?.taskKey, "gpu-1:9001");
    assert.equal(simulation?.status, "inconclusive");
    assert.equal(simulation?.logPath, "/remote/athena/run.log");
    assert.equal(refreshedRun?.currentStage, "reporting");
    assert.equal((refreshedRun?.latestOutput as { outcomeStatus?: string } | undefined)?.outcomeStatus, "inconclusive");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
