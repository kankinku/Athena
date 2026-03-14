import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GraphMemory } from "../memory/graph-memory.js";
import { MemoryStore } from "../memory/memory-store.js";
import { closeDb } from "../store/database.js";
import { SessionStore } from "../store/session-store.js";
import { ResearchAutomationManager } from "./automation-manager.js";
import { TeamOrchestrator } from "./team-orchestrator.js";
import { TeamStore } from "./team-store.js";
import { SimulationRunner } from "./simulation-runner.js";

function createCharter() {
  return {
    experimentId: "exp-auto-1",
    proposalId: "proposal-auto-1",
    machineId: "local",
    command: "python train.py",
    evaluationMetric: "loss",
    patchScope: ["config"],
    allowedChangeUnit: "config",
    budget: { maxWallClockMinutes: 10, maxConcurrentRuns: 1 },
    rollbackPlan: "revert",
    description: "automation retry test",
  };
}

test("automation manager finalizes finished simulations and records reporting state", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-automation-manager-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);

    const run = orchestrator.startRun("automation finalize test");
    orchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-auto-1",
      title: "Automation proposal",
      summary: "Run a minimal simulation",
      targetModules: ["trainer"],
      expectedGain: "moderate",
      expectedRisk: "low",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 5 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],
    });

    const runner = new SimulationRunner(
      {
        execBackground: async () => ({ machineId: "local", pid: 4321, logPath: "auto.log" }),
        isRunning: async () => false,
        removeBackgroundProcess: () => {},
        readExitCode: async () => 0,
        tail: async () => "completed without explicit evaluation payload",
      } as never,
      { exec: async () => ({ stdout: "", stderr: "", code: 0 }) } as never,
      { getTaskSummary: () => ({ loss: { latest: 0.9, count: 4 } }) } as never,
      { collectAll: async () => {}, removeSource: () => {} } as never,
      { createBranch: async () => undefined } as never,
      teamStore,
      () => session.id,
      () => ({ totalCostUsd: 0, lastInputTokens: 0 }),
    );

    const launch = await runner.launch(createCharter());
    const manager = new ResearchAutomationManager(
      teamStore,
      orchestrator,
      runner,
      {
        isRunning: async () => false,
        readExitCode: async () => 0,
        tail: async () => "completed without explicit evaluation payload",
        removeBackgroundProcess: () => {},
      } as never,
      { collectAll: async () => {}, removeSource: () => {} } as never,
    );

    const updates = await manager.tickSession(session.id);
    const refreshedRun = teamStore.getTeamRun(run.id);
    const simulation = teamStore.getSimulationRun(launch.simulationId);

    assert.ok(updates.some((item) => item.id === run.id));
    assert.equal(simulation?.status, "inconclusive");
    assert.equal(refreshedRun?.currentStage, "reporting");
    assert.equal((refreshedRun?.latestOutput as { outcomeStatus?: string } | undefined)?.outcomeStatus, "inconclusive");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("automation manager recovers active auto runs on startup", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-automation-startup-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);
    const run = orchestrator.startRun("startup recovery test");

    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        ...run.automationPolicy,
        mode: "overnight-auto",
        requireProposalApproval: false,
        requireExperimentApproval: false,
      },
    });

    const manager = new ResearchAutomationManager(
      teamStore,
      orchestrator,
      { enforceBudgets: async () => [] } as never,
      {} as never,
      {} as never,
    );

    const recovered = await manager.recoverSession(session.id);
    const refreshedRun = teamStore.getTeamRun(run.id);

    assert.ok(recovered.some((item) => item.id === run.id));
    assert.equal(refreshedRun?.automationState.resumeCount, 1);
    assert.equal((refreshedRun?.latestOutput as { resumeReason?: string } | undefined)?.resumeReason, "runtime startup recovery");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("automation manager schedules retry for eligible outcomes", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-automation-recovery-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);
    const run = orchestrator.startRun("automation recovery test");

    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        ...run.automationPolicy,
        mode: "supervised-auto",
        requireProposalApproval: false,
        requireExperimentApproval: false,
      },
      retryPolicy: {
        maxRetries: 2,
        retryOn: ["inconclusive"],
      },
    });

    orchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-auto-retry",
      title: "Retryable proposal",
      summary: "Should retry automatically",
      targetModules: ["trainer"],
      expectedGain: "moderate",
      expectedRisk: "low",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 5 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],
    });

    teamStore.createSimulationRun(session.id, "proposal-auto-retry", createCharter());
    teamStore.updateTeamRun(run.id, {
      currentStage: "reporting",
      status: "completed",
      latestOutput: {
        proposalId: "proposal-auto-retry",
        experimentId: teamStore.listRecentSimulationRuns(session.id, 1)[0]?.id,
        outcomeStatus: "inconclusive",
      },
    });

    let launchCount = 0;
    const runner = new SimulationRunner(
      {
        execBackground: async () => {
          launchCount += 1;
          return { machineId: "local", pid: 2222 + launchCount, logPath: `retry-${launchCount}.log` };
        },
        isRunning: async () => false,
        removeBackgroundProcess: () => {},
      } as never,
      { exec: async () => ({ stdout: "", stderr: "", code: 0 }) } as never,
      { getTaskSummary: () => ({}) } as never,
      { collectAll: async () => {}, removeSource: () => {} } as never,
      { createBranch: async () => undefined } as never,
      teamStore,
      () => session.id,
      () => ({ totalCostUsd: 0, lastInputTokens: 0 }),
    );

    const manager = new ResearchAutomationManager(
      teamStore,
      orchestrator,
      runner,
      { isRunning: async () => false, readExitCode: async () => 0, tail: async () => "", removeBackgroundProcess: () => {} } as never,
      { collectAll: async () => {}, removeSource: () => {} } as never,
    );

    const recovered = await manager.recoverSession(session.id);
    const refreshedRun = teamStore.getTeamRun(run.id);
    const latestSimulation = teamStore.listRecentSimulationRuns(session.id, 5)[0];

    assert.ok(recovered.some((item) => item.id === run.id));
    assert.equal(refreshedRun?.automationState.retryCount, 1);
    assert.equal(refreshedRun?.currentStage, "simulation");
    assert.equal(launchCount, 1);
    assert.equal(latestSimulation?.status, "running");
    assert.match(latestSimulation?.logPath ?? "", /retry-1\.log/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("automation manager respects fully autonomous retry caps", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-automation-autonomous-retry-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);
    const run = orchestrator.startRun("fully autonomous retry cap test");

    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        ...run.automationPolicy,
        mode: "fully-autonomous",
        requireProposalApproval: false,
        requireExperimentApproval: false,
        autonomyPolicy: {
          maxRiskTier: "safe",
          maxRetryCount: 0,
          requireRollbackPlan: true,
        },
      },
      retryPolicy: {
        maxRetries: 2,
        retryOn: ["inconclusive"],
      },
    });

    orchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-auto-policy",
      title: "Autonomous retry-capped proposal",
      summary: "Should stop before a retry launches",
      targetModules: ["trainer"],
      expectedGain: "moderate",
      expectedRisk: "low",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 5 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],
    });

    teamStore.createSimulationRun(session.id, "proposal-auto-policy", createCharter());
    teamStore.updateTeamRun(run.id, {
      currentStage: "reporting",
      status: "completed",
      latestOutput: {
        proposalId: "proposal-auto-policy",
        experimentId: teamStore.listRecentSimulationRuns(session.id, 1)[0]?.id,
        outcomeStatus: "inconclusive",
      },
    });

    let launchCount = 0;
    const runner = new SimulationRunner(
      {
        execBackground: async () => {
          launchCount += 1;
          return { machineId: "local", pid: 3333, logPath: "autonomous-retry.log" };
        },
        isRunning: async () => false,
        removeBackgroundProcess: () => {},
      } as never,
      { exec: async () => ({ stdout: "", stderr: "", code: 0 }) } as never,
      { getTaskSummary: () => ({}) } as never,
      { collectAll: async () => {}, removeSource: () => {} } as never,
      { createBranch: async () => undefined } as never,
      teamStore,
      () => session.id,
      () => ({ totalCostUsd: 0, lastInputTokens: 0 }),
    );

    const manager = new ResearchAutomationManager(
      teamStore,
      orchestrator,
      runner,
      { isRunning: async () => false, readExitCode: async () => 0, tail: async () => "", removeBackgroundProcess: () => {} } as never,
      { collectAll: async () => {}, removeSource: () => {} } as never,
    );

    await manager.recoverSession(session.id);
    const refreshedRun = teamStore.getTeamRun(run.id);

    assert.equal(launchCount, 0);
    assert.equal((refreshedRun?.latestOutput as { automationBlock?: { action: string } } | undefined)?.automationBlock?.action, "retry");
    assert.match((refreshedRun?.latestOutput as { automationBlock?: { reason: string } } | undefined)?.automationBlock?.reason ?? "", /autonomous retry limit reached/i);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("automation manager fails runs that exceed the current stage timeout", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-automation-stage-timeout-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);
    const run = orchestrator.startRun("stage timeout manager test");

    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        ...run.automationPolicy,
        mode: "overnight-auto",
        requireProposalApproval: false,
        requireExperimentApproval: false,
      },
      timeoutPolicy: {
        maxRunMinutes: 120,
        maxStageMinutes: 1,
      },
    });
    teamStore.updateTeamRun(run.id, {
      automationState: {
        ...(teamStore.getTeamRun(run.id)?.automationState ?? run.automationState),
        stageStartedAt: Date.now() - 120_000,
      },
    });

    const manager = new ResearchAutomationManager(
      teamStore,
      orchestrator,
      { enforceBudgets: async () => [] } as never,
      {} as never,
      {} as never,
    );

    const updates = await manager.tickSession(session.id);
    const refreshedRun = teamStore.getTeamRun(run.id);

    assert.ok(updates.some((item) => item.id === run.id));
    assert.equal(refreshedRun?.status, "failed");
    assert.equal(refreshedRun?.currentStage, "reporting");
    assert.equal((refreshedRun?.latestOutput as { automationTimeout?: boolean } | undefined)?.automationTimeout, true);
    assert.match((refreshedRun?.latestOutput as { automationBlock?: { reason: string } } | undefined)?.automationBlock?.reason ?? "", /stage timeout/i);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
