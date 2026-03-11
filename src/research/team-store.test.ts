import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("TeamStore persists workflow automation and self-improvement state", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-team-store-"));
  process.env.ATHENA_HOME = home;

  const [{ SessionStore }, { TeamStore }, { closeDb }] = await Promise.all([
    import("../store/session-store.js"),
    import("./team-store.js"),
    import("../store/database.js"),
  ]);

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const run = teamStore.createTeamRun(session.id, "Stability hardening goal", {
      maxWallClockMinutes: 30,
      maxIterations: 5,
    });

    const readyRun = teamStore.transitionWorkflow(run.id, "ready", "triage complete");
    assert.ok(readyRun);

    const configured = teamStore.configureAutomation(run.id, {
      automationPolicy: {
        mode: "supervised-auto",
        requireProposalApproval: false,
        requireExperimentApproval: true,
        requireRevisitApproval: true,
        maxAutoExperiments: 2,
      },
      checkpointPolicy: {
        intervalMinutes: 10,
        onWorkflowStates: ["running", "evaluating"],
      },
      retryPolicy: {
        maxRetries: 4,
        retryOn: ["budget_exceeded", "inconclusive"],
      },
      timeoutPolicy: {
        maxRunMinutes: 90,
        maxStageMinutes: 20,
      },
    });
    assert.equal(configured?.automationPolicy.mode, "supervised-auto");

    teamStore.recordAutomationCheckpoint(run.id, "checkpoint before evaluation", { milestone: "phase-a" });
    teamStore.resumeAutomation(run.id, "resume after checkpoint");
    teamStore.recordAutomationRetry(run.id, "retry after inconclusive result");

    teamStore.saveImprovementProposal(session.id, {
      improvementId: "imp-1",
      runId: run.id,
      proposalId: "proposal-1",
      experimentId: "exp-1",
      mergeKey: "research_strategy::proposal-1::keep",
      title: "Research Strategy Improvement: proposal-1",
      targetArea: "research_strategy",
      hypothesis: "Keep the successful strategy as a reusable heuristic.",
      rationale: "The run improved accuracy with low risk.",
      expectedBenefit: "Higher reuse of successful research patterns.",
      priorityScore: 0.82,
      reviewStatus: "queued",
      rollbackPlan: "Revert the improvement if later runs regress.",
      status: "approved",
      sourceDecisionId: "decision-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    teamStore.saveImprovementEvaluation(session.id, {
      evaluationId: "eval-1",
      improvementId: "imp-1",
      runId: run.id,
      experimentId: "exp-1",
      outcome: "promising",
      summary: "The strategy looks reusable.",
      recommendedAction: "queue operator review for follow-up improvement trial",
      rollbackRequired: false,
      metricDeltaSummary: "accuracy=0.1200",
      createdAt: Date.now(),
    });

    closeDb();

    const reloadedSessionStore = new SessionStore();
    const reloadedTeamStore = new TeamStore();

    assert.ok(reloadedSessionStore.getSession(session.id));

    const persistedRun = reloadedTeamStore.getTeamRun(run.id);
    assert.ok(persistedRun);
    assert.equal(persistedRun?.automationPolicy.mode, "supervised-auto");
    assert.equal(persistedRun?.automationState.resumeCount, 1);
    assert.equal(persistedRun?.automationState.retryCount, 1);

    const transitions = reloadedTeamStore.listWorkflowTransitions(session.id, run.id);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0]?.toState, "ready");

    const checkpoints = reloadedTeamStore.listAutomationCheckpoints(session.id, run.id);
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]?.reason, "checkpoint before evaluation");

    const improvements = reloadedTeamStore.listImprovementProposals(session.id, run.id);
    assert.equal(improvements.length, 1);
    assert.equal(improvements[0]?.priorityScore, 0.82);
    assert.equal(improvements[0]?.reviewStatus, "queued");

    const evaluations = reloadedTeamStore.listImprovementEvaluations(session.id, run.id);
    assert.equal(evaluations.length, 1);
    assert.equal(evaluations[0]?.outcome, "promising");

    closeDb();
  } finally {
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
