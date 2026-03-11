import test from "node:test";
import assert from "node:assert/strict";

import { analyzeRunForImprovement } from "./improvement-engine.js";
import type { DecisionRecord, ExperimentResult, ProposalBrief } from "./contracts.js";

function createProposal(): ProposalBrief {
  return {
    proposalId: "proposal-1",
    title: "Enable checkpointing",
    summary: "Reduce memory pressure during long runs.",
    targetModules: ["trainer"],
    expectedGain: "significant memory improvement",
    expectedRisk: "moderate stability risk",
    codeChangeScope: ["training loop"],
    status: "candidate",
    experimentBudget: { maxWallClockMinutes: 30 },
    stopConditions: ["OOM persists"],
    reconsiderConditions: ["new hardware"],
    claimIds: ["claim-1"],
  };
}

function createDecision(): DecisionRecord {
  return {
    decisionId: "decision-1",
    proposalId: "proposal-1",
    decisionType: "reject",
    decisionSummary: "Result regressed throughput.",
    confidence: 0.62,
    reasonTags: ["simulation_negative"],
    createdAt: Date.now(),
    createdBy: "test",
    evidenceLinks: ["claim-1"],
  };
}

test("analyzeRunForImprovement creates rollback-oriented evaluation for crashes", () => {
  const result: ExperimentResult = {
    experimentId: "exp-1",
    proposalId: "proposal-1",
    outcomeStatus: "crash",
    beforeMetrics: { loss: 1.2 },
    afterMetrics: { loss: 1.5 },
    resourceDelta: {},
    surprisingFindings: ["OOM after optimizer rewrite"],
  };

  const analysis = analyzeRunForImprovement({
    runId: "run-1",
    proposal: createProposal(),
    result,
    decision: createDecision(),
    rollbackPlan: "Revert the optimizer patch",
  });

  assert.equal(analysis.proposal?.targetArea, "workflow_guardrail");
  assert.equal(analysis.proposal?.rollbackPlan, "Revert the optimizer patch");
  assert.equal(analysis.evaluation.outcome, "rollback_required");
  assert.equal(analysis.evaluation.rollbackRequired, true);
});

test("analyzeRunForImprovement approves reusable strategy for successful runs", () => {
  const result: ExperimentResult = {
    experimentId: "exp-2",
    proposalId: "proposal-1",
    outcomeStatus: "keep",
    beforeMetrics: { accuracy: 0.7 },
    afterMetrics: { accuracy: 0.81 },
    resourceDelta: {},
    surprisingFindings: ["accuracy improved without instability"],
  };

  const analysis = analyzeRunForImprovement({
    runId: "run-1",
    proposal: createProposal(),
    result,
    decision: { ...createDecision(), decisionType: "adopt", decisionSummary: "Adopt the strategy." },
  });

  assert.equal(analysis.proposal?.status, "approved");
  assert.equal(analysis.proposal?.targetArea, "research_strategy");
  assert.equal(analysis.evaluation.outcome, "promising");
  assert.match(analysis.evaluation.metricDeltaSummary, /accuracy=0.1100/);
});
