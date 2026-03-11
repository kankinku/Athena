import type { GraphMemory } from "../memory/graph-memory.js";
import {
  buildDecisionDrift,
  buildProposalDecision,
  buildProposalScorecard,
  buildReconsiderationTriggers,
  buildResultDecision,
  evaluateReconsiderationTriggers,
} from "./decision-engine.js";
import type {
  ExperimentLineageRecord,
  ExperimentBudget,
  ExperimentResult,
  ProposalBrief,
  ResearchCandidatePack,
  TeamRunRecord,
  TeamRunStatus,
  TeamStage,
} from "./contracts.js";
import type { TeamStore } from "./team-store.js";

export class TeamOrchestrator {
  constructor(
    private teamStore: TeamStore,
    private graphMemory: GraphMemory,
    private sessionIdProvider: () => string,
  ) {}

  startRun(goal: string, budget?: ExperimentBudget): TeamRunRecord {
    const run = this.teamStore.createTeamRun(this.sessionIdProvider(), goal, budget);
    this.graphMemory.upsertNode({
      id: `/research/runs/${run.id}`,
      label: goal,
      gist: goal,
      kind: "note",
      content: JSON.stringify(run, null, 2),
    });
    return run;
  }

  recordCollectionPack(runId: string, pack: ResearchCandidatePack): TeamRunRecord | null {
    const run = this.teamStore.getTeamRun(runId);
    if (!run) return null;
    const subgraph = this.graphMemory.ingestCandidatePack(pack);
    if (pack.sourceId) {
      const source = this.teamStore.listIngestionSources(run.sessionId).find((item) => item.sourceId === pack.sourceId);
      if (source) {
        this.teamStore.saveIngestionSource(run.sessionId, {
          ...source,
          status: "ingested",
          extractedCandidateId: pack.candidateId,
          claimCount: pack.claims.length,
          freshnessScore: pack.freshnessScore,
          evidenceConfidence: pack.evidenceConfidence,
          methodTags: pack.normalizedMethods ?? pack.methods,
          extractedClaims: pack.claims,
          updatedAt: Date.now(),
        });
      }
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
            targetId: `/research/candidates/${pack.candidateId}/claims/${claimId}`,
            relationship: "revisit_supported_by",
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
      relationship: "collection_output",
    });
    return this.teamStore.updateTeamRun(runId, {
      currentStage: "planning",
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
    const scorecard = buildProposalScorecard(brief);
    const enrichedBrief: ProposalBrief = {
      ...brief,
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
      relationship: "planning_output",
    });
    this.graphMemory.link({
      sourceId: proposalPath,
      targetId: `/research/decisions/${decision.decisionId}`,
      relationship: "evaluated_by",
    });
    for (const claimId of enrichedBrief.claimIds) {
      this.graphMemory.link({
        sourceId: proposalPath,
        targetId: claimId,
        relationship: "derived_from",
      });
    }
    return this.teamStore.updateTeamRun(runId, {
      currentStage: "simulation",
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
      relationship: "simulation_output",
    });
    this.graphMemory.link({
      sourceId: `/research/proposals/${result.proposalId}`,
      targetId: resultPath,
      relationship: "validated_by",
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
      relationship: "decision_record",
    });
    this.graphMemory.link({
      sourceId: resultPath,
      targetId: `/research/decisions/${decision.decisionId}`,
      relationship: "decision_output",
    });
    return this.teamStore.updateTeamRun(runId, {
      currentStage: "reporting",
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
    ];

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
