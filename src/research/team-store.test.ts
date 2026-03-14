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
        mode: "fully-autonomous",
        requireProposalApproval: false,
        requireExperimentApproval: false,
        requireRevisitApproval: false,
        maxAutoExperiments: 2,
        autonomyPolicy: {
          maxRiskTier: "safe",
          maxRetryCount: 1,
          maxWallClockMinutes: 90,
          maxCostUsd: 12,
          requireRollbackPlan: true,
          requireEvidenceFloor: 0.7,
          allowedMachineIds: ["local"],
        },
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
    assert.equal(configured?.automationPolicy.mode, "fully-autonomous");
    assert.equal(configured?.automationPolicy.autonomyPolicy?.maxRiskTier, "safe");

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
    assert.equal(persistedRun?.automationPolicy.mode, "fully-autonomous");
    assert.equal(persistedRun?.automationPolicy.autonomyPolicy?.maxRetryCount, 1);
    assert.deepEqual(persistedRun?.automationPolicy.autonomyPolicy?.allowedMachineIds, ["local"]);
    assert.equal(persistedRun?.automationState.resumeCount, 1);
    assert.equal(persistedRun?.automationState.retryCount, 1);
    assert.equal(persistedRun?.automationState.stageStartedAt, undefined);

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

test("TeamStore reviewImprovementProposal validates review transitions and dismisses duplicate merge keys on promote", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-improvement-review-"));
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

    const baseProposal = {
      runId: "run-1",
      mergeKey: "research_strategy::proposal-1::keep",
      title: "Research Strategy Improvement",
      targetArea: "research_strategy" as const,
      hypothesis: "Capture a reusable strategy.",
      rationale: "Observed repeated success.",
      expectedBenefit: "More reuse.",
      priorityScore: 0.88,
      rollbackPlan: "Discard the promoted heuristic.",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    teamStore.saveImprovementProposal(session.id, {
      improvementId: "imp-primary",
      reviewStatus: "queued",
      status: "proposed",
      ...baseProposal,
    });
    teamStore.saveImprovementProposal(session.id, {
      improvementId: "imp-duplicate",
      reviewStatus: "queued",
      status: "proposed",
      ...baseProposal,
    });

    const reviewing = teamStore.reviewImprovementProposal(session.id, "imp-primary", "start_review");
    assert.equal(reviewing.reviewStatus, "in_review");

    const promoted = teamStore.reviewImprovementProposal(session.id, "imp-primary", "promote");
    assert.equal(promoted.reviewStatus, "promoted");
    assert.equal(promoted.status, "approved");

    const duplicate = teamStore.listImprovementProposals(session.id).find((item) => item.improvementId === "imp-duplicate");
    assert.equal(duplicate?.reviewStatus, "dismissed");
    assert.equal(duplicate?.status, "rejected");

    assert.throws(
      () => teamStore.reviewImprovementProposal(session.id, "imp-primary", "dismiss"),
      /Cannot dismiss a promoted improvement proposal/,
    );
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore delegates simulation persistence without changing behavior", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-simulation-store-"));
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

    const created = teamStore.createSimulationRun(session.id, "proposal-sim", {
      experimentId: "exp-sim",
      proposalId: "proposal-sim",
      machineId: "local",
      command: "npm test",
      evaluationMetric: "loss",
      patchScope: ["trainer"],
      allowedChangeUnit: "single patch",
      budget: { maxWallClockMinutes: 15 },
      rollbackPlan: "git checkout -- trainer.ts",
      description: "simulation persistence test",
    });

    const updated = teamStore.updateSimulationRun(created.id, {
      taskKey: "local:1234",
      logPath: "/tmp/sim.log",
      status: "running",
      result: {
        experimentId: created.id,
        proposalId: "proposal-sim",
        outcomeStatus: "inconclusive",
        beforeMetrics: {},
        afterMetrics: { loss: 1.23 },
        resourceDelta: {},
        surprisingFindings: ["pending"],
      },
    });

    const reloaded = teamStore.getSimulationRun(created.id);
    const running = teamStore.listRunningSimulationRuns(session.id);
    const recent = teamStore.listRecentSimulationRuns(session.id, 5);

    assert.equal(updated?.taskKey, "local:1234");
    assert.equal(reloaded?.logPath, "/tmp/sim.log");
    assert.equal(reloaded?.result?.afterMetrics.loss, 1.23);
    assert.equal(running.length, 1);
    assert.equal(running[0]?.id, created.id);
    assert.equal(recent[0]?.id, created.id);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore scopes proposal evidence health to the proposal-linked sources", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-evidence-health-"));
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

    teamStore.saveIngestionSource(session.id, {
      sourceId: "source-a",
      sourceType: "manual",
      title: "Source A",
      status: "ingested",
      claimCount: 1,
      canonicalClaims: [{
        canonicalClaimId: "claim-a",
        semanticKey: "claim-a",
        statement: "Source A claim",
        normalizedStatement: "source a claim",
        sourceClaimIds: ["source-a-claim-1"],
        evidenceIds: ["evidence-a"],
        supportTags: ["latency"],
        contradictionTags: [],
        sourceIds: ["source-a"],
        confidence: 0.9,
        freshnessScore: 0.8,
      }],
      createdAt: 1,
      updatedAt: 1,
    });
    teamStore.saveIngestionSource(session.id, {
      sourceId: "source-b",
      sourceType: "manual",
      title: "Source B",
      status: "ingested",
      claimCount: 1,
      canonicalClaims: [{
        canonicalClaimId: "claim-b",
        semanticKey: "claim-b",
        statement: "Source B claim",
        normalizedStatement: "source b claim",
        sourceClaimIds: ["source-b-claim-1"],
        evidenceIds: ["evidence-b"],
        supportTags: ["memory"],
        contradictionTags: ["rollback"],
        sourceIds: ["source-b"],
        confidence: 0.5,
        freshnessScore: 0.5,
      }],
      createdAt: 2,
      updatedAt: 2,
    });

    teamStore.saveProposalBrief(session.id, {
      proposalId: "proposal-a",
      title: "Proposal A",
      summary: "Uses only source A",
      targetModules: ["trainer"],
      expectedGain: "high",
      expectedRisk: "low",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: {},
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: ["claim-a"],
    });

    const evidenceHealth = teamStore.buildEvidenceHealth(session.id, "proposal-a");

    assert.equal(evidenceHealth.sourceCount, 1);
    assert.equal(evidenceHealth.claimCount, 1);
    assert.equal(evidenceHealth.canonicalClaimCount, 1);
    assert.equal(evidenceHealth.contradictionCount, 0);
    assert.equal(evidenceHealth.modelConfidence, 0.9);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore delegates proposal persistence without changing behavior", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-proposal-store-"));
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

    teamStore.saveProposalScorecard(session.id, {
      proposalId: "proposal-store",
      merit: 0.7,
      risk: 0.2,
      decisionScore: 0.65,
      weightedScore: 0.68,
      axisScores: {
        expected_gain: 0.8,
        evidence_strength: 0.7,
        evidence_freshness: 0.6,
        contradiction_pressure: 0.1,
        memory_risk: 0.2,
        stability_risk: 0.2,
        integration_cost: 0.3,
        rollback_difficulty: 0.2,
        observability_readiness: 0.5,
      },
      evaluatorSummaries: [],
      disagreementFlags: [],
      scoreVersion: "v1",
    });

    teamStore.saveProposalBrief(session.id, {
      proposalId: "proposal-store",
      title: "Proposal store test",
      summary: "Delegation should preserve behavior.",
      targetModules: ["trainer"],
      expectedGain: "moderate gain",
      expectedRisk: "low risk",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 10 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],
    });

    const listed = teamStore.listProposalBriefs(session.id);
    const fetched = teamStore.getProposalBrief(session.id, "proposal-store");
    const reviewed = teamStore.reviewProposalBrief(session.id, "proposal-store", "revisit");
    const revisitDue = teamStore.listRevisitDueProposals(session.id);

    assert.equal(listed.length, 1);
    assert.equal(fetched?.scorecard?.weightedScore, 0.68);
    assert.equal(reviewed.status, "revisit_due");
    assert.equal(revisitDue[0]?.proposalId, "proposal-store");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore delegates decision and reconsideration persistence without changing behavior", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-decision-store-"));
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

    teamStore.saveDecisionRecord(session.id, {
      decisionId: "decision-store",
      proposalId: "proposal-store",
      decisionType: "revisit",
      decisionSummary: "Need fresher evidence.",
      confidence: 0.42,
      reasonTags: ["needs_more_evidence"],
      createdAt: 1,
      createdBy: "test",
      evidenceLinks: ["claim-1"],
    });

    teamStore.saveReconsiderationTrigger(session.id, {
      triggerId: "trigger-store",
      decisionId: "decision-store",
      triggerType: "new_evidence",
      triggerCondition: "A stronger benchmark appears.",
      status: "open",
    });

    const decisions = teamStore.listDecisionRecords(session.id);
    const byTag = teamStore.listDecisionRecordsByTag(session.id, "needs_more_evidence");
    const latest = teamStore.getLatestDecisionRecord(session.id, "proposal-store");
    const open = teamStore.listOpenReconsiderationTriggers(session.id);
    const updated = teamStore.updateReconsiderationTrigger(session.id, "trigger-store", {
      status: "revisit_due",
      evidenceLinks: ["claim-1", "claim-2"],
    });

    assert.equal(decisions.length, 1);
    assert.equal(byTag.length, 1);
    assert.equal(latest?.decisionId, "decision-store");
    assert.equal(open[0]?.proposalId, "proposal-store");
    assert.equal(updated?.status, "revisit_due");
    assert.deepEqual(updated?.evidenceLinks, ["claim-1", "claim-2"]);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore delegates experiment lineage persistence without changing behavior", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-lineage-store-"));
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

    teamStore.saveExperimentLineage(session.id, {
      lineageId: "lineage-store",
      proposalId: "proposal-store",
      experimentId: "exp-child",
      relatedExperimentId: "exp-parent",
      relationType: "derived_from",
      summary: "Follow-up experiment derives from the baseline run.",
      createdAt: 1,
      supersededByExperimentId: "exp-next",
    });

    const allLineage = teamStore.listExperimentLineage(session.id);
    const proposalLineage = teamStore.listExperimentLineage(session.id, "proposal-store");

    assert.equal(allLineage.length, 1);
    assert.equal(proposalLineage.length, 1);
    assert.equal(proposalLineage[0]?.relatedExperimentId, "exp-parent");
    assert.equal(proposalLineage[0]?.supersededByExperimentId, "exp-next");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore delegates ingestion persistence without changing behavior", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-ingestion-store-"));
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

    teamStore.saveIngestionSource(session.id, {
      sourceId: "source-store",
      sourceType: "docs",
      title: "Store delegation source",
      url: "https://example.com/source",
      status: "ingested",
      extractedCandidateId: "candidate-1",
      notes: "delegation check",
      claimCount: 2,
      linkedProposalCount: 1,
      freshnessScore: 0.7,
      evidenceConfidence: 0.8,
      methodTags: ["manual"],
      extractedClaims: [],
      canonicalClaims: [
        {
          canonicalClaimId: "/research/claims/claim-store",
          semanticKey: "delegation-preserves-ingestion-state",
          statement: "Delegation preserves ingestion state.",
          normalizedStatement: "delegation preserves ingestion state",
          sourceClaimIds: ["source-store::claim-1"],
          confidence: 0.8,
          freshnessScore: 0.7,
          supportTags: ["docs"],
          contradictionTags: [],
          evidenceIds: ["source-store"],
          sourceIds: ["source-store"],
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    });

    const sources = teamStore.listIngestionSources(session.id);
    const summary = teamStore.summarizeClaims(session.id, ["/research/claims/claim-store"]);

    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.sourceId, "source-store");
    assert.equal(sources[0]?.canonicalClaims?.[0]?.canonicalClaimId, "/research/claims/claim-store");
    assert.equal(summary.claimIds[0], "/research/claims/claim-store");
    assert.equal(summary.evidenceStrength, 0.8);
    assert.equal(summary.freshnessScore, 0.7);
    assert.equal(summary.unresolvedClaims.length, 0);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore delegates team run persistence without changing behavior", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-team-run-store-"));
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

    const run = teamStore.createTeamRun(session.id, "delegate team run", {
      maxWallClockMinutes: 20,
      maxIterations: 2,
    });
    const updated = teamStore.updateTeamRun(run.id, {
      currentStage: "reporting",
      workflowState: "running",
      latestOutput: { note: "delegated" },
    });
    const fetched = teamStore.getTeamRun(run.id);
    const recent = teamStore.listRecentTeamRuns(session.id, 5);

    assert.equal(updated?.currentStage, "reporting");
    assert.equal(updated?.workflowState, "running");
    assert.equal(fetched?.latestOutput?.note, "delegated");
    assert.equal(recent[0]?.id, run.id);
    assert.equal(run.automationState.stageStartedAt, undefined);
    assert.equal(updated?.automationState.stageStartedAt, updated?.updatedAt);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore delegates workflow transition persistence without changing behavior", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-workflow-store-"));
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
    const run = teamStore.createTeamRun(session.id, "delegate workflow transition");

    teamStore.saveWorkflowTransition(session.id, {
      transitionId: "transition-store",
      runId: run.id,
      fromState: "draft",
      toState: "ready",
      reason: "delegation test",
      rollbackOfTransitionId: "transition-prev",
      metadata: { source: "test" },
      createdAt: 1,
    });

    const transitions = teamStore.listWorkflowTransitions(session.id, run.id);

    assert.equal(transitions.length, 1);
    assert.equal(transitions[0]?.transitionId, "transition-store");
    assert.equal(transitions[0]?.rollbackOfTransitionId, "transition-prev");
    assert.deepEqual(transitions[0]?.metadata, { source: "test" });
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore delegates automation checkpoint persistence without changing behavior", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-automation-store-"));
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
    const run = teamStore.createTeamRun(session.id, "delegate automation checkpoint");

    teamStore.saveAutomationCheckpoint(session.id, {
      checkpointId: "checkpoint-store",
      runId: run.id,
      workflowState: "draft",
      stage: "collection",
      reason: "delegation test",
      snapshot: { ok: true },
      createdAt: 1,
    });

    const checkpoints = teamStore.listAutomationCheckpoints(session.id, run.id);

    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]?.checkpointId, "checkpoint-store");
    assert.equal(checkpoints[0]?.reason, "delegation test");
    assert.deepEqual(checkpoints[0]?.snapshot, { ok: true });
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("TeamStore clears autonomy policy when a run leaves fully autonomous mode", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-team-store-autonomy-reset-"));
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
    const run = teamStore.createTeamRun(session.id, "Autonomy reset");

    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        ...run.automationPolicy,
        mode: "fully-autonomous",
        requireProposalApproval: false,
        requireExperimentApproval: false,
        requireRevisitApproval: false,
        autonomyPolicy: {
          maxRiskTier: "safe",
          maxRetryCount: 1,
          requireRollbackPlan: true,
        },
      },
    });

    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        ...teamStore.getTeamRun(run.id)!.automationPolicy,
        mode: "manual",
        requireProposalApproval: true,
        requireExperimentApproval: true,
        requireRevisitApproval: true,
      },
    });

    const refreshed = teamStore.getTeamRun(run.id);
    assert.equal(refreshed?.automationPolicy.mode, "manual");
    assert.equal(refreshed?.automationPolicy.autonomyPolicy, undefined);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
