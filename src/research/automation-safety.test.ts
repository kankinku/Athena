import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function withResearchRuntime<T>(runTest: (deps: {
  SessionStore: typeof import("../store/session-store.js").SessionStore;
  TeamStore: typeof import("./team-store.js").TeamStore;
  MemoryStore: typeof import("../memory/memory-store.js").MemoryStore;
  GraphMemory: typeof import("../memory/graph-memory.js").GraphMemory;
  TeamOrchestrator: typeof import("./team-orchestrator.js").TeamOrchestrator;
  closeDb: typeof import("../store/database.js").closeDb;
}) => Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "athena-automation-safety-"));
  process.env.ATHENA_HOME = home;
  const deps = await Promise.all([
    import("../store/session-store.js"),
    import("./team-store.js"),
    import("../memory/memory-store.js"),
    import("../memory/graph-memory.js"),
    import("./team-orchestrator.js"),
    import("../store/database.js"),
  ]);

  try {
    return await runTest({
      SessionStore: deps[0].SessionStore,
      TeamStore: deps[1].TeamStore,
      MemoryStore: deps[2].MemoryStore,
      GraphMemory: deps[3].GraphMemory,
      TeamOrchestrator: deps[4].TeamOrchestrator,
      closeDb: deps[5].closeDb,
    });
  } finally {
    deps[5].closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
}

test("proposal approval gate blocks automatic progression into simulation", async () => {
  await withResearchRuntime(async ({ SessionStore, TeamStore, MemoryStore, GraphMemory, TeamOrchestrator }) => {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);

    const run = orchestrator.startRun("automation gate test");
    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        ...run.automationPolicy,
        requireProposalApproval: true,
        requireExperimentApproval: true,
      },
    });
    teamStore.transitionWorkflow(run.id, "evaluating", "candidate pack ready");

    orchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-gated",
      title: "Gated proposal",
      summary: "Should not auto-enter simulation.",
      targetModules: ["trainer"],
      expectedGain: "moderate gain",
      expectedRisk: "low risk",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 15 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],
    });

    const blockedRun = teamStore.getTeamRun(run.id);
    assert.equal(blockedRun?.currentStage, "planning");
    assert.equal(blockedRun?.workflowState, "evaluating");
    assert.equal((blockedRun?.latestOutput as { automationBlock?: { action: string; reason: string } } | undefined)?.automationBlock?.action, "proposal");
    assert.match((blockedRun?.latestOutput as { automationBlock?: { reason: string } } | undefined)?.automationBlock?.reason ?? "", /proposal approval required/i);
    const checkpoints = teamStore.listAutomationCheckpoints(session.id, run.id);
    assert.ok(checkpoints.some((checkpoint) => checkpoint.reason === "blocked:proposal"));
  });
});

test("retry and timeout safety blocks unsafe automation continuation", async () => {
  await withResearchRuntime(async ({ SessionStore, TeamStore }) => {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const run = teamStore.createTeamRun(session.id, "retry safety test");

    teamStore.configureAutomation(run.id, {
      retryPolicy: {
        maxRetries: 1,
        retryOn: ["inconclusive"],
      },
    });
    teamStore.recordAutomationRetry(run.id, "first retry");
    teamStore.recordAutomationRetry(run.id, "second retry should be blocked");

    let reloadedRun = teamStore.getTeamRun(run.id);
    assert.equal(reloadedRun?.automationState.retryCount, 1);
    assert.equal((reloadedRun?.latestOutput as { automationBlock?: { action: string; reason: string } } | undefined)?.automationBlock?.action, "retry");
    assert.match((reloadedRun?.latestOutput as { automationBlock?: { reason: string } } | undefined)?.automationBlock?.reason ?? "", /retry limit reached/i);

    teamStore.updateTeamRun(run.id, {
      automationState: {
        ...(reloadedRun?.automationState ?? run.automationState),
        timeoutAt: Date.now() - 1000,
      },
    });
    teamStore.resumeAutomation(run.id, "resume should be blocked");

    reloadedRun = teamStore.getTeamRun(run.id);
    assert.equal((reloadedRun?.latestOutput as { automationBlock?: { action: string; reason: string } } | undefined)?.automationBlock?.action, "resume");
    assert.match((reloadedRun?.latestOutput as { automationBlock?: { reason: string } } | undefined)?.automationBlock?.reason ?? "", /automation timeout exceeded/i);
    const checkpoints = teamStore.listAutomationCheckpoints(session.id, run.id);
    assert.ok(checkpoints.some((checkpoint) => checkpoint.reason === "blocked:retry"));
    assert.ok(checkpoints.some((checkpoint) => checkpoint.reason === "blocked:resume"));
  });
});

test("experiment approval gate keeps proposals queued for operator launch review", async () => {
  await withResearchRuntime(async ({ SessionStore, TeamStore, MemoryStore, GraphMemory, TeamOrchestrator }) => {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);

    const run = orchestrator.startRun("experiment approval gate test");
    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        ...run.automationPolicy,
        requireProposalApproval: false,
        requireExperimentApproval: true,
      },
    });
    teamStore.transitionWorkflow(run.id, "evaluating", "proposal is ready for execution review");

    orchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-experiment-gated",
      title: "Experiment-gated proposal",
      summary: "Should stop before simulation launch.",
      targetModules: ["trainer"],
      expectedGain: "moderate gain",
      expectedRisk: "low risk",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 15 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],
    });

    const blockedRun = teamStore.getTeamRun(run.id);
    assert.equal(blockedRun?.currentStage, "planning");
    assert.equal(blockedRun?.workflowState, "evaluating");
    assert.equal((blockedRun?.latestOutput as { proposalStatus?: string; automationBlock?: { action: string; reason: string } } | undefined)?.proposalStatus, "ready_for_experiment");
    assert.equal((blockedRun?.latestOutput as { automationBlock?: { action: string } } | undefined)?.automationBlock?.action, "experiment");
    assert.match((blockedRun?.latestOutput as { automationBlock?: { reason: string } } | undefined)?.automationBlock?.reason ?? "", /experiment approval required/i);
  });
});
