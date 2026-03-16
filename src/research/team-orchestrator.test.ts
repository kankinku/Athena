import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../store/session-store.js";
import { closeDb } from "../store/database.js";
import { MemoryStore } from "../memory/memory-store.js";
import { GraphMemory } from "../memory/graph-memory.js";
import { TeamStore } from "./team-store.js";
import { TeamOrchestrator } from "./team-orchestrator.js";
import { createCandidatePackFromSource, createIngestionSource } from "./ingestion.js";

test("recordCollectionPack reopens a reported run when new evidence satisfies reconsideration triggers", () => {
  const home = mkdtempSync(join(tmpdir(), "athena-team-orchestrator-"));
  process.env.ATHENA_HOME = home;

  try {
    const sessionStore = new SessionStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const teamStore = new TeamStore();
    const teamOrchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);

    const run = teamOrchestrator.startRun("Reopen the loop when fresh evidence arrives");
    teamOrchestrator.configureAutomation(run.id, {
      automationPolicy: {
        mode: "overnight-auto",
        requireProposalApproval: false,
        requireExperimentApproval: false,
        requireRevisitApproval: true,
        maxAutoExperiments: 3,
      },
    });

    const ingestionSource = createIngestionSource({
      sourceType: "manual",
      title: "Reconsideration trigger source",
      notes: "fresh evidence arrives after the first report",
    });
    teamStore.saveIngestionSource(session.id, ingestionSource);

    const candidatePack = createCandidatePackFromSource({
      source: ingestionSource,
      problemArea: "loop recovery",
      claims: [
        {
          claimId: "claim-reopen",
          statement: "Fresh evidence can justify revisiting a rejected change.",
          confidence: 0.87,
          freshnessScore: 0.74,
          source: ingestionSource.title,
        },
      ],
      methods: ["Evidence Refresh"],
      counterEvidence: [],
      openQuestions: ["Should the loop reopen automatically or wait for approval?"],
    });
    const claimIds = candidatePack.canonicalClaims?.map((claim) => claim.canonicalClaimId) ?? [];

    teamOrchestrator.recordProposalBrief(run.id, {
      proposalId: "proposal-reopen",
      title: "Retry the rejected strategy with new evidence",
      summary: "Fresh evidence should move the run back into revisit handling.",
      targetModules: ["src/research/team-orchestrator.ts"],
      expectedGain: "The loop reopens instead of silently staying completed.",
      expectedRisk: "Operator approval may still be required before another iteration.",
      codeChangeScope: ["src/research/team-orchestrator.ts"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 5, maxIterations: 2 },
      stopConditions: ["No supporting evidence arrives"],
      reconsiderConditions: ["Retry when fresh evidence supports the proposal"],
      claimIds,
    });

    const simulation = teamStore.createSimulationRun(session.id, "proposal-reopen", {
      experimentId: "sim-reopen",
      proposalId: "proposal-reopen",
      machineId: "local",
      command: "npm test",
      evaluationMetric: "score",
      patchScope: ["src/research/team-orchestrator.ts"],
      allowedChangeUnit: "single-file",
      budget: { maxWallClockMinutes: 5, maxIterations: 2 },
      rollbackPlan: "git checkout -- src/research/team-orchestrator.ts",
      description: "revisit reopen test",
    });
    const simulationResult = {
      experimentId: simulation.id,
      proposalId: "proposal-reopen",
      outcomeStatus: "budget_exceeded" as const,
      beforeMetrics: { score: 0.6 },
      afterMetrics: { score: 0.62 },
      resourceDelta: {},
      surprisingFindings: ["Initial evaluation ended without enough evidence."],
      notes: "The proposal should reopen when new evidence arrives.",
    };
    teamStore.updateSimulationRun(simulation.id, {
      status: simulationResult.outcomeStatus,
      result: simulationResult,
    });
    teamOrchestrator.recordSimulationResult(run.id, simulationResult);

    teamOrchestrator.recordCollectionPack(run.id, candidatePack);

    const refreshedRun = teamStore.getTeamRun(run.id);
    assert.equal(refreshedRun?.workflowState, "revisit_due");
    assert.equal(refreshedRun?.status, "active");
    assert.equal(
      (refreshedRun?.latestOutput as { automationBlock?: { action?: string } } | undefined)?.automationBlock?.action,
      "revisit",
    );
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
