import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SimulationRunner } from "./simulation-runner.js";
import type { ExperimentCharter } from "./contracts.js";

function createCharter(overrides: Partial<ExperimentCharter> = {}): ExperimentCharter {
  return {
    experimentId: "exp-1",
    proposalId: "proposal-1",
    machineId: "local",
    command: "python train.py",
    evaluationMetric: "loss",
    patchScope: ["config"],
    allowedChangeUnit: "config",
    budget: { maxWallClockMinutes: 10, maxConcurrentRuns: 1 },
    rollbackPlan: "Revert the config change.",
    description: "Baseline training run",
    ...overrides,
  };
}

async function createRunnerHarness() {
  const home = mkdtempSync(join(tmpdir(), "athena-sim-safety-"));
  process.env.ATHENA_HOME = home;
  const [{ SessionStore }, { TeamStore }, { closeDb }] = await Promise.all([
    import("../store/session-store.js"),
    import("./team-store.js"),
    import("../store/database.js"),
  ]);

  const sessionStore = new SessionStore();
  const teamStore = new TeamStore();
  const session = sessionStore.createSession("openai", "gpt-5.4");

  const executor = {
    execBackground: async () => ({ machineId: "local", pid: 1234, logPath: "log.txt" }),
    isRunning: async () => false,
    removeBackgroundProcess: () => {},
  };
  const connectionPool = { exec: async () => ({ stdout: "", stderr: "", code: 0 }) };
  const metricStore = { getTaskSummary: () => ({}) };
  const metricCollector = { collectAll: async () => {}, removeSource: () => {} };
  const brancher = { createBranch: async () => undefined };

  const runner = new SimulationRunner(
    executor as never,
    connectionPool as never,
    metricStore as never,
    metricCollector as never,
    brancher as never,
    teamStore,
    () => session.id,
    () => ({ totalCostUsd: 0, lastInputTokens: 0 }),
  );

  return { home, closeDb, teamStore, session, runner, executor };
}

test("SimulationRunner canLaunch rejects unsafe or incomplete charters", async () => {
  const { home, closeDb, runner } = await createRunnerHarness();
  try {
    assert.equal(runner.canLaunch(createCharter({ command: "" })).ok, false);
    assert.equal(runner.canLaunch(createCharter({ evaluationMetric: "" })).reason, "evaluationMetric is required");
    assert.equal(runner.canLaunch(createCharter({ patchScope: [] })).reason, "patchScope must include at least one change unit");
    assert.equal(runner.canLaunch(createCharter({ branchName: "feature/x", repoPath: "" })).reason, "repoPath is required when branchName is provided");
    assert.equal(runner.canLaunch(createCharter({ budget: { maxConcurrentRuns: 0 } })).reason, "maxConcurrentRuns must be >= 1");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("SimulationRunner enforces maxConcurrentRuns before launch", async () => {
  const { home, closeDb, runner } = await createRunnerHarness();
  try {
    await runner.launch(createCharter({ experimentId: "exp-1" }));
    const check = runner.canLaunch(createCharter({ experimentId: "exp-2", budget: { maxConcurrentRuns: 1 } }));
    assert.equal(check.ok, false);
    assert.match(check.reason ?? "", /maxConcurrentRuns reached/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("SimulationRunner records launch_failed when background launch throws", async () => {
  const { home, closeDb, teamStore, session } = await createRunnerHarness();
  try {
    const run = teamStore.createTeamRun(session.id, "launch failure parent run");
    teamStore.updateTeamRun(run.id, {
      latestOutput: {
        proposalId: "proposal-1",
      },
    });
    const failingExecutor = {
      execBackground: async () => {
        throw new Error("ssh launch failed");
      },
      isRunning: async () => false,
      removeBackgroundProcess: () => {},
    };
    const runner = new SimulationRunner(
      failingExecutor as never,
      { exec: async () => ({ stdout: "", stderr: "", code: 0 }) } as never,
      { getTaskSummary: () => ({}) } as never,
      { collectAll: async () => {}, removeSource: () => {} } as never,
      { createBranch: async () => undefined } as never,
      teamStore,
      () => session.id,
      () => ({ totalCostUsd: 0, lastInputTokens: 0 }),
    );

    await assert.rejects(() => runner.launch(createCharter()), /ssh launch failed/);
    const runs = teamStore.listRecentSimulationRuns(session.id, 10);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, "launch_failed");
    assert.equal(runs[0]?.result?.outcomeStatus, "crash");
    assert.match(runs[0]?.result?.notes ?? "", /Launch failed: ssh launch failed/);
    const checkpoints = teamStore.listAutomationCheckpoints(session.id, run.id);
    assert.ok(checkpoints.some((checkpoint) => checkpoint.reason === "launch_failed"));
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("SimulationRunner records launch_failed when branch preparation throws", async () => {
  const { home, closeDb, teamStore, session } = await createRunnerHarness();
  try {
    const run = teamStore.createTeamRun(session.id, "branch failure parent run");
    teamStore.updateTeamRun(run.id, {
      latestOutput: {
        proposalId: "proposal-1",
      },
    });
    const runner = new SimulationRunner(
      { execBackground: async () => ({ machineId: "local", pid: 1234, logPath: "log.txt" }), isRunning: async () => false, removeBackgroundProcess: () => {} } as never,
      { exec: async () => ({ stdout: "", stderr: "", code: 0 }) } as never,
      { getTaskSummary: () => ({}) } as never,
      { collectAll: async () => {}, removeSource: () => {} } as never,
      { createBranch: async () => { throw new Error("branch creation failed"); } } as never,
      teamStore,
      () => session.id,
      () => ({ totalCostUsd: 0, lastInputTokens: 0 }),
    );

    await assert.rejects(() => runner.launch(createCharter({ repoPath: "/repo" })), /branch creation failed/);
    const runs = teamStore.listRecentSimulationRuns(session.id, 10);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, "launch_failed");
    assert.match(runs[0]?.result?.notes ?? "", /Launch failed: branch creation failed/);
    const checkpoints = teamStore.listAutomationCheckpoints(session.id, run.id);
    assert.ok(checkpoints.some((checkpoint) => checkpoint.reason === "launch_failed"));
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
