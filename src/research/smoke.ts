import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function main(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "athena-research-smoke-"));
  process.env.ATHENA_HOME = home;

  const [{ SessionStore }, { TeamStore }, { MemoryStore }, { GraphMemory }, { ContextGate }, { TeamOrchestrator }, { buildResearchReportInput }, { closeDb }] = await Promise.all([
    import("../store/session-store.js"),
    import("./team-store.js"),
    import("../memory/memory-store.js"),
    import("../memory/graph-memory.js"),
    import("../memory/context-gate.js"),
    import("./team-orchestrator.js"),
    import("./reporting.js"),
    import("../store/database.js"),
  ]);
  const { buildProposalScorecard } = await import("./decision-engine.js");
  const { createCandidatePackFromSource, createIngestionSource } = await import("./ingestion.js");

  try {
    const sessionStore = new SessionStore();
    const session = sessionStore.createSession("openai", "gpt-test");
    sessionStore.addMessage(session.id, "user", "Optimize the training loop.");
    sessionStore.addMessage(session.id, "assistant", "Started research workflow.");

    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const teamStore = new TeamStore();
    const teamOrchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);
    const contextGate = new ContextGate(memoryStore);
    contextGate.setGraphMemory(graphMemory);
    contextGate.setTeamStore(teamStore);

    const run = teamOrchestrator.startRun("Optimize the training loop", {
      maxWallClockMinutes: 5,
      maxIterations: 10,
    });
    teamOrchestrator.configureAutomation(run.id, {
      automationPolicy: {
        mode: "overnight-auto",
        requireProposalApproval: false,
        requireExperimentApproval: false,
        requireRevisitApproval: true,
        maxAutoExperiments: 3,
      },
      checkpointPolicy: {
        intervalMinutes: 15,
        onWorkflowStates: ["running", "evaluating", "revisit_due"],
      },
      retryPolicy: {
        maxRetries: 3,
        retryOn: ["budget_exceeded", "inconclusive"],
      },
      timeoutPolicy: {
        maxRunMinutes: 180,
        maxStageMinutes: 45,
      },
    });
    teamOrchestrator.checkpointRun(run.id, "overnight handoff checkpoint", { phase: 5 });
    teamOrchestrator.resumeRunAutomation(run.id, "night schedule resumed");
    teamOrchestrator.retryRunAutomation(run.id, "budget retry scheduled");

    const ingestionSource = createIngestionSource({
      sourceType: "manual",
      title: "Smoke research source",
      notes: "Used to validate ingestion scaffolding",
    });
    teamStore.saveIngestionSource(session.id, ingestionSource);

    const candidatePack = createCandidatePackFromSource({
      source: ingestionSource,
      problemArea: "training stability",
      claims: [
        {
          claimId: "claim-memory",
          statement: "Gradient checkpointing reduces peak memory during training.",
          confidence: 0.84,
          freshnessScore: 0.72,
          source: ingestionSource.title,
        },
        {
          claimId: "claim-memory-duplicate",
          statement: "The gradient checkpointing reduces peak memory during training!",
          confidence: 0.8,
          freshnessScore: 0.69,
          source: ingestionSource.title,
        },
        {
          claimId: "claim-rollback",
          statement: "Batch-size-only trials are easier to roll back than optimizer rewrites.",
          confidence: 0.63,
          freshnessScore: 0.61,
          source: ingestionSource.title,
        },
      ],
      methods: ["Gradient Checkpointing", "gradient-checkpointing"],
      counterEvidence: ["Checkpointing can increase wall-clock time for small models."],
      openQuestions: ["Does activation recompute erase throughput gains?"],
    });
    const proposalClaimIds = candidatePack.canonicalClaims?.map((claim) => claim.canonicalClaimId) ?? [];

    const scorecard = buildProposalScorecard({
      proposalId: "proposal-smoke",
      title: "Reduce memory spikes",
      summary: "Try a narrow batch-size adjustment and compare throughput.",
      targetModules: ["src/train.ts"],
      expectedGain: "Lower peak memory with stable throughput",
      expectedRisk: "Slight loss in convergence speed",
      codeChangeScope: ["src/train.ts"],
      status: "scoped_trial",
      experimentBudget: { maxWallClockMinutes: 5, maxIterations: 10 },
      stopConditions: ["OOM persists", "throughput regresses"],
      reconsiderConditions: ["Retry when new evidence supports memory optimizations", "new hardware"],
      claimIds: proposalClaimIds,
    });

    teamOrchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-smoke",
      title: "Reduce memory spikes",
      summary: "Try a narrow batch-size adjustment and compare throughput.",
      targetModules: ["src/train.ts"],
      expectedGain: "Lower peak memory with stable throughput",
      expectedRisk: "Slight loss in convergence speed",
      codeChangeScope: ["src/train.ts"],
      status: "scoped_trial",
      experimentBudget: { maxWallClockMinutes: 5, maxIterations: 10 },
      stopConditions: ["OOM persists", "throughput regresses"],
      reconsiderConditions: ["Retry when new evidence supports memory optimizations", "new hardware"],
      claimIds: proposalClaimIds,
      scorecard,
    });

    const simulation = teamStore.createSimulationRun(session.id, "proposal-smoke", {
      experimentId: "sim-smoke",
      proposalId: "proposal-smoke",
      machineId: "local",
      command: "python train.py --batch-size 8",
      evaluationMetric: "val_bpb",
      patchScope: ["src/train.ts"],
      allowedChangeUnit: "single-file",
      budget: { maxWallClockMinutes: 5, maxIterations: 10 },
      rollbackPlan: "git checkout -- src/train.ts",
      description: "Smoke simulation",
    });
    const simulationResult = {
      experimentId: simulation.id,
      proposalId: "proposal-smoke",
      outcomeStatus: "budget_exceeded" as const,
      beforeMetrics: { val_bpb: 1.42 },
      afterMetrics: { val_bpb: 1.39 },
      resourceDelta: { peak_memory_gb: -0.4, cost_usd: 1.8 },
      surprisingFindings: ["Memory improved, but the trial exceeded the evaluation budget"],
      notes: "Budget exceeded before enough validation evidence was collected",
    };
    teamStore.updateSimulationRun(simulation.id, {
      status: simulationResult.outcomeStatus,
      result: simulationResult,
    });
    teamOrchestrator.recordSimulationResult(run.id, simulationResult);
    teamStore.saveExperimentLineage(session.id, {
      lineageId: `lineage-${simulation.id}`,
      proposalId: "proposal-smoke",
      experimentId: simulation.id,
      relatedExperimentId: "baseline-task",
      relationType: "baseline_of",
      summary: "Smoke lineage validation",
      createdAt: Date.now(),
    });

    teamOrchestrator.recordCollectionPack(run.id, candidatePack);

    const report = buildResearchReportInput(session.id, teamStore, sessionStore, {
      transcriptLimit: 20,
    });
    const briefing = contextGate.buildBriefing("Smoke checkpoint gist");
    const decisions = teamStore.listDecisionRecords(session.id);
    const lineage = teamStore.listExperimentLineage(session.id);
    const canonicalClaims = graphMemory.listNodesByKind("claim");
    const sourceClaims = graphMemory.listNodesByKind("source_claim");
    const workflowTransitions = teamStore.listWorkflowTransitions(session.id, run.id);
    const refreshedRun = teamStore.getTeamRun(run.id);
    const automationCheckpoints = teamStore.listAutomationCheckpoints(session.id, run.id);
    const improvementProposals = teamStore.listImprovementProposals(session.id, run.id);
    const improvementEvaluations = teamStore.listImprovementEvaluations(session.id, run.id);

    if (!report.includes("Proposal Briefs") || !report.includes("Simulation Runs")) {
      throw new Error("research report input is missing expected sections");
    }
    if (!report.includes("## Summary") || !report.includes("## Current Decision") || !report.includes("## Next Actions")) {
      throw new Error("phase 4 operator report sections are missing");
    }
    if (!report.includes("## Automation Status") || !report.includes("overnight-auto")) {
      throw new Error("phase 5 automation report section is missing");
    }
    if (!report.includes("## Self Improvement Proposals") || !report.includes("## Self Improvement Evaluations")) {
      throw new Error("phase 6 self-improvement report sections are missing");
    }
    if (!report.includes("Decision Records") || !report.includes("Experiment Ledger") || !report.includes("Ingestion Sources")) {
      throw new Error("research report input is missing decision, ledger, or ingestion sections");
    }
    if (!report.includes("Decision Drift") || !report.includes("Revisit Queue") || !report.includes("What Would Change This Decision")) {
      throw new Error("research report input is missing upgraded calibration or revisit reporting sections");
    }
    if (!briefing.includes("Graph context") || !briefing.includes("Team handoff state")) {
      throw new Error("checkpoint briefing is missing graph or handoff context");
    }
    if (decisions.length === 0 || lineage.length === 0) {
      throw new Error("decision layer or experiment lineage was not persisted");
    }
    if (!refreshedRun || refreshedRun.workflowState !== "revisit_due") {
      throw new Error("phase 3 workflow state did not advance to revisit_due");
    }
    if (workflowTransitions.length < 5) {
      throw new Error("phase 3 workflow transition history was not recorded");
    }
    if (!refreshedRun || refreshedRun.automationPolicy.mode !== "overnight-auto" || refreshedRun.automationState.retryCount !== 1 || refreshedRun.automationState.resumeCount !== 1) {
      throw new Error("phase 5 automation policy/runtime state was not persisted");
    }
    if (automationCheckpoints.length === 0) {
      throw new Error("phase 5 automation checkpoints were not recorded");
    }
    if (improvementProposals.length === 0 || improvementEvaluations.length === 0) {
      throw new Error("phase 6 self-improvement artifacts were not recorded");
    }
    if (!improvementProposals.some((proposal) => proposal.priorityScore > 0 && proposal.reviewStatus)) {
      throw new Error("phase 3 self-improvement prioritization was not recorded");
    }
    if (!report.includes("## Improvement Review Queue")) {
      throw new Error("phase 3 improvement review queue section is missing");
    }
    const nextActions = [
      ...teamStore.listRecentTeamRuns(session.id, 20).filter((item) => item.status === "active").map((item) => item.id),
      ...teamStore.listRevisitDueProposals(session.id).map((item) => item.proposalId),
    ];
    if (nextActions.length === 0) {
      throw new Error("phase 4 operator next actions could not be derived");
    }
    if (canonicalClaims.length === 0) {
      throw new Error("canonical claim layer did not persist any canonical claims");
    }
    if (canonicalClaims.length !== 2 || sourceClaims.length !== 3) {
      throw new Error("canonical claim merge behavior did not match expected source/canonical counts");
    }

    const storedSource = teamStore.listIngestionSources(session.id)[0];
    if (!storedSource || storedSource.claimCount !== 3 || storedSource.canonicalClaims?.length !== 2 || (storedSource.linkedProposalCount ?? 0) < 1) {
      throw new Error("ingestion source claim/proposal linkage metadata was not persisted");
    }

    const refreshedProposal = teamStore.listProposalBriefs(session.id).find((item) => item.proposalId === "proposal-smoke");
    if (!refreshedProposal || refreshedProposal.status !== "revisit_due") {
      throw new Error("proposal was not promoted to revisit_due after supporting ingestion evidence");
    }
    if (!refreshedProposal.claimSupport || refreshedProposal.claimSupport.evidenceStrength <= 0 || refreshedProposal.claimSupport.sourceCoverage <= 0) {
      throw new Error("phase 2 claim support summary was not attached to proposal briefs");
    }
    const refreshedTriggers = teamStore.listReconsiderationTriggers(session.id, "proposal-smoke");
    if (!refreshedTriggers.some((trigger) => /fresher evidence|contradiction pressure/i.test(trigger.triggerCondition))) {
      throw new Error("phase 2 integrity-aware reconsideration triggers were not created");
    }

    const budgetView = teamStore.listBudgetAnomalies(session.id);
    if (budgetView.length === 0) {
      throw new Error("budget anomaly operator view is empty");
    }

    process.stdout.write("research smoke passed\n");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
