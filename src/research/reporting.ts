import type { SessionStore } from "../store/session-store.js";
import type { TeamStore } from "./team-store.js";

export function buildResearchReportInput(
  sessionId: string,
  teamStore: TeamStore,
  sessionStore: SessionStore,
  options: { transcriptLimit?: number } = {},
): string {
  const proposals = teamStore.listProposalBriefs(sessionId);
  const simulations = teamStore.listRecentSimulationRuns(sessionId, 20);
  const runs = teamStore.listRecentTeamRuns(sessionId, 10);
  const decisions = teamStore.listDecisionRecords(sessionId);
  const triggers = teamStore.listReconsiderationTriggers(sessionId);
  const lineage = teamStore.listExperimentLineage(sessionId);
  const ingestion = teamStore.listIngestionSources(sessionId);
  const revisitDue = teamStore.listRevisitDueProposals(sessionId);
  const budgetAnomalies = teamStore.listBudgetAnomalies(sessionId);
  const messages = sessionStore.getMessages(sessionId, options.transcriptLimit ?? 200);
  const improvements = teamStore.listImprovementProposals(sessionId);
  const improvementEvaluations = teamStore.listImprovementEvaluations(sessionId);
  const incidents = teamStore.listIncidents(sessionId);
  const actionJournal = teamStore.listActionJournal(sessionId);
  const reviewQueue = teamStore.listReviewQueue(sessionId);
  const evidenceHealth = teamStore.buildEvidenceHealth(sessionId);

  const sections: string[] = [];

  const activeRuns = runs.filter((run) => run.status === "active");
  const recentDecision = decisions[0];
  const nextActions = buildNextActions(runs, proposals, triggers, revisitDue);

  sections.push(
    "## Summary",
    `- active_runs=${activeRuns.length}`,
    `- proposals=${proposals.length}`,
    `- revisit_due=${revisitDue.length}`,
    `- open_triggers=${triggers.filter((trigger) => trigger.status === "open").length}`,
    `- latest_decision=${recentDecision?.decisionType ?? "n/a"}`,
    `- open_incidents=${incidents.filter((incident) => incident.status === "open").length}`,
    `- review_queue=${reviewQueue.length}`,
  );

  sections.push(
    "## Evidence Health",
    `- source_count=${evidenceHealth.sourceCount}`,
    `- claim_count=${evidenceHealth.claimCount}`,
    `- canonical_claim_count=${evidenceHealth.canonicalClaimCount}`,
    `- contradiction_count=${evidenceHealth.contradictionCount}`,
    `- uncovered_claim_count=${evidenceHealth.uncoveredClaimCount}`,
    `- evidence_strength=${evidenceHealth.evidenceStrength}`,
    `- model_confidence=${evidenceHealth.modelConfidence}`,
    `- confidence_separation=${evidenceHealth.confidenceSeparation}`,
    `- coverage_gaps=${evidenceHealth.coverageGaps.join(", ") || "n/a"}`,
  );

  if (recentDecision) {
    sections.push(
      "## Current Decision",
      `- proposal=${recentDecision.proposalId}`,
      `- type=${recentDecision.decisionType}`,
      `- confidence=${recentDecision.confidence}`,
      `- summary=${recentDecision.decisionSummary}`,
      `- reasons=${recentDecision.reasonTags.join(", ") || "n/a"}`,
    );
  }

  if (runs.length > 0) {
    sections.push(
      "## Team Runs",
      ...runs.map(
        (run) => {
          const workflowHistory = teamStore.listWorkflowTransitions(sessionId, run.id).slice(-4);
          return [
            `- ${run.id}: goal=${run.goal}; stage=${run.currentStage}; workflow=${run.workflowState}; status=${run.status}`,
            workflowHistory.length > 0
              ? `  workflow_history: ${workflowHistory.map((entry) => `${entry.fromState}->${entry.toState}`).join(" | ")}`
              : null,
          ].filter(Boolean).join("\n");
        },
      ),
    );
  }

  if (runs.length > 0) {
    sections.push(
      "## Automation Status",
      ...runs.map((run) => {
        const checkpoints = teamStore.listAutomationCheckpoints(sessionId, run.id).slice(-3);
        return [
          `- ${run.id}: mode=${run.automationPolicy.mode}; workflow=${run.workflowState}; status=${run.status}`,
          `  approvals: proposal=${run.automationPolicy.requireProposalApproval}; experiment=${run.automationPolicy.requireExperimentApproval}; revisit=${run.automationPolicy.requireRevisitApproval}`,
          formatAutonomyPolicy(run.automationPolicy),
          `  retry: ${run.automationState.retryCount}/${run.retryPolicy.maxRetries}; retry_on=${run.retryPolicy.retryOn.join(",") || "n/a"}`,
          `  checkpoint: last=${run.automationState.lastCheckpointAt ?? "n/a"}; next=${run.automationState.nextCheckpointAt ?? "n/a"}; interval_min=${run.checkpointPolicy.intervalMinutes}`,
          `  timeout: at=${run.automationState.timeoutAt ?? "n/a"}; max_run_min=${run.timeoutPolicy.maxRunMinutes}`,
          checkpoints.length > 0
            ? `  recent_checkpoints: ${checkpoints.map((checkpoint) => `${checkpoint.workflowState}/${checkpoint.stage}:${checkpoint.reason}`).join(" | ")}`
            : null,
        ].filter(Boolean).join("\n");
      }),
    );
  }

  if (proposals.length > 0) {
    sections.push(
      "## Proposal Briefs",
      ...proposals.map((proposal) => {
        const score = proposal.scorecard?.decisionScore;
        return [
          `- ${proposal.proposalId}: ${proposal.title}`,
          `  summary: ${proposal.summary}`,
          `  status: ${proposal.status}`,
          `  expected_gain: ${proposal.expectedGain}`,
          `  expected_risk: ${proposal.expectedRisk}`,
          `  target_modules: ${proposal.targetModules.join(", ") || "n/a"}`,
          `  code_change_scope: ${proposal.codeChangeScope.join(", ") || "n/a"}`,
          `  decision_score: ${score ?? "n/a"}`,
          proposal.claimSupport
            ? `  claim_support: evidence=${proposal.claimSupport.evidenceStrength.toFixed(2)} freshness=${proposal.claimSupport.freshnessScore.toFixed(2)} contradiction=${proposal.claimSupport.contradictionPressure.toFixed(2)} uncovered=${proposal.claimSupport.unresolvedClaims.length}`
            : null,
          `  evidence_health: ${formatEvidenceHealth(teamStore.buildEvidenceHealth(sessionId, proposal.proposalId))}`,
          proposal.scorecard
            ? `  weighted_score: ${proposal.scorecard.weightedScore}`
            : null,
          proposal.scorecard
            ? `  score_axes: ${formatMetricMap(proposal.scorecard.axisScores as Record<string, unknown>)}`
            : null,
          (() => {
            const latestDecision = decisions.find((decision) => decision.proposalId === proposal.proposalId);
            const latestResult = simulations.find((simulation) => simulation.proposalId === proposal.proposalId)?.result;
            if (!latestDecision && !latestResult) return null;
            return `  operator_snapshot: decision=${latestDecision?.decisionType ?? "n/a"}; confidence=${latestDecision?.confidence ?? "n/a"}; latest_result=${latestResult?.outcomeStatus ?? "n/a"}`;
          })(),
          `  stop_conditions: ${proposal.stopConditions.join(" | ") || "n/a"}`,
          `  reconsider_conditions: ${proposal.reconsiderConditions.join(" | ") || "n/a"}`,
        ].filter(Boolean).join("\n");
      }),
    );
  }

  if (simulations.length > 0) {
    sections.push(
      "## Simulation Runs",
      ...simulations.map((simulation) => {
        const result = simulation.result;
        return [
          `- ${simulation.id}: proposal=${simulation.proposalId}; status=${simulation.status}; task=${simulation.taskKey ?? "n/a"}`,
          `  command: ${simulation.charter.command}`,
          `  metric: ${simulation.charter.evaluationMetric}`,
          result ? `  outcome: ${result.outcomeStatus}` : "  outcome: pending",
          result
            ? `  before_metrics: ${formatMetricMap(result.beforeMetrics)}`
            : null,
          result
            ? `  after_metrics: ${formatMetricMap(result.afterMetrics)}`
            : null,
          result
            ? `  resource_delta: ${formatMetricMap(result.resourceDelta)}`
            : null,
          result && result.surprisingFindings.length > 0
            ? `  surprising_findings: ${result.surprisingFindings.join(" | ")}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");
      }),
    );
  }

  if (decisions.length > 0) {
    sections.push(
      "## Decision Records",
      ...decisions.map((decision) => [
        `- ${decision.decisionId}: proposal=${decision.proposalId}; type=${decision.decisionType}; confidence=${decision.confidence}`,
        `  summary: ${decision.decisionSummary}`,
        decision.calibration?.weightedScore !== undefined
          ? `  weighted_score: ${decision.calibration.weightedScore}`
          : null,
        decision.drift
          ? `  decision_drift: changed=${decision.drift.changed}; final=${decision.drift.finalDecision}; notes=${decision.drift.notes.join(" | ") || "n/a"}`
          : null,
        `  reasons: ${decision.reasonTags.join(", ") || "n/a"}`,
        `  evidence_links: ${decision.evidenceLinks.join(", ") || "n/a"}`,
        decision.supersedesDecisionId ? `  supersedes: ${decision.supersedesDecisionId}` : null,
      ].filter(Boolean).join("\n")),
    );
  }

  if (triggers.length > 0) {
    sections.push(
      "## Reconsideration Triggers",
      ...triggers.map(
        (trigger) =>
          `- ${trigger.triggerId}: decision=${trigger.decisionId}; type=${trigger.triggerType}; status=${trigger.status}; condition=${trigger.triggerCondition}; evidence=${trigger.evidenceLinks?.join(", ") ?? "n/a"}`,
      ),
    );
  }

  if (revisitDue.length > 0) {
    sections.push(
      "## Revisit Queue",
      ...revisitDue.map(
        (proposal) => `- ${proposal.proposalId}: ${proposal.title}; status=${proposal.status}; claims=${proposal.claimIds.join(", ") || "n/a"}`,
      ),
    );
  }

  if (lineage.length > 0) {
    sections.push(
      "## Experiment Ledger",
      ...lineage.map(
        (entry) =>
          `- ${entry.lineageId}: proposal=${entry.proposalId}; experiment=${entry.experimentId ?? "n/a"}; relation=${entry.relationType}; related=${entry.relatedExperimentId ?? "n/a"}; superseded_by=${entry.supersededByExperimentId ?? "n/a"}; summary=${entry.summary}`,
      ),
    );
  }

  if (ingestion.length > 0) {
    sections.push(
      "## Ingestion Sources",
      ...ingestion.map((source) => [
        `- ${source.sourceId}: ${source.sourceType}; title=${source.title}; status=${source.status}; candidate=${source.extractedCandidateId ?? "n/a"}; claim_count=${source.claimCount ?? 0}; canonical_claim_count=${source.canonicalClaims?.length ?? 0}; linked_proposal_count=${source.linkedProposalCount ?? 0}`,
        source.sourceDigest ? `  digest: ${source.sourceDigest}` : null,
        source.sourceExcerpt ? "  excerpt: [redacted in report output]" : null,
        source.extractedClaims?.length
          ? `  extracted_claims: ${source.extractedClaims.slice(0, 3).map((claim) => `${claim.disposition ?? "support"}:${claim.statement}`).join(" | ")}`
          : null,
        source.extractedClaims?.length
          ? `  citations: ${source.extractedClaims.slice(0, 2).flatMap((claim) => (claim.citationSpans ?? []).slice(0, 1).map((span) => `${span.locator ?? "n/a"}:${span.text}`)).join(" | ") || "n/a"}`
          : null,
      ].filter(Boolean).join("\n")),
    );
  }

  if (budgetAnomalies.length > 0) {
    sections.push(
      "## Budget Anomalies",
      ...budgetAnomalies.map(
        (item) => `- ${item.experimentId}: proposal=${item.proposalId}; decision=${item.decisionId ?? "n/a"}; findings=${item.findings.join(" | ") || "n/a"}`,
      ),
    );
  }

  if (incidents.length > 0) {
    sections.push(
      "## Incidents",
      ...incidents.map((incident) => `- ${incident.incidentId}: type=${incident.type}; severity=${incident.severity}; status=${incident.status}; run=${incident.runId}; proposal=${incident.proposalId ?? "n/a"}; summary=${incident.summary}`),
    );
  }

  if (actionJournal.length > 0) {
    sections.push(
      "## Action Journal",
      ...actionJournal.map((action) => `- ${action.actionId}: run=${action.runId}; type=${action.actionType}; state=${action.state}; summary=${action.summary}; error=${action.error ? "[redacted]" : "n/a"}`),
    );
  }

  if (decisions.length > 0) {
    sections.push(
      "## Decision Drift",
      ...decisions
        .filter((decision) => decision.drift)
        .map(
          (decision) => `- ${decision.proposalId}: changed=${decision.drift?.changed}; final=${decision.drift?.finalDecision}; confidence_gap=${decision.drift?.confidenceGap ?? "n/a"}; notes=${decision.drift?.notes.join(" | ") || "n/a"}`,
        ),
    );
    sections.push(
      "## What Would Change This Decision",
      ...triggers.map((trigger) => `- ${trigger.decisionId}: ${trigger.triggerCondition}`),
    );
  }

  if (nextActions.length > 0) {
    sections.push(
      "## Next Actions",
      ...nextActions.map((action) => `- ${action}`),
    );
  }

  if (reviewQueue.length > 0) {
    sections.push(
      "## Supervision Queue",
      ...reviewQueue.map((entry) => `- ${entry.kind}: priority=${entry.priority}; status=${entry.status}; id=${entry.id}; summary=${entry.summary}; action=${entry.actionHint}`),
    );
  }

  const proposalApprovals = proposals.filter((proposal) => proposal.status === "candidate" || proposal.status === "revisit_due");
  const improvementApprovals = improvements.filter((proposal) => proposal.reviewStatus === "queued");
  if (proposalApprovals.length > 0 || improvementApprovals.length > 0) {
    sections.push(
      "## Approval Queue",
      ...proposalApprovals.map((proposal) => `- proposal ${proposal.proposalId}: status=${proposal.status}; title=${proposal.title}`),
      ...improvementApprovals.map((proposal) => `- improvement ${proposal.improvementId}: review=${proposal.reviewStatus}; priority=${proposal.priorityScore}; title=${proposal.title}`),
    );
  }

  if (improvements.length > 0) {
    const prioritizedImprovements = [...improvements].sort((a, b) => b.priorityScore - a.priorityScore);
    sections.push(
      "## Self Improvement Proposals",
      ...prioritizedImprovements.map((proposal) => `- ${proposal.improvementId}: area=${proposal.targetArea}; status=${proposal.status}; review=${proposal.reviewStatus}; priority=${proposal.priorityScore}; title=${proposal.title}; expected_benefit=${proposal.expectedBenefit}; rollback=${proposal.rollbackPlan}`),
    );
    sections.push(
      "## Improvement Review Queue",
      ...prioritizedImprovements
        .filter((proposal) => proposal.reviewStatus === "queued")
        .slice(0, 5)
        .map((proposal) => `- ${proposal.improvementId}: priority=${proposal.priorityScore}; merge_key=${proposal.mergeKey}; title=${proposal.title}`),
    );
  }

  if (improvementEvaluations.length > 0) {
    sections.push(
      "## Self Improvement Evaluations",
      ...improvementEvaluations.map((evaluation) => `- ${evaluation.evaluationId}: outcome=${evaluation.outcome}; rollback_required=${evaluation.rollbackRequired}; action=${evaluation.recommendedAction}; metrics=${evaluation.metricDeltaSummary}`),
    );
  }

  if (messages.length > 0) {
    sections.push(
      "## Transcript Excerpts",
      ...messages.map((message) => `[${message.role}] ${message.content}`),
    );
  }

  return sections.join("\n\n");
}

function buildNextActions(
  runs: ReturnType<TeamStore["listRecentTeamRuns"]>,
  proposals: ReturnType<TeamStore["listProposalBriefs"]>,
  triggers: ReturnType<TeamStore["listReconsiderationTriggers"]>,
  revisitDue: ReturnType<TeamStore["listRevisitDueProposals"]>,
): string[] {
  const actions: string[] = [];
  for (const run of runs.filter((item) => item.status === "active")) {
    actions.push(`Continue run ${run.id} from workflow ${run.workflowState} (${run.currentStage})`);
  }
  for (const proposal of revisitDue) {
    actions.push(`Re-evaluate proposal ${proposal.proposalId} because revisit is due`);
  }
  for (const proposal of proposals.filter((item) => item.status === "ready_for_experiment" || item.status === "scoped_trial").slice(0, 5)) {
    actions.push(`Prepare experiment validation for proposal ${proposal.proposalId}`);
  }
  for (const trigger of triggers.filter((item) => item.status === "open").slice(0, 5)) {
    actions.push(`Monitor trigger ${trigger.triggerId} for ${trigger.triggerType}`);
  }
  return dedupe(actions);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function formatMetricMap(metrics: Record<string, unknown>): string {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return "n/a";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function formatAutonomyPolicy(
  policy: import("./contracts.js").AutomationPolicy,
): string {
  if (policy.mode !== "fully-autonomous" || !policy.autonomyPolicy) {
    return "  autonomy: n/a";
  }

  return `  autonomy: risk=${policy.autonomyPolicy.maxRiskTier}; retry_cap=${policy.autonomyPolicy.maxRetryCount ?? "n/a"}; wall_min=${policy.autonomyPolicy.maxWallClockMinutes ?? "n/a"}; cost=${policy.autonomyPolicy.maxCostUsd ?? "n/a"}; evidence_floor=${policy.autonomyPolicy.requireEvidenceFloor ?? "n/a"}; rollback=${policy.autonomyPolicy.requireRollbackPlan ?? false}; machines=${policy.autonomyPolicy.allowedMachineIds?.join(",") ?? "n/a"}`;
}

function formatEvidenceHealth(health: import("./contracts.js").EvidenceHealthSummary): string {
  return `evidence=${health.evidenceStrength.toFixed(2)} model=${health.modelConfidence.toFixed(2)} separation=${health.confidenceSeparation.toFixed(2)} gaps=${health.coverageGaps.join("|") || "n/a"}`;
}
