import type { GraphMemory } from "../memory/graph-memory.js";
import {
  buildDecisionDrift,
  buildProposalDecision,
  buildProposalScorecard,
  buildReconsiderationTriggers,
  buildResultDecision,
  evaluateReconsiderationTriggers,
} from "./decision-engine.js";
import { analyzeRunForImprovement } from "./improvement-engine.js";
import {
  buildCanonicalClaimPath,
  CLAIM_GRAPH_RELATIONSHIPS,
  resolveCanonicalClaimReference,
} from "./claim-graph.js";
import type {
  AutomationCheckpointRecord,
  AutomationPolicy,
  CheckpointPolicy,
  ExperimentLineageRecord,
  ExperimentBudget,
  ExperimentResult,
  IterationCycleRecord,
  IterationCycleReason,
  ProposalBrief,
  ResearchCandidatePack,
  RetryPolicy,
  TeamRunRecord,
  TeamRunStatus,
  TeamStage,
  TimeoutPolicy,
} from "./contracts.js";
import type { TeamStore } from "./team-store.js";

export class TeamOrchestrator {
  constructor(
    private teamStore: TeamStore,
    private graphMemory: GraphMemory,
    private sessionIdProvider: () => string,
  ) {}

  startRun(goal: string, budget?: ExperimentBudget): TeamRunRecord {
    return this.startRunForSession(this.sessionIdProvider(), goal, budget);
  }

  startRunForSession(sessionId: string, goal: string, budget?: ExperimentBudget): TeamRunRecord {
    const run = this.teamStore.createTeamRun(sessionId, goal, budget);
    this.teamStore.transitionWorkflow(run.id, "ready", "goal accepted for research planning");
    const activeRun = this.teamStore.transitionWorkflow(run.id, "running", "collection workflow started") ?? run;
    this.graphMemory.upsertNode({
      id: `/research/runs/${run.id}`,
      label: goal,
      gist: goal,
      kind: "note",
      content: JSON.stringify(activeRun, null, 2),
    });
    return activeRun;
  }

  recordCollectionPack(runId: string, pack: ResearchCandidatePack): TeamRunRecord | null {
    const run = this.teamStore.getTeamRun(runId);
    if (!run) return null;
    const subgraph = this.graphMemory.ingestCandidatePack(pack);
    const canonicalClaimRefs = new Set(
      (pack.canonicalClaims ?? []).map((claim) => buildCanonicalClaimPath(claim.canonicalClaimId)),
    );
    if (pack.sourceId) {
      const source = this.teamStore.listIngestionSources(run.sessionId).find((item) => item.sourceId === pack.sourceId);
      if (source) {
        this.teamStore.saveIngestionSource(run.sessionId, {
          ...source,
          status: "ingested",
          extractedCandidateId: pack.candidateId,
          claimCount: pack.claims.length,
          canonicalClaims: pack.canonicalClaims,
          freshnessScore: pack.freshnessScore,
          evidenceConfidence: pack.evidenceConfidence,
          methodTags: pack.normalizedMethods ?? pack.methods,
          extractedClaims: pack.claims,
          updatedAt: Date.now(),
        });
      }
    }

    for (const proposal of this.teamStore.listProposalBriefs(run.sessionId)) {
      const referencesKnownClaim = proposal.claimIds.some((claimId) => {
        const normalized = claimId.startsWith("/") ? claimId : buildCanonicalClaimPath(claimId);
        return canonicalClaimRefs.has(normalized);
      });
      if (!referencesKnownClaim) continue;
      const claimSupport = this.teamStore.summarizeClaims(run.sessionId, proposal.claimIds);
      const scorecard = buildProposalScorecard({
        ...proposal,
        claimSupport,
      });
      this.teamStore.saveProposalScorecard(run.sessionId, scorecard);
      this.teamStore.updateProposalBrief(run.sessionId, proposal.proposalId, {
        claimSupport,
        scorecard,
      });
    }

    const satisfiedTriggers = this.teamStore
      .listOpenReconsiderationTriggers(run.sessionId)
      .flatMap((trigger) => {
        const proposal = this.teamStore.getProposalBrief(run.sessionId, trigger.proposalId);
        return proposal
          ? evaluateReconsiderationTriggers([trigger], proposal, pack)
          : [];
      });

    for (const satisfied of satisfiedTriggers) {
      this.teamStore.updateReconsiderationTrigger(run.sessionId, satisfied.trigger.triggerId, {
        status: "revisit_due",
        satisfiedAt: Date.now(),
        evidenceLinks: satisfied.evidenceLinks,
      });
      const proposal = this.teamStore.getProposalBrief(run.sessionId, satisfied.trigger.proposalId);
      if (proposal) {
        const claimIds = Array.from(new Set([...proposal.claimIds, ...satisfied.evidenceLinks]));
        this.teamStore.updateProposalBrief(run.sessionId, proposal.proposalId, {
          status: "revisit_due",
          claimIds,
        });
        for (const claimId of satisfied.evidenceLinks) {
          this.graphMemory.link({
            sourceId: `/research/proposals/${proposal.proposalId}`,
            targetId: resolveCanonicalClaimReference(claimId),
            relationship: CLAIM_GRAPH_RELATIONSHIPS.revisitSupportedBy,
          });
        }
      }
      if (pack.sourceId) {
        const source = this.teamStore.listIngestionSources(run.sessionId).find((item) => item.sourceId === pack.sourceId);
        if (source) {
          this.teamStore.saveIngestionSource(run.sessionId, {
            ...source,
            linkedProposalCount: Math.max(1, source.linkedProposalCount ?? 0),
            updatedAt: Date.now(),
          });
        }
      }
    }

    this.graphMemory.link({
      sourceId: `/research/runs/${runId}`,
      targetId: `/research/candidates/${pack.candidateId}`,
      relationship: CLAIM_GRAPH_RELATIONSHIPS.collectionOutput,
    });
    if (run.workflowState === "running") {
      this.teamStore.transitionWorkflow(runId, "evaluating", "collection artifacts prepared for proposal evaluation", {
        currentStage: "planning",
        metadata: {
          candidateId: pack.candidateId,
        },
      });
    }
    return this.teamStore.updateTeamRun(runId, {
      latestOutput: {
        candidateId: pack.candidateId,
        subgraphNodeCount: subgraph.nodes.length,
        subgraphEdgeCount: subgraph.edges.length,
      },
    });
  }

  recordProposalBrief(runId: string, brief: ProposalBrief): TeamRunRecord | null {
    const run = this.teamStore.getTeamRun(runId);
    if (!run) return null;
    const claimSupport = this.teamStore.summarizeClaims(run.sessionId, brief.claimIds);
    const scorecard = buildProposalScorecard({
      ...brief,
      claimSupport,
    });
    const enrichedBrief: ProposalBrief = {
      ...brief,
      claimSupport,
      scorecard,
    };
    this.teamStore.saveProposalScorecard(run.sessionId, scorecard);
    const priorDecision = this.teamStore.getLatestDecisionRecord(run.sessionId, brief.proposalId);
    const decision = buildProposalDecision(enrichedBrief, "system:planning-board", priorDecision?.decisionId);
    this.teamStore.saveDecisionRecord(run.sessionId, decision);
    for (const trigger of buildReconsiderationTriggers(decision, enrichedBrief)) {
      this.teamStore.saveReconsiderationTrigger(run.sessionId, trigger);
    }
    this.teamStore.saveProposalBrief(run.sessionId, enrichedBrief);
    const proposalPath = `/research/proposals/${brief.proposalId}`;
    this.graphMemory.upsertNode({
      id: proposalPath,
      label: enrichedBrief.title,
      gist: enrichedBrief.summary,
      kind: "proposal",
      content: JSON.stringify(enrichedBrief, null, 2),
    });
    this.graphMemory.upsertNode({
      id: `/research/decisions/${decision.decisionId}`,
      label: decision.decisionType,
      gist: decision.decisionSummary,
      kind: "decision",
      content: JSON.stringify(decision, null, 2),
    });
    this.graphMemory.link({
      sourceId: `/research/runs/${runId}`,
      targetId: proposalPath,
      relationship: CLAIM_GRAPH_RELATIONSHIPS.planningOutput,
    });
    this.graphMemory.link({
      sourceId: proposalPath,
      targetId: `/research/decisions/${decision.decisionId}`,
      relationship: CLAIM_GRAPH_RELATIONSHIPS.evaluatedBy,
    });
    for (const claimId of enrichedBrief.claimIds) {
      this.graphMemory.link({
        sourceId: proposalPath,
        targetId: claimId.startsWith("/") ? claimId : buildCanonicalClaimPath(claimId),
        relationship: CLAIM_GRAPH_RELATIONSHIPS.derivedFrom,
      });
    }
    const proposalGate = this.teamStore.canAutomateAction(runId, "proposal");
    if (!proposalGate.ok) {
      const blockedRun = this.teamStore.noteAutomationBlock(runId, "proposal", proposalGate.reason);
      return this.teamStore.updateTeamRun(runId, {
        currentStage: "planning",
        latestOutput: {
          ...(blockedRun?.latestOutput ?? proposalGate.run?.latestOutput ?? {}),
          proposalId: enrichedBrief.proposalId,
          proposalStatus: enrichedBrief.status,
          decisionId: decision.decisionId,
          decisionType: decision.decisionType,
        },
      });
    }
    const autonomyPolicy = run.automationPolicy.mode === "fully-autonomous"
      ? run.automationPolicy.autonomyPolicy
      : undefined;
    if (
      autonomyPolicy?.requireEvidenceFloor !== undefined
      && claimSupport.evidenceStrength < autonomyPolicy.requireEvidenceFloor
    ) {
      const blockedRun = this.teamStore.noteAutomationBlock(
        runId,
        "experiment",
        `proposal evidence floor ${claimSupport.evidenceStrength.toFixed(2)} is below autonomous requirement ${autonomyPolicy.requireEvidenceFloor.toFixed(2)}`,
      );
      return this.teamStore.updateTeamRun(runId, {
        currentStage: "planning",
        latestOutput: {
          ...(blockedRun?.latestOutput ?? run.latestOutput ?? {}),
          proposalId: enrichedBrief.proposalId,
          proposalStatus: "candidate",
          decisionId: decision.decisionId,
          decisionType: decision.decisionType,
        },
      });
    }
    if (
      run.automationPolicy.mode === "fully-autonomous"
      && decision.decisionType !== "trial"
    ) {
      const blockedRun = this.teamStore.noteAutomationBlock(
        runId,
        "experiment",
        `proposal decision ${decision.decisionType} does not authorize autonomous experiment execution`,
      );
      return this.teamStore.updateTeamRun(runId, {
        currentStage: "planning",
        latestOutput: {
          ...(blockedRun?.latestOutput ?? run.latestOutput ?? {}),
          proposalId: enrichedBrief.proposalId,
          proposalStatus: enrichedBrief.status,
          decisionId: decision.decisionId,
          decisionType: decision.decisionType,
        },
      });
    }
    const experimentGate = this.teamStore.canAutomateAction(runId, "experiment");
    if (!experimentGate.ok) {
      const blockedRun = this.teamStore.noteAutomationBlock(runId, "experiment", experimentGate.reason);
      return this.teamStore.updateTeamRun(runId, {
        currentStage: "planning",
        latestOutput: {
          ...(blockedRun?.latestOutput ?? experimentGate.run?.latestOutput ?? {}),
          proposalId: enrichedBrief.proposalId,
          proposalStatus: "ready_for_experiment",
          decisionId: decision.decisionId,
          decisionType: decision.decisionType,
        },
      });
    }
    this.teamStore.transitionWorkflow(runId, "running", "proposal approved for experiment execution", {
      currentStage: "simulation",
      metadata: {
        proposalId: enrichedBrief.proposalId,
      },
    });
    return this.teamStore.updateTeamRun(runId, {
      latestOutput: {
        proposalId: enrichedBrief.proposalId,
        proposalStatus: enrichedBrief.status,
        decisionId: decision.decisionId,
        decisionType: decision.decisionType,
      },
    });
  }

  recordSimulationResult(runId: string, result: ExperimentResult): TeamRunRecord | null {
    const run = this.teamStore.getTeamRun(runId);
    if (!run) return null;
    const nextStatus: TeamRunStatus = result.outcomeStatus === "crash" ? "failed" : "completed";
    const resultPath = `/research/results/${result.experimentId}`;
    this.graphMemory.upsertNode({
      id: resultPath,
      label: result.experimentId,
      gist: result.outcomeStatus,
      kind: "result",
      content: JSON.stringify(result, null, 2),
    });
    this.graphMemory.link({
      sourceId: `/research/runs/${runId}`,
      targetId: resultPath,
      relationship: CLAIM_GRAPH_RELATIONSHIPS.simulationOutput,
    });
    this.graphMemory.link({
      sourceId: `/research/proposals/${result.proposalId}`,
      targetId: resultPath,
      relationship: CLAIM_GRAPH_RELATIONSHIPS.validatedBy,
    });
    const latestDecision = this.teamStore.getLatestDecisionRecord(run.sessionId, result.proposalId);
    const proposal = this.teamStore.listProposalBriefs(run.sessionId).find((item) => item.proposalId === result.proposalId);
    const enrichedResult: ExperimentResult = {
      ...result,
      guardrailTrialRecommended:
        result.outcomeStatus !== "keep"
        && Object.values(result.afterMetrics).some((value, index) => {
          const before = Object.values(result.beforeMetrics)[index];
          return typeof before === "number" ? value < before : false;
        }),
    };
    const decision = buildResultDecision(enrichedResult, {
      proposalTitle: proposal?.title,
      createdBy: "system:simulation-review",
      evidenceLinks: proposal?.claimIds,
      supersedesDecisionId: latestDecision?.decisionId,
    });
    decision.drift = buildDecisionDrift(latestDecision ?? undefined, decision, proposal?.scorecard);
    decision.calibration = {
      weightedScore: proposal?.scorecard?.weightedScore,
      outcomeStatus: enrichedResult.outcomeStatus,
      falsePositive: proposal?.scorecard !== undefined
        ? proposal.scorecard.weightedScore >= 0.7 && enrichedResult.outcomeStatus !== "keep"
        : undefined,
      falseNegative: proposal?.scorecard !== undefined
        ? proposal.scorecard.weightedScore < 0.62 && enrichedResult.outcomeStatus === "keep"
        : undefined,
    };
    this.teamStore.saveDecisionRecord(run.sessionId, decision);
    const simulationRun = this.teamStore.getSimulationRun(result.experimentId);
    const improvement = analyzeRunForImprovement({
      runId,
      proposal,
      result: enrichedResult,
      decision,
      rollbackPlan: simulationRun?.charter.rollbackPlan,
    });
    if (improvement.proposal) {
      this.teamStore.saveImprovementProposal(run.sessionId, improvement.proposal);
    }
    this.teamStore.saveImprovementEvaluation(run.sessionId, improvement.evaluation);
    if (proposal) {
      const nextStatus = decision.decisionType === "revisit"
        ? "revisit_when"
        : decision.decisionType === "adopt"
          ? "ready_for_experiment"
          : proposal.status;
      this.teamStore.updateProposalBrief(run.sessionId, proposal.proposalId, {
        status: nextStatus,
      });
      for (const trigger of buildReconsiderationTriggers(decision, proposal)) {
        this.teamStore.saveReconsiderationTrigger(run.sessionId, trigger);
      }
    }
    const lineage: ExperimentLineageRecord = {
      lineageId: `${result.proposalId}-${result.experimentId}-validated`,
      proposalId: result.proposalId,
      experimentId: result.experimentId,
      relatedExperimentId: result.taskId,
      relationType: "validated_by",
      summary: `Experiment ${result.experimentId} produced outcome ${result.outcomeStatus}`,
      createdAt: Date.now(),
      supersededByExperimentId: result.outcomeStatus === "superseded" ? latestDecision?.simulationId : undefined,
    };
    this.teamStore.saveExperimentLineage(run.sessionId, lineage);
    this.graphMemory.upsertNode({
      id: `/research/decisions/${decision.decisionId}`,
      label: decision.decisionType,
      gist: decision.decisionSummary,
      kind: "decision",
      content: JSON.stringify(decision, null, 2),
    });
    this.graphMemory.link({
      sourceId: `/research/proposals/${result.proposalId}`,
      targetId: `/research/decisions/${decision.decisionId}`,
      relationship: CLAIM_GRAPH_RELATIONSHIPS.decisionRecord,
    });
    this.graphMemory.link({
      sourceId: resultPath,
      targetId: `/research/decisions/${decision.decisionId}`,
      relationship: CLAIM_GRAPH_RELATIONSHIPS.decisionOutput,
    });
    this.teamStore.transitionWorkflow(runId, "evaluating", "simulation completed and decision evaluation is running", {
      metadata: {
        experimentId: result.experimentId,
      },
    });
    const continuationAction = decision.decisionType === "revisit" ? "revisit" : "resume";
    const continuationGate = this.teamStore.canAutomateAction(runId, continuationAction);
    if (!continuationGate.ok) {
      const blockedRun = this.teamStore.noteAutomationBlock(runId, continuationAction, continuationGate.reason);
      if (continuationAction === "revisit") {
        this.teamStore.transitionWorkflow(runId, "reported", continuationGate.reason, {
          currentStage: "reporting",
          metadata: {
            experimentId: result.experimentId,
            outcomeStatus: result.outcomeStatus,
            decisionId: decision.decisionId,
          },
        });
        return this.teamStore.updateTeamRun(runId, {
          status: "completed",
          latestOutput: {
            ...(blockedRun?.latestOutput ?? continuationGate.run?.latestOutput ?? {}),
            experimentId: result.experimentId,
            proposalId: result.proposalId,
            outcomeStatus: result.outcomeStatus,
            decisionId: decision.decisionId,
          },
        });
      }
      this.teamStore.transitionWorkflow(runId, "failed", continuationGate.reason, {
        currentStage: "reporting",
        metadata: {
          experimentId: result.experimentId,
          outcomeStatus: result.outcomeStatus,
        },
      });
      return this.teamStore.updateTeamRun(runId, {
        status: "failed",
        latestOutput: {
          ...(blockedRun?.latestOutput ?? continuationGate.run?.latestOutput ?? {}),
          experimentId: result.experimentId,
          proposalId: result.proposalId,
          outcomeStatus: result.outcomeStatus,
          decisionId: decision.decisionId,
        },
      });
    }
    this.teamStore.transitionWorkflow(
      runId,
      decision.decisionType === "revisit" ? "revisit_due" : nextStatus === "failed" ? "failed" : "reported",
      decision.decisionType === "revisit"
        ? "evaluation requested revisit based on experiment outcome"
        : nextStatus === "failed"
          ? "simulation failed during workflow execution"
          : "evaluation completed and report is ready",
      {
        currentStage: "reporting",
        metadata: {
          experimentId: result.experimentId,
          outcomeStatus: result.outcomeStatus,
          decisionId: decision.decisionId,
        },
      },
    );

    // Auto-cascade iteration when decision is revisit and automation allows it
    if (decision.decisionType === "revisit") {
      const cascadeResult = this.cascadeIteration(runId, {
        reason: "simulation_regression",
        reasonDetail: `simulation ${result.experimentId} outcome=${result.outcomeStatus} triggered revisit`,
        proposalId: result.proposalId,
        evidenceLinks: proposal?.claimIds,
      });
      if (cascadeResult && cascadeResult.workflowState === "running") {
        return cascadeResult;
      }
    }

    return this.teamStore.updateTeamRun(runId, {
      status: nextStatus,
      latestOutput: {
        experimentId: result.experimentId,
        outcomeStatus: result.outcomeStatus,
        decisionId: decision.decisionId,
        decisionType: decision.decisionType,
      },
    });
  }

  advanceStage(runId: string, stage: TeamStage, status?: TeamRunStatus): TeamRunRecord | null {
    return this.teamStore.updateTeamRun(runId, {
      currentStage: stage,
      status,
    });
  }

  rollbackRun(runId: string, reason: string): TeamRunRecord | null {
    const rolledBack = this.teamStore.rollbackWorkflow(runId, reason);
    if (rolledBack) {
      this.teamStore.recordAutomationCheckpoint(runId, "rollback", {
        reason,
        workflowState: rolledBack.workflowState,
        stage: rolledBack.currentStage,
      });
    }
    return rolledBack;
  }

  /**
   * Cascade an iteration: transition a run from revisit_due back to the
   * collection stage, incrementing the iteration counter and recording
   * an IterationCycleRecord for audit/reporting.
   */
  cascadeIteration(
    runId: string,
    options: {
      reason: IterationCycleReason;
      reasonDetail: string;
      proposalId?: string;
      triggerId?: string;
      evidenceLinks?: string[];
    },
  ): TeamRunRecord | null {
    const run = this.teamStore.getTeamRun(runId);
    if (!run) return null;
    if (run.workflowState !== "revisit_due") return null;

    const maxIterations = run.budget?.maxIterations ?? 10;
    if (run.iterationCount >= maxIterations) {
      this.teamStore.noteAutomationBlock(
        runId,
        "revisit",
        `iteration limit reached (${run.iterationCount}/${maxIterations})`,
      );
      return run;
    }

    const nextIteration = run.iterationCount + 1;
    const sessionId = run.sessionId;

    const cycle: IterationCycleRecord = {
      cycleId: `iter-${runId}-${nextIteration}`,
      runId,
      sessionId,
      iterationIndex: nextIteration,
      entryState: run.workflowState,
      exitState: "approved",
      reason: options.reason,
      reasonDetail: options.reasonDetail,
      proposalId: options.proposalId,
      triggerId: options.triggerId,
      evidenceLinks: options.evidenceLinks ?? [],
      createdAt: Date.now(),
    };
    this.teamStore.saveIterationCycle(sessionId, cycle);

    this.teamStore.transitionWorkflow(runId, "approved", `iteration cascade #${nextIteration}: ${options.reasonDetail}`, {
      metadata: {
        iterationIndex: nextIteration,
        reason: options.reason,
        proposalId: options.proposalId,
        triggerId: options.triggerId,
      },
    });

    this.teamStore.transitionWorkflow(runId, "running", `iteration #${nextIteration} started — re-entering collection`, {
      currentStage: "collection",
      metadata: { iterationIndex: nextIteration },
    });

    const updated = this.teamStore.updateTeamRun(runId, {
      iterationCount: nextIteration,
      status: "active",
      latestOutput: {
        ...(run.latestOutput ?? {}),
        iterationIndex: nextIteration,
        iterationReason: options.reason,
      },
    });

    this.graphMemory.upsertNode({
      id: `/research/runs/${runId}`,
      label: run.goal,
      gist: `iteration #${nextIteration}: ${options.reasonDetail}`,
      kind: "note",
      content: JSON.stringify(updated, null, 2),
    });

    return updated;
  }

  configureAutomation(
    runId: string,
    updates: Partial<{
      automationPolicy: AutomationPolicy;
      checkpointPolicy: CheckpointPolicy;
      retryPolicy: RetryPolicy;
      timeoutPolicy: TimeoutPolicy;
    }>,
  ): TeamRunRecord | null {
    return this.teamStore.configureAutomation(runId, updates);
  }

  checkpointRun(runId: string, reason: string, snapshot?: Record<string, unknown>): AutomationCheckpointRecord | null {
    return this.teamStore.recordAutomationCheckpoint(runId, reason, snapshot);
  }

  resumeRunAutomation(runId: string, reason: string): TeamRunRecord | null {
    return this.teamStore.resumeAutomation(runId, reason);
  }

  retryRunAutomation(runId: string, reason: string): TeamRunRecord | null {
    return this.teamStore.recordAutomationRetry(runId, reason);
  }

  getRun(runId: string): TeamRunRecord | null {
    return this.teamStore.getTeamRun(runId);
  }

  buildHandoffContext(runId: string, nextStage?: TeamStage): string | null {
    const run = this.teamStore.getTeamRun(runId);
    if (!run) return null;
    const proposals = this.teamStore.listProposalBriefs(run.sessionId).slice(0, 3);
    const simulations = this.teamStore.listRecentSimulationRuns(run.sessionId, 3);
    const decisions = this.teamStore.listDecisionRecords(run.sessionId).slice(0, 3);
    const graphText = this.graphMemory.formatSubgraph([
      `/research/runs/${run.id}`,
      ...proposals.map((proposal) => `/research/proposals/${proposal.proposalId}`),
    ], 1, 12);

    const lines = [
      `Run: ${run.id}`,
      `Goal: ${run.goal}`,
      `Current stage: ${run.currentStage}`,
      `Next stage: ${nextStage ?? run.currentStage}`,
      `Status: ${run.status}`,
      `Workflow state: ${run.workflowState}`,
    ];

    const workflowHistory = this.teamStore.listWorkflowTransitions(run.sessionId, run.id).slice(-5);
    if (workflowHistory.length > 0) {
      lines.push(
        "Workflow history:",
        ...workflowHistory.map((entry) => `- ${entry.fromState} -> ${entry.toState}: ${entry.reason}`),
      );
    }

    if (proposals.length > 0) {
      lines.push(
        "Proposals:",
        ...proposals.map(
          (proposal) =>
            `- ${proposal.proposalId}: ${proposal.title} [${proposal.status}] gain=${proposal.expectedGain} risk=${proposal.expectedRisk}`,
        ),
      );
    }

    if (simulations.length > 0) {
      lines.push(
        "Recent simulations:",
        ...simulations.map(
          (simulation) =>
            `- ${simulation.id}: proposal=${simulation.proposalId} status=${simulation.status} task=${simulation.taskKey ?? "n/a"}`,
        ),
      );
    }

    if (decisions.length > 0) {
      lines.push(
        "Recent decisions:",
        ...decisions.map(
          (decision) =>
            `- ${decision.decisionId}: ${decision.decisionType} proposal=${decision.proposalId} reasons=${decision.reasonTags.join(",")}`,
        ),
      );
    }

    lines.push("Graph context:", graphText);
    return lines.join("\n");
  }
}
