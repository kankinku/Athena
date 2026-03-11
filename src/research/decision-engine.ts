import { nanoid } from "nanoid";
import type {
  DecisionDriftRecord,
  DecisionReasonTag,
  DecisionRecord,
  DecisionType,
  ExperimentResult,
  ProposalBrief,
  ProposalScorecard,
  ResearchCandidatePack,
  ReconsiderationTrigger,
} from "./contracts.js";

const SCORE_VERSION = "v2";

export function buildProposalScorecard(brief: ProposalBrief): ProposalScorecard {
  const expectedGain = inferExpectedGain(brief.expectedGain);
  const memoryRisk = inferRisk(brief.expectedRisk, ["memory", "oom", "ram", "gpu"]);
  const stabilityRisk = inferRisk(brief.expectedRisk, ["stability", "crash", "failure", "regression", "bug"]);
  const integrationCost = clamp01((brief.codeChangeScope.length * 0.2) + (brief.targetModules.length * 0.12));
  const rollbackDifficulty = clamp01((brief.codeChangeScope.length * 0.15) + (brief.stopConditions.length * 0.08));
  const observabilityReadiness = clamp01((brief.stopConditions.length * 0.15) + (brief.reconsiderConditions.length * 0.12) + 0.3);

  const merit = clamp01(
    expectedGain * 0.34 +
    (1 - integrationCost) * 0.18 +
    observabilityReadiness * 0.18 +
    (1 - rollbackDifficulty) * 0.12 +
    (brief.claimIds.length > 0 ? 0.18 : 0.08),
  );

  const risk = clamp01(
    memoryRisk * 0.22 +
    stabilityRisk * 0.28 +
    integrationCost * 0.2 +
    rollbackDifficulty * 0.15 +
    (1 - observabilityReadiness) * 0.15,
  );

  const decisionScore = clamp01(merit * 0.6 + (1 - risk) * 0.4);
  const disagreementFlags: string[] = [];
  if (expectedGain >= 0.75 && stabilityRisk >= 0.6) disagreementFlags.push("high_gain_but_high_instability");
  if (observabilityReadiness < 0.4 && decisionScore >= 0.6) disagreementFlags.push("weak_observability_for_trial");

  return {
    proposalId: brief.proposalId,
    weightedScore: decisionScore,
    axisScores: {
      expected_gain: expectedGain,
      memory_risk: memoryRisk,
      stability_risk: stabilityRisk,
      integration_cost: integrationCost,
      rollback_difficulty: rollbackDifficulty,
      observability_readiness: observabilityReadiness,
    },
    merit,
    risk,
    decisionScore,
    evaluatorSummaries: [
      `Expected gain ${expectedGain.toFixed(2)} with risk ${risk.toFixed(2)} and observability ${observabilityReadiness.toFixed(2)}.`,
      `Integration cost ${integrationCost.toFixed(2)} across ${brief.targetModules.length} target modules and ${brief.codeChangeScope.length} change scopes.`,
    ],
    disagreementFlags,
    scoreVersion: SCORE_VERSION,
  };
}

export function buildProposalDecision(
  brief: ProposalBrief,
  createdBy = "system:decision-engine",
  supersedesDecisionId?: string,
): DecisionRecord {
  const scorecard = brief.scorecard ?? buildProposalScorecard(brief);
  const decisionType = classifyProposalDecision(scorecard.decisionScore, scorecard.risk);
  const reasonTags = classifyProposalReasonTags(scorecard, decisionType);
  return {
    decisionId: nanoid(),
    proposalId: brief.proposalId,
    decisionType,
    decisionSummary: summarizeProposalDecision(brief, decisionType, scorecard),
    confidence: clamp01(scorecard.decisionScore),
    reasonTags,
    createdAt: Date.now(),
    createdBy,
    evidenceLinks: brief.claimIds,
    supersedesDecisionId,
    calibration: {
      weightedScore: scorecard.weightedScore,
    },
  };
}

export function buildResultDecision(
  result: ExperimentResult,
  options: {
    proposalTitle?: string;
    createdBy?: string;
    evidenceLinks?: string[];
    supersedesDecisionId?: string;
  } = {},
): DecisionRecord {
  const decisionType = classifyResultDecision(result.outcomeStatus);
  const reasonTags = classifyResultReasonTags(result);
  return {
    decisionId: nanoid(),
    proposalId: result.proposalId,
    simulationId: result.experimentId,
    decisionType,
    decisionSummary: summarizeResultDecision(result, decisionType, options.proposalTitle),
    confidence: result.outcomeStatus === "keep" ? 0.82 : result.outcomeStatus === "budget_exceeded" ? 0.55 : 0.68,
    reasonTags,
    createdAt: Date.now(),
    createdBy: options.createdBy ?? "system:decision-engine",
    evidenceLinks: options.evidenceLinks ?? [],
    supersedesDecisionId: options.supersedesDecisionId,
    calibration: {
      outcomeStatus: result.outcomeStatus,
    },
  };
}

export function buildReconsiderationTriggers(decision: DecisionRecord, proposal: ProposalBrief): ReconsiderationTrigger[] {
  if (decision.decisionType === "adopt") return [];
  const conditions = proposal.reconsiderConditions.length > 0
    ? proposal.reconsiderConditions
    : defaultReconsiderationConditions(decision.reasonTags);
  return conditions.slice(0, 3).map((condition, index) => ({
    triggerId: nanoid(),
    decisionId: decision.decisionId,
    triggerType: inferTriggerType(condition),
    triggerCondition: condition,
    status: "open",
    evidenceLinks: proposal.claimIds.slice(0, index + 1),
  }));
}

export function evaluateReconsiderationTriggers<T extends ReconsiderationTrigger>(
  triggers: T[],
  proposal: ProposalBrief,
  pack: ResearchCandidatePack,
): Array<{ trigger: T; evidenceLinks: string[]; notes: string[] }> {
  const results: Array<{ trigger: T; evidenceLinks: string[]; notes: string[] }> = [];
  const claimTexts = pack.claims.map((claim) => claim.statement.toLowerCase());
  const methodTags = new Set((pack.normalizedMethods ?? pack.methods).map((method) => method.toLowerCase()));

  for (const trigger of triggers) {
    const condition = trigger.triggerCondition.toLowerCase();
    const evidenceLinks: string[] = [];
    const notes: string[] = [];

    for (const claim of pack.claims) {
      const statement = claim.statement.toLowerCase();
      const highConfidence = (claim.confidence ?? 0) >= 0.7;
      const matchesEvidence = condition.includes("evidence") && highConfidence;
      const matchesMemory = condition.includes("memory") && statement.includes("memory");
      const matchesHardware = (condition.includes("hardware") || condition.includes("infra"))
        && /(hardware|gpu|memory|throughput)/.test(statement);
      const matchesMethod = claim.methodTag ? methodTags.has(claim.methodTag.toLowerCase()) : false;
      const matchesProposal = proposal.title.toLowerCase().split(/\W+/).some((token) => token.length > 4 && statement.includes(token));

      if (matchesEvidence || matchesMemory || matchesHardware || matchesMethod || matchesProposal) {
        evidenceLinks.push(claim.claimId);
      }
    }

    if (condition.includes("similar") && pack.claims.some((claim) => /(reduce|improve|stable|success)/.test(claim.statement.toLowerCase()))) {
      notes.push("similar_success_signal");
    }
    if (claimTexts.some((text) => /(budget|cheaper|cost)/.test(text)) && trigger.triggerType === "cost_reduced") {
      notes.push("cost_reduction_signal");
    }

    if (evidenceLinks.length > 0 || notes.length > 0) {
      results.push({
        trigger,
        evidenceLinks: dedupe(evidenceLinks),
        notes,
      });
    }
  }

  return results;
}

export function buildDecisionDrift(
  proposalDecision: DecisionRecord | undefined,
  finalDecision: DecisionRecord,
  scorecard?: ProposalScorecard,
): DecisionDriftRecord | undefined {
  if (!proposalDecision && !scorecard) return undefined;
  const weightedScore = scorecard?.weightedScore;
  const confidenceGap = weightedScore !== undefined ? round2(finalDecision.confidence - weightedScore) : undefined;
  const notes: string[] = [];
  if (confidenceGap !== undefined && Math.abs(confidenceGap) >= 0.15) {
    notes.push(`confidence_gap=${confidenceGap.toFixed(2)}`);
  }
  if (proposalDecision && proposalDecision.decisionType !== finalDecision.decisionType) {
    notes.push(`${proposalDecision.decisionType}->${finalDecision.decisionType}`);
  }
  return {
    initialDecision: proposalDecision?.decisionType,
    simulationDecision: finalDecision.simulationId ? finalDecision.decisionType : undefined,
    finalDecision: finalDecision.decisionType,
    changed: proposalDecision ? proposalDecision.decisionType !== finalDecision.decisionType : false,
    weightedScore,
    confidenceGap,
    notes,
  };
}

function classifyProposalDecision(score: number, risk: number): DecisionType {
  if (score >= 0.8 && risk < 0.45) return "trial";
  if (score >= 0.62) return "defer";
  return "reject";
}

function classifyResultDecision(outcome: ExperimentResult["outcomeStatus"]): DecisionType {
  switch (outcome) {
    case "keep":
    case "shadow_win":
      return "adopt";
    case "inconclusive":
      return "defer";
    case "budget_exceeded":
    case "superseded":
      return "revisit";
    default:
      return "reject";
  }
}

function classifyProposalReasonTags(scorecard: ProposalScorecard, decisionType: DecisionType): DecisionReasonTag[] {
  const tags: DecisionReasonTag[] = [];
  if (scorecard.axisScores.expected_gain >= 0.7) tags.push("high_expected_gain");
  if (scorecard.axisScores.memory_risk >= 0.55) tags.push("memory_risk");
  if (scorecard.axisScores.integration_cost >= 0.55) tags.push("integration_complexity");
  if (scorecard.axisScores.rollback_difficulty >= 0.55) tags.push("rollback_difficulty");
  if (scorecard.axisScores.observability_readiness < 0.45) tags.push("observability_gap");
  if (decisionType !== "trial" && scorecard.decisionScore < 0.62) tags.push("insufficient_gain");
  if (decisionType === "defer") tags.push("needs_more_evidence");
  return dedupe(tags);
}

function classifyResultReasonTags(result: ExperimentResult): DecisionReasonTag[] {
  const tags: DecisionReasonTag[] = [];
  if (result.outcomeStatus === "keep") tags.push("successful_validation", "stable_simulation");
  if (result.outcomeStatus === "discard" || result.outcomeStatus === "crash") tags.push("simulation_negative");
  if (result.outcomeStatus === "budget_exceeded") tags.push("budget_exceeded", "needs_more_evidence", "resource_mismatch");
  if (result.outcomeStatus === "superseded") tags.push("superseded_by_better_option");
  if (result.outcomeStatus === "inconclusive") tags.push("needs_more_evidence");
  if (result.guardrailTrialRecommended) tags.push("guardrail_trial");
  return dedupe(tags);
}

function summarizeProposalDecision(brief: ProposalBrief, decisionType: DecisionType, scorecard: ProposalScorecard): string {
  return `${decisionType.toUpperCase()}: ${brief.title} scored ${scorecard.decisionScore.toFixed(2)} with merit ${scorecard.merit.toFixed(2)} and risk ${scorecard.risk.toFixed(2)}.`;
}

function summarizeResultDecision(result: ExperimentResult, decisionType: DecisionType, proposalTitle?: string): string {
  const name = proposalTitle ?? result.proposalId;
  const guardrail = result.guardrailTrialRecommended ? " Guardrail trial remains possible." : "";
  return `${decisionType.toUpperCase()}: ${name} ended with outcome ${result.outcomeStatus}. Findings: ${result.surprisingFindings.join(" | ") || "none"}.${guardrail}`;
}

function inferExpectedGain(text: string): number {
  const lower = text.toLowerCase();
  if (/(major|large|significant|strong|substantial)/.test(lower)) return 0.82;
  if (/(moderate|improve|better|reduce|increase)/.test(lower)) return 0.68;
  if (/(slight|small|minor)/.test(lower)) return 0.48;
  return 0.58;
}

function inferRisk(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  const hit = keywords.some((keyword) => lower.includes(keyword));
  if (hit && /(high|severe|hard|large)/.test(lower)) return 0.78;
  if (hit) return 0.6;
  if (/(low|minimal|small)/.test(lower)) return 0.24;
  return 0.38;
}

function inferTriggerType(condition: string): ReconsiderationTrigger["triggerType"] {
  const lower = condition.toLowerCase();
  if (lower.includes("evidence")) return "new_evidence";
  if (lower.includes("infra") || lower.includes("hardware")) return "infra_changed";
  if (lower.includes("success") || lower.includes("similar")) return "similar_success";
  if (lower.includes("cost")) return "cost_reduced";
  return "constraint_removed";
}

function defaultReconsiderationConditions(tags: DecisionReasonTag[]): string[] {
  const conditions: string[] = [];
  if (tags.includes("budget_exceeded")) conditions.push("Retry when cost is reduced or a cheaper baseline exists");
  if (tags.includes("observability_gap")) conditions.push("Retry when observability and rollback hooks are added");
  if (tags.includes("memory_risk")) conditions.push("Retry when memory pressure is reduced or hardware changes");
  if (conditions.length === 0) conditions.push("Retry when new evidence or a similar success appears");
  return conditions;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
