import { nanoid } from "nanoid";
import type {
  DecisionRecord,
  ExperimentResult,
  ImprovementEvaluationRecord,
  ImprovementProposalRecord,
  ProposalBrief,
} from "./contracts.js";

export interface RunImprovementAnalysis {
  proposal?: ImprovementProposalRecord;
  evaluation: ImprovementEvaluationRecord;
}

export function analyzeRunForImprovement(input: {
  runId: string;
  proposal?: ProposalBrief;
  result: ExperimentResult;
  decision: DecisionRecord;
  rollbackPlan?: string;
}): RunImprovementAnalysis {
  const now = Date.now();
  const improvementProposal = buildImprovementProposal(input, now);
  const evaluation = buildImprovementEvaluation(input, improvementProposal?.improvementId, now);
  return {
    proposal: improvementProposal,
    evaluation,
  };
}

function buildImprovementProposal(
  input: {
    runId: string;
    proposal?: ProposalBrief;
    result: ExperimentResult;
    decision: DecisionRecord;
    rollbackPlan?: string;
  },
  createdAt: number,
): ImprovementProposalRecord | undefined {
  const targetArea = inferTargetArea(input.result.outcomeStatus);
  const summary = summarizeImprovementNeed(input.result);
  if (!targetArea || !summary) return undefined;
  const priorityScore = buildPriorityScore(input.result, input.decision);
  return {
    improvementId: nanoid(),
    runId: input.runId,
    proposalId: input.proposal?.proposalId,
    experimentId: input.result.experimentId,
    mergeKey: buildMergeKey(targetArea, input.proposal?.proposalId, input.result.outcomeStatus),
    title: `${titleForTargetArea(targetArea)}: ${input.proposal?.title ?? input.result.proposalId}`,
    targetArea,
    hypothesis: summary,
    rationale: input.result.surprisingFindings.join(" | ") || input.result.notes || input.decision.decisionSummary,
    expectedBenefit: expectedBenefitForOutcome(input.result.outcomeStatus),
    priorityScore,
    reviewStatus: priorityScore >= 0.75 ? "queued" : "in_review",
    rollbackPlan: input.rollbackPlan ?? "Revert to prior workflow/policy settings and discard the improvement experiment.",
    status: input.result.outcomeStatus === "keep" ? "approved" : "proposed",
    sourceDecisionId: input.decision.decisionId,
    createdAt,
    updatedAt: createdAt,
  };
}

function buildImprovementEvaluation(
  input: {
    runId: string;
    proposal?: ProposalBrief;
    result: ExperimentResult;
    decision: DecisionRecord;
  },
  improvementId: string | undefined,
  createdAt: number,
): ImprovementEvaluationRecord {
  const outcome = input.result.outcomeStatus === "keep"
    ? "promising"
    : input.result.outcomeStatus === "discard" || input.result.outcomeStatus === "crash"
      ? "rollback_required"
      : input.result.outcomeStatus === "budget_exceeded"
        ? "neutral"
        : "promising";
  return {
    evaluationId: nanoid(),
    improvementId,
    runId: input.runId,
    experimentId: input.result.experimentId,
    outcome,
    summary: `Self-improvement review for ${input.proposal?.title ?? input.result.proposalId}: ${input.decision.decisionSummary}`,
    recommendedAction: outcome === "rollback_required"
      ? "keep current strategy and record rollback note"
      : outcome === "promising"
        ? "queue operator review for follow-up improvement trial"
        : "keep observing before changing the system",
    rollbackRequired: outcome === "rollback_required",
    metricDeltaSummary: formatMetricDelta(input.result.beforeMetrics, input.result.afterMetrics),
    createdAt,
  };
}

function inferTargetArea(outcome: ExperimentResult["outcomeStatus"]): ImprovementProposalRecord["targetArea"] | undefined {
  switch (outcome) {
    case "budget_exceeded":
      return "automation_policy";
    case "crash":
      return "workflow_guardrail";
    case "inconclusive":
      return "evaluation_strategy";
    case "discard":
      return "decision_policy";
    case "keep":
    case "shadow_win":
      return "research_strategy";
    default:
      return "reporting_quality";
  }
}

function summarizeImprovementNeed(result: ExperimentResult): string | undefined {
  switch (result.outcomeStatus) {
    case "budget_exceeded":
      return "Tighten automation policy or checkpointing so future runs stop earlier with clearer budget signals.";
    case "crash":
      return "Add stronger workflow guardrails and rollback preparation before launching similar experiments.";
    case "inconclusive":
      return "Improve evaluation criteria so runs produce a decisive result faster.";
    case "discard":
      return "Refine decision policy so weak ideas are filtered before experiment launch.";
    case "keep":
    case "shadow_win":
      return "Capture the successful pattern as reusable research strategy guidance.";
    default:
      return "Record a reusable lesson from this run for future planning.";
  }
}

function expectedBenefitForOutcome(outcome: ExperimentResult["outcomeStatus"]): string {
  switch (outcome) {
    case "budget_exceeded":
      return "Lower wasted spend and faster overnight recovery.";
    case "crash":
      return "Fewer broken runs and safer automated execution.";
    case "inconclusive":
      return "Higher decision clarity per experiment.";
    case "discard":
      return "Better pre-filtering of low-value experiments.";
    default:
      return "Higher reuse of successful research patterns.";
  }
}

function titleForTargetArea(area: ImprovementProposalRecord["targetArea"]): string {
  switch (area) {
    case "automation_policy":
      return "Automation Policy Improvement";
    case "workflow_guardrail":
      return "Workflow Guardrail Improvement";
    case "evaluation_strategy":
      return "Evaluation Strategy Improvement";
    case "decision_policy":
      return "Decision Policy Improvement";
    case "reporting_quality":
      return "Reporting Quality Improvement";
    case "research_strategy":
      return "Research Strategy Improvement";
  }
}

function buildPriorityScore(result: ExperimentResult, decision: DecisionRecord): number {
  let score = 0.45;
  if (result.outcomeStatus === "crash") score += 0.35;
  if (result.outcomeStatus === "budget_exceeded") score += 0.2;
  if (result.outcomeStatus === "keep" || result.outcomeStatus === "shadow_win") score += 0.25;
  if (result.guardrailTrialRecommended) score += 0.15;
  score += Math.min(0.15, result.surprisingFindings.length * 0.05);
  score += Math.max(0, 0.1 - (decision.confidence * 0.05));
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function buildMergeKey(
  targetArea: ImprovementProposalRecord["targetArea"],
  proposalId: string | undefined,
  outcomeStatus: ExperimentResult["outcomeStatus"],
): string {
  return [targetArea, proposalId ?? "run-level", outcomeStatus].join("::");
}

function formatMetricDelta(before: Record<string, number>, after: Record<string, number>): string {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (keys.length === 0) return "n/a";
  return keys
    .map((key) => {
      const beforeValue = before[key];
      const afterValue = after[key];
      if (typeof beforeValue !== "number" || typeof afterValue !== "number") {
        return `${key}=n/a`;
      }
      const delta = afterValue - beforeValue;
      return `${key}=${delta.toFixed(4)}`;
    })
    .join(", ");
}
