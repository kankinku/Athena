import type {
  ActionJournalRecord,
  AutomationCheckpointRecord,
  BudgetAnomalyRecord,
  ClaimSupportSummary,
  DecisionRecord,
  EvidenceHealthSummary,
  ExperimentLineageRecord,
  ExperimentBudget,
  ExperimentCharter,
  ExperimentResult,
  IngestionSourceRecord,
  IncidentRecord,
  ImprovementEvaluationRecord,
  ImprovementReviewAction,
  ImprovementProposalRecord,
  ProposalReviewAction,
  ProposalBrief,
  ProposalScorecard,
  ReconsiderationTrigger,
  ReviewQueueEntry,
  RunLeaseRecord,
  TeamRunRecord,
  WorkflowTransitionRecord,
} from "./contracts.js";
import { resolveCanonicalClaimReference } from "./claim-graph.js";
import {
  ActionJournalStore,
} from "./action-journal-store.js";
import {
  AutomationStore,
} from "./automation-store.js";
import {
  DecisionStore,
} from "./decision-store.js";
import {
  IncidentStore,
} from "./incident-store.js";
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
  RunLeaseStore,
} from "./run-lease-store.js";
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
  private actionJournalStore = new ActionJournalStore();
  private automationStore = new AutomationStore();
  private decisionStore = new DecisionStore();
  private incidentStore = new IncidentStore();
  private improvementStore = new ImprovementStore();
  private ingestionStore = new IngestionStore();
  private lineageStore = new LineageStore();
  private proposalStore = new ProposalStore();
  private runLeaseStore = new RunLeaseStore();
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

  getTeamRunForSession(sessionId: string, runId: string): TeamRunRecord | null {
    const run = this.teamRunStore.getTeamRun(runId);
    return run?.sessionId === sessionId ? run : null;
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
    const blocked = this.workflowAutomationService.noteAutomationBlock(runId, action, reason);
    if (blocked) {
      this.saveIncident({
        incidentId: `incident-${runId}-${action}-${Date.now()}`,
        sessionId: blocked.sessionId,
        runId,
        type: action === "resume" ? "recovery_needed" : "automation_block",
        severity: action === "retry" || action === "resume" ? "critical" : "warning",
        summary: `Automation blocked for ${action}`,
        details: reason,
        status: "open",
        actionRequired: true,
        metadata: { action, workflowState: blocked.workflowState, stage: blocked.currentStage },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return blocked;
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

  saveActionJournal(action: ActionJournalRecord): ActionJournalRecord {
    return this.actionJournalStore.saveAction(action);
  }

  listActionJournal(sessionId: string, runId?: string): ActionJournalRecord[] {
    return runId
      ? this.actionJournalStore.listRunActions(sessionId, runId)
      : this.actionJournalStore.listSessionActions(sessionId);
  }

  getActionJournalByDedupeKey(sessionId: string, runId: string, dedupeKey: string): ActionJournalRecord | null {
    return this.actionJournalStore.getActionByDedupeKey(sessionId, runId, dedupeKey);
  }

  acquireRunLease(sessionId: string, runId: string, ownerId: string, ttlMs?: number): RunLeaseRecord | null {
    return this.runLeaseStore.acquireLease(sessionId, runId, ownerId, ttlMs);
  }

  heartbeatRunLease(runId: string, ownerId: string, ttlMs?: number): RunLeaseRecord | null {
    return this.runLeaseStore.heartbeatLease(runId, ownerId, ttlMs);
  }

  releaseRunLease(runId: string, ownerId?: string): RunLeaseRecord | null {
    return this.runLeaseStore.releaseLease(runId, ownerId);
  }

  listActiveRunLeases(sessionId: string): RunLeaseRecord[] {
    return this.runLeaseStore.listActiveLeases(sessionId);
  }

  saveIncident(incident: IncidentRecord): IncidentRecord {
    return this.incidentStore.saveIncident(incident);
  }

  listIncidents(sessionId: string, runId?: string): IncidentRecord[] {
    return this.incidentStore.listIncidents(sessionId, runId);
  }

  listOpenIncidents(sessionId: string): IncidentRecord[] {
    return this.incidentStore.listOpenIncidents(sessionId);
  }

  resolveRunIncidents(sessionId: string, runId: string): number {
    return this.incidentStore.resolveRunIncidents(sessionId, runId);
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

  buildEvidenceHealth(sessionId: string, proposalId?: string): EvidenceHealthSummary {
    const allSources = this.listIngestionSources(sessionId);
    const relevantClaims = proposalId
      ? this.getProposalBrief(sessionId, proposalId)?.claimIds ?? []
      : allSources.flatMap((source) => source.canonicalClaims?.map((claim) => resolveCanonicalClaimReference(claim.canonicalClaimId)) ?? []);
    const relevantClaimSet = new Set(relevantClaims.map((claimId) => resolveCanonicalClaimReference(claimId)));
    const sources = proposalId
      ? allSources.filter((source) => (source.canonicalClaims ?? []).some((claim) => relevantClaimSet.has(resolveCanonicalClaimReference(claim.canonicalClaimId))))
      : allSources;
    const claimSupport = this.summarizeClaims(sessionId, relevantClaims);
    const canonicalClaims = sources
      .flatMap((source) => source.canonicalClaims ?? [])
      .filter((claim) => !proposalId || relevantClaimSet.has(resolveCanonicalClaimReference(claim.canonicalClaimId)));
    const contradictionCount = canonicalClaims.reduce((sum, claim) => sum + (claim.contradictionCount ?? claim.contradictionTags.length), 0);
    const modelConfidence = average(canonicalClaims.map((claim) => claim.confidence));
    const coverageGaps = [
      ...(claimSupport.unresolvedClaims.length > 0 ? [`unresolved_claims=${claimSupport.unresolvedClaims.length}`] : []),
      ...(claimSupport.sourceCoverage < 0.5 ? ["low_source_coverage"] : []),
      ...(claimSupport.contradictionPressure > 0.35 ? ["high_contradiction_pressure"] : []),
      ...(claimSupport.freshnessScore < 0.45 ? ["stale_evidence"] : []),
    ];

    return {
      sourceCount: sources.length,
      claimCount: proposalId ? canonicalClaims.length : sources.reduce((sum, source) => sum + (source.claimCount ?? 0), 0),
      canonicalClaimCount: canonicalClaims.length,
      contradictionCount,
      uncoveredClaimCount: claimSupport.unresolvedClaims.length,
      freshnessScore: claimSupport.freshnessScore,
      evidenceStrength: claimSupport.evidenceStrength,
      modelConfidence,
      confidenceSeparation: Number(Math.abs(modelConfidence - claimSupport.evidenceStrength).toFixed(2)),
      coverageGaps,
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

  listReviewQueue(sessionId: string): ReviewQueueEntry[] {
    const proposals = this.listProposalBriefs(sessionId);
    const improvements = this.listImprovementProposals(sessionId);
    const runs = this.listRecentTeamRuns(sessionId, 50);
    const incidents = this.listOpenIncidents(sessionId);
    const simulations = this.listRecentSimulationRuns(sessionId, 50);
    const rollbackHandledRunIds = new Set(
      runs
        .filter((run) =>
          run.workflowState === "archived"
          || this.listActionJournal(sessionId, run.id).some((action) => action.actionType === "operator_rollback"),
        )
        .map((run) => run.id),
    );

    const entries: ReviewQueueEntry[] = [
      ...proposals
        .filter((proposal) => proposal.status === "candidate")
        .map((proposal) => ({
          id: `proposal:${proposal.proposalId}`,
          kind: "approval_needed" as const,
          proposalId: proposal.proposalId,
          priority: 80,
          status: proposal.status,
          summary: proposal.title,
          actionHint: `athena research operate ${proposal.proposalId} --kind proposal --action approve`,
        })),
      ...proposals
        .filter((proposal) => proposal.status === "revisit_due")
        .map((proposal) => ({
          id: `revisit:${proposal.proposalId}`,
          kind: "revisit_due" as const,
          proposalId: proposal.proposalId,
          priority: 75,
          status: proposal.status,
          summary: proposal.title,
          actionHint: `athena research operate ${proposal.proposalId} --kind proposal --action revisit`,
        })),
      ...improvements
        .filter((proposal) => proposal.reviewStatus === "queued")
        .map((proposal) => ({
          id: `improvement:${proposal.improvementId}`,
          kind: "approval_needed" as const,
          runId: proposal.runId,
          priority: 60,
          status: proposal.reviewStatus,
          summary: proposal.title,
          actionHint: `athena research operate ${proposal.improvementId} --kind improvement --action promote`,
        })),
      ...runs
        .flatMap((run) => {
          const block = (run.latestOutput as { automationBlock?: { reason?: string } } | undefined)?.automationBlock;
          return block ? [{
            id: `blocked:${run.id}`,
            kind: "blocked" as const,
            runId: run.id,
            priority: 90,
            status: run.workflowState,
            summary: block.reason ?? "automation blocked",
            actionHint: "resume or rollback",
          }] : [];
        }),
      ...incidents.map((incident) => ({
        id: `incident:${incident.incidentId}`,
        kind: (incident.type === "rollback_candidate" ? "rollback_candidate" : "recovery_needed") as ReviewQueueEntry["kind"],
        runId: incident.runId,
        proposalId: incident.proposalId,
        experimentId: incident.experimentId,
        priority: incident.severity === "critical" ? 100 : 70,
        status: incident.status,
        summary: incident.summary,
        actionHint: incident.type === "rollback_candidate" ? "rollback or archive" : "resume or inspect",
      })),
      ...simulations
        .filter((simulation) => simulation.result?.guardrailTrialRecommended || simulation.result?.outcomeStatus === "budget_exceeded")
        .flatMap((simulation) => {
          const runId = runs.find((run) => (run.latestOutput as { proposalId?: string } | undefined)?.proposalId === simulation.proposalId)?.id;
          if (runId && rollbackHandledRunIds.has(runId)) {
            return [];
          }
          return [{
            id: `rollback:${simulation.id}`,
            kind: "rollback_candidate" as const,
            runId,
            proposalId: simulation.proposalId,
            experimentId: simulation.id,
            priority: 85,
            status: simulation.status,
            summary: simulation.result?.notes ?? "rollback candidate",
            actionHint: runId
              ? `athena research operate ${runId} --action rollback`
              : "inspect run and rollback",
          }];
        }),
    ];

    return entries.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  }

  listRecentTeamRuns(sessionId: string, limit = 5): TeamRunRecord[] {
    return this.teamRunStore.listRecentTeamRuns(sessionId, limit);
  }

  clearAutomationBlock(runId: string): TeamRunRecord | null {
    const run = this.teamRunStore.getTeamRun(runId);
    if (!run) return null;
    const latestOutput = { ...(run.latestOutput ?? {}) } as Record<string, unknown>;
    delete latestOutput.automationBlock;
    return this.teamRunStore.updateTeamRun(runId, { latestOutput });
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
