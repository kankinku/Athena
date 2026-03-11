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
      claimIds: [],
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
      claimIds: [],
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
    teamOrchestrator.recordCollectionPack(run.id, candidatePack);

    const report = buildResearchReportInput(session.id, teamStore, sessionStore, {
      transcriptLimit: 20,
    });
    const briefing = contextGate.buildBriefing("Smoke checkpoint gist");
    const decisions = teamStore.listDecisionRecords(session.id);
    const lineage = teamStore.listExperimentLineage(session.id);

    if (!report.includes("Proposal Briefs") || !report.includes("Simulation Runs")) {
      throw new Error("research report input is missing expected sections");
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

    const storedSource = teamStore.listIngestionSources(session.id)[0];
    if (!storedSource || storedSource.claimCount !== 2 || (storedSource.linkedProposalCount ?? 0) < 1) {
      throw new Error("ingestion source claim/proposal linkage metadata was not persisted");
    }

    const refreshedProposal = teamStore.listProposalBriefs(session.id).find((item) => item.proposalId === "proposal-smoke");
    if (!refreshedProposal || refreshedProposal.status !== "revisit_due") {
      throw new Error("proposal was not promoted to revisit_due after supporting ingestion evidence");
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
