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

  const sections: string[] = [];

  if (runs.length > 0) {
    sections.push(
      "## Team Runs",
      ...runs.map(
        (run) =>
          `- ${run.id}: goal=${run.goal}; stage=${run.currentStage}; status=${run.status}`,
      ),
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
      ...ingestion.map(
        (source) =>
          `- ${source.sourceId}: ${source.sourceType}; title=${source.title}; status=${source.status}; candidate=${source.extractedCandidateId ?? "n/a"}; claim_count=${source.claimCount ?? 0}; linked_proposal_count=${source.linkedProposalCount ?? 0}`,
      ),
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

  if (decisions.length > 0) {
    sections.push(
      "## Decision Drift",
      ...decisions
        .filter((decision) => decision.drift)
        .map(
          (decision) => `- ${decision.proposalId}: changed=${decision.drift?.changed}; final=${decision.drift?.finalDecision}; confidence_gap=${decision.drift?.confidenceGap ?? "n/a"}`,
        ),
    );
    sections.push(
      "## What Would Change This Decision",
      ...triggers.map((trigger) => `- ${trigger.decisionId}: ${trigger.triggerCondition}`),
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

function formatMetricMap(metrics: Record<string, unknown>): string {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return "n/a";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}
