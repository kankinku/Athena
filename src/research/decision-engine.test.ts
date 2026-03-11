import test from "node:test";
import assert from "node:assert/strict";

import { buildDecisionDrift, buildProposalDecision, buildProposalScorecard, buildReconsiderationTriggers } from "./decision-engine.js";
import type { ProposalBrief } from "./contracts.js";

function createProposal(overrides: Partial<ProposalBrief> = {}): ProposalBrief {
  return {
    proposalId: "proposal-1",
    title: "Enable checkpointing",
    summary: "Reduce memory pressure during long runs.",
    targetModules: ["trainer"],
    expectedGain: "significant memory improvement",
    expectedRisk: "moderate stability risk with some memory pressure",
    codeChangeScope: ["training loop", "config"],
    status: "candidate",
    experimentBudget: { maxWallClockMinutes: 30 },
    stopConditions: ["OOM persists"],
    reconsiderConditions: [],
    claimIds: ["claim-1"],
    claimSupport: {
      claimIds: ["claim-1"],
      sourceCoverage: 0.7,
      evidenceStrength: 0.4,
      freshnessScore: 0.3,
      contradictionPressure: 0.5,
      unresolvedClaims: [],
    },
    ...overrides,
  };
}

test("proposal scorecard incorporates evidence and contradiction signals", () => {
  const scorecard = buildProposalScorecard(createProposal());

  assert.equal(scorecard.scoreVersion, "v3");
  assert.equal(scorecard.axisScores.evidence_strength, 0.4);
  assert.equal(scorecard.axisScores.evidence_freshness, 0.3);
  assert.equal(scorecard.axisScores.contradiction_pressure, 0.5);
  assert.ok(scorecard.disagreementFlags.includes("contradictory_evidence_pressure"));
});

test("reconsideration triggers add freshness and contradiction follow-ups", () => {
  const proposal = createProposal({
    expectedRisk: "low integration risk",
    codeChangeScope: ["config"],
    stopConditions: [],
  });
  const decision = buildProposalDecision({
    ...proposal,
    scorecard: buildProposalScorecard(proposal),
  });

  const triggers = buildReconsiderationTriggers(decision, proposal);
  const triggerText = triggers.map((trigger) => trigger.triggerCondition).join(" | ");

  assert.match(triggerText, /fresher evidence/i);
  assert.match(triggerText, /contradiction pressure/i);
});

test("decision drift records freshness and contradiction notes", () => {
  const proposal = createProposal();
  const scorecard = buildProposalScorecard(proposal);
  const planningDecision = buildProposalDecision({ ...proposal, scorecard });
  const finalDecision = { ...planningDecision, decisionType: "revisit" as const, confidence: 0.4 };

  const drift = buildDecisionDrift(planningDecision, finalDecision, scorecard);

  assert.ok(drift);
  assert.ok(drift?.notes.some((note) => note.startsWith("freshness_drift=")));
  assert.ok(drift?.notes.some((note) => note.startsWith("contradiction_pressure=")));
});
