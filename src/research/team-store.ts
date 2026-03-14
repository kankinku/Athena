import type {
  AutomationCheckpointRecord,
  BudgetAnomalyRecord,
  ClaimSupportSummary,
  DecisionRecord,
  ExperimentLineageRecord,
  ExperimentBudget,
  ExperimentCharter,
  ExperimentResult,
  IngestionSourceRecord,
  ImprovementEvaluationRecord,
  ImprovementReviewAction,
  ImprovementProposalRecord,
  ProposalReviewAction,
  ProposalBrief,
  ProposalScorecard,
  ReconsiderationTrigger,
  TeamRunRecord,
  WorkflowTransitionRecord,
} from "./contracts.js";
import { resolveCanonicalClaimReference } from "./claim-graph.js";
import {
  AutomationStore,
} from "./automation-store.js";
import {
  DecisionStore,
} from "./decision-store.js";
import {
  ImprovementStore,
} from "./improvement-store.js";
import {
  IngestionStore,
} from "./ingestion-store.js";
import {
  LineageStore,
} from "./lineage-store.js";
import {
  ProposalStore,
} from "./proposal-store.js";
import {
  SimulationStore,
  type SimulationRunRecord,
} from "./simulation-store.js";
import {
  TeamRunStore,
  type TeamRunUpdateInput,
} from "./team-run-store.js";
import {
  WorkflowStore,
} from "./workflow-store.js";
import {
  WorkflowAutomationService,
  type AutomationAction,
} from "./workflow-automation-service.js";

export type { SimulationRunRecord } from "./simulation-store.js";

export interface ReconsiderationTriggerRecord extends ReconsiderationTrigger {
  proposalId: string;
}

export class TeamStore {
  private automationStore = new AutomationStore();
  private decisionStore = new DecisionStore();
  private improvementStore = new ImprovementStore();
  private ingestionStore = new IngestionStore();
  private lineageStore = new LineageStore();
  private proposalStore = new ProposalStore();
  private simulationStore = new SimulationStore();
  private teamRunStore = new TeamRunStore();
  private workflowStore = new WorkflowStore();
  private workflowAutomationService = new WorkflowAutomationService(
    this.teamRunStore,
    this.workflowStore,
    this.automationStore,
  );

  createTeamRun(sessionId: string, goal: string, budget?: ExperimentBudget): TeamRunRecord {
    return this.teamRunStore.createTeamRun(sessionId, goal, budget);
  }

  getTeamRun(id: string): TeamRunRecord | null {
    return this.teamRunStore.getTeamRun(id);
  }

  updateTeamRun(id: string, updates: TeamRunUpdateInput): TeamRunRecord | null {
    return this.teamRunStore.updateTeamRun(id, updates);
  }

  transitionWorkflow(
    runId: string,
    toState: TeamRunRecord["workflowState"],
    reason: string,
    options: {
      rollbackOfTransitionId?: string;
      metadata?: Record<string, unknown>;
      currentStage?: TeamRunRecord["currentStage"];
    } = {},
  ): TeamRunRecord | null {
    return this.workflowAutomationService.transitionWorkflow(runId, toState, reason, options);
  }

  rollbackWorkflow(runId: string, reason: string): TeamRunRecord | null {
    return this.workflowAutomationService.rollbackWorkflow(runId, reason);
  }

  configureAutomation(
    runId: string,
    updates: Partial<Pick<TeamRunRecord, "automationPolicy" | "checkpointPolicy" | "retryPolicy" | "timeoutPolicy">>,
  ): TeamRunRecord | null {
    return this.workflowAutomationService.configureAutomation(runId, updates);
  }

  canAutomateAction(
    runId: string,
    action: AutomationAction,
  ): { ok: true; run: TeamRunRecord } | { ok: false; run: TeamRunRecord | null; reason: string } {
    return this.workflowAutomationService.canAutomateAction(runId, action);
  }

  noteAutomationBlock(runId: string, action: AutomationAction, reason: string): TeamRunRecord | null {
    return this.workflowAutomationService.noteAutomationBlock(runId, action, reason);
  }

  saveAutomationCheckpoint(sessionId: string, checkpoint: AutomationCheckpointRecord): AutomationCheckpointRecord {
    return this.automationStore.saveAutomationCheckpoint(sessionId, checkpoint);
  }

  listAutomationCheckpoints(sessionId: string, runId: string): AutomationCheckpointRecord[] {
    return this.automationStore.listAutomationCheckpoints(sessionId, runId);
  }

  saveImprovementProposal(sessionId: string, proposal: ImprovementProposalRecord): ImprovementProposalRecord {
    return this.improvementStore.saveImprovementProposal(sessionId, proposal);
  }

  listImprovementProposals(sessionId: string, runId?: string): ImprovementProposalRecord[] {
    return this.improvementStore.listImprovementProposals(sessionId, runId);
  }

  reviewImprovementProposal(
    sessionId: string,
    improvementId: string,
    action: ImprovementReviewAction,
  ): ImprovementProposalRecord {
    return this.improvementStore.reviewImprovementProposal(sessionId, improvementId, action);
  }

  saveImprovementEvaluation(sessionId: string, evaluation: ImprovementEvaluationRecord): ImprovementEvaluationRecord {
    return this.improvementStore.saveImprovementEvaluation(sessionId, evaluation);
  }

  listImprovementEvaluations(sessionId: string, runId?: string): ImprovementEvaluationRecord[] {
    return this.improvementStore.listImprovementEvaluations(sessionId, runId);
  }

  recordAutomationCheckpoint(runId: string, reason: string, snapshot?: Record<string, unknown>): AutomationCheckpointRecord | null {
    return this.workflowAutomationService.recordAutomationCheckpoint(runId, reason, snapshot);
  }

  resumeAutomation(runId: string, reason: string): TeamRunRecord | null {
    return this.workflowAutomationService.resumeAutomation(runId, reason);
  }

  recordAutomationRetry(runId: string, reason: string): TeamRunRecord | null {
    return this.workflowAutomationService.recordAutomationRetry(runId, reason);
  }

  saveWorkflowTransition(sessionId: string, transition: WorkflowTransitionRecord): WorkflowTransitionRecord {
    return this.workflowStore.saveWorkflowTransition(sessionId, transition);
  }

  listWorkflowTransitions(sessionId: string, runId: string): WorkflowTransitionRecord[] {
    return this.workflowStore.listWorkflowTransitions(sessionId, runId);
  }

  saveProposalBrief(sessionId: string, brief: ProposalBrief): ProposalBrief {
    return this.proposalStore.saveProposalBrief(sessionId, brief);
  }

  reviewProposalBrief(
    sessionId: string,
    proposalId: string,
    action: ProposalReviewAction,
  ): ProposalBrief {
    return this.proposalStore.reviewProposalBrief(sessionId, proposalId, action);
  }

  saveProposalScorecard(sessionId: string, scorecard: ProposalScorecard): ProposalScorecard {
    return this.proposalStore.saveProposalScorecard(sessionId, scorecard);
  }

  getProposalScorecard(proposalId: string): ProposalScorecard | null {
    return this.proposalStore.getProposalScorecard(proposalId);
  }

  listProposalBriefs(sessionId: string): ProposalBrief[] {
    return this.proposalStore.listProposalBriefs(sessionId);
  }

  saveDecisionRecord(sessionId: string, decision: DecisionRecord): DecisionRecord {
    return this.decisionStore.saveDecisionRecord(sessionId, decision);
  }

  listDecisionRecords(sessionId: string, proposalId?: string): DecisionRecord[] {
    return this.decisionStore.listDecisionRecords(sessionId, proposalId);
  }

  listDecisionRecordsByTag(sessionId: string, tag: string): DecisionRecord[] {
    return this.decisionStore.listDecisionRecordsByTag(sessionId, tag);
  }

  getLatestDecisionRecord(sessionId: string, proposalId: string): DecisionRecord | null {
    return this.decisionStore.getLatestDecisionRecord(sessionId, proposalId);
  }

  saveReconsiderationTrigger(sessionId: string, trigger: ReconsiderationTrigger): ReconsiderationTrigger {
    return this.decisionStore.saveReconsiderationTrigger(sessionId, trigger);
  }

  listReconsiderationTriggers(sessionId: string, proposalId?: string): ReconsiderationTrigger[] {
    return this.decisionStore.listReconsiderationTriggers(sessionId, proposalId);
  }

  listOpenReconsiderationTriggers(sessionId: string): ReconsiderationTriggerRecord[] {
    return this.decisionStore.listOpenReconsiderationTriggers(sessionId);
  }

  updateReconsiderationTrigger(
    sessionId: string,
    triggerId: string,
    updates: Partial<Pick<ReconsiderationTrigger, "status" | "evidenceLinks" | "satisfiedAt">>,
  ): ReconsiderationTrigger | null {
    return this.decisionStore.updateReconsiderationTrigger(sessionId, triggerId, updates);
  }

  saveExperimentLineage(sessionId: string, lineage: ExperimentLineageRecord): ExperimentLineageRecord {
    return this.lineageStore.saveExperimentLineage(sessionId, lineage);
  }

  listExperimentLineage(sessionId: string, proposalId?: string): ExperimentLineageRecord[] {
    return this.lineageStore.listExperimentLineage(sessionId, proposalId);
  }

  saveIngestionSource(sessionId: string, source: IngestionSourceRecord): IngestionSourceRecord {
    return this.ingestionStore.saveIngestionSource(sessionId, source);
  }

  listIngestionSources(sessionId: string): IngestionSourceRecord[] {
    return this.ingestionStore.listIngestionSources(sessionId);
  }

  getProposalBrief(sessionId: string, proposalId: string): ProposalBrief | null {
    return this.proposalStore.getProposalBrief(sessionId, proposalId);
  }

  summarizeClaims(sessionId: string, claimIds: string[]): ClaimSupportSummary {
    const normalizedIds = claimIds.map((claimId) => resolveCanonicalClaimReference(claimId));
    const canonicalClaims = this.listIngestionSources(sessionId)
      .flatMap((source) => source.canonicalClaims ?? [])
      .filter((claim) => normalizedIds.includes(resolveCanonicalClaimReference(claim.canonicalClaimId)));

    const evidenceStrength = average(canonicalClaims.map((claim) => claim.confidence));
    const freshnessScore = average(canonicalClaims.map((claim) => claim.freshnessScore));
    const contradictionPressure = average(canonicalClaims.map((claim) => {
      const contradictionCount = claim.contradictionTags.length;
      const supportCount = Math.max(1, claim.supportTags.length + claim.evidenceIds.length);
      return contradictionCount === 0 ? 0 : Math.min(1, contradictionCount / supportCount);
    }));
    const sourceCoverage = canonicalClaims.length === 0
      ? 0
      : average(canonicalClaims.map((claim) => Math.min(1, claim.sourceIds.length / 3)));

    return {
      claimIds: normalizedIds,
      sourceCoverage,
      evidenceStrength,
      freshnessScore,
      contradictionPressure,
      unresolvedClaims: normalizedIds.filter((claimId) => !canonicalClaims.some((claim) => resolveCanonicalClaimReference(claim.canonicalClaimId) === claimId)),
    };
  }

  updateProposalBrief(sessionId: string, proposalId: string, updates: Partial<ProposalBrief>): ProposalBrief | null {
    return this.proposalStore.updateProposalBrief(sessionId, proposalId, updates);
  }

  listRevisitDueProposals(sessionId: string): ProposalBrief[] {
    return this.proposalStore.listRevisitDueProposals(sessionId);
  }

  listBudgetAnomalies(sessionId: string): BudgetAnomalyRecord[] {
    const simulations = this.listRecentSimulationRuns(sessionId, 100);
    const decisions = this.listDecisionRecords(sessionId);
    return simulations
      .filter((simulation) => simulation.result?.outcomeStatus === "budget_exceeded")
      .map((simulation) => ({
        experimentId: simulation.id,
        proposalId: simulation.proposalId,
        decisionId: decisions.find((decision) => decision.simulationId === simulation.id)?.decisionId,
        findings: simulation.result?.surprisingFindings ?? [],
        notes: simulation.result?.notes,
        createdAt: simulation.updatedAt,
      }));
  }

  listRecentTeamRuns(sessionId: string, limit = 5): TeamRunRecord[] {
    return this.teamRunStore.listRecentTeamRuns(sessionId, limit);
  }

  listRecentSimulationRuns(sessionId: string, limit = 5): SimulationRunRecord[] {
    return this.simulationStore.listRecentSimulationRuns(sessionId, limit);
  }

  listRunningSimulationRuns(sessionId: string): SimulationRunRecord[] {
    return this.simulationStore.listRunningSimulationRuns(sessionId);
  }

  createSimulationRun(
    sessionId: string,
    proposalId: string,
    charter: ExperimentCharter,
  ): SimulationRunRecord {
    return this.simulationStore.createSimulationRun(sessionId, proposalId, charter);
  }

  updateSimulationRun(
    id: string,
    updates: {
      taskKey?: string;
      logPath?: string;
      status?: string;
      result?: ExperimentResult;
    },
  ): SimulationRunRecord | null {
    return this.simulationStore.updateSimulationRun(id, updates);
  }

  getSimulationRun(id: string): SimulationRunRecord | null {
    return this.simulationStore.getSimulationRun(id);
  }
}

function average(values: Array<number | undefined>): number {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
