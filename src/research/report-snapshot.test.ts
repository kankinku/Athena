import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildResearchReportInput } from "./reporting.js";

test("buildResearchReportInput keeps key operator sections stable", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-report-snapshot-"));
  process.env.ATHENA_HOME = home;

  const [{ SessionStore }, { TeamStore }, { closeDb }] = await Promise.all([
    import("../store/session-store.js"),
    import("./team-store.js"),
    import("../store/database.js"),
  ]);

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");

    teamStore.saveProposalBrief(session.id, {
      proposalId: "proposal-snapshot",
      title: "Snapshot Proposal",
      summary: "Keep reporting layout stable.",
      targetModules: ["trainer"],
      expectedGain: "high gain",
      expectedRisk: "low risk",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 15 },
      stopConditions: ["loss regresses"],
      reconsiderConditions: ["new benchmark appears"],
      claimIds: ["claim-1"],
      claimSupport: {
        claimIds: ["claim-1"],
        sourceCoverage: 0.5,
        evidenceStrength: 0.8,
        freshnessScore: 0.7,
        contradictionPressure: 0.1,
        unresolvedClaims: [],
      },
      scorecard: {
        proposalId: "proposal-snapshot",
        merit: 0.8,
        risk: 0.2,
        decisionScore: 0.7,
        weightedScore: 0.74,
        axisScores: {
          expected_gain: 0.8,
          evidence_strength: 0.8,
          evidence_freshness: 0.7,
          contradiction_pressure: 0.1,
          memory_risk: 0.2,
          stability_risk: 0.2,
          integration_cost: 0.3,
          rollback_difficulty: 0.1,
          observability_readiness: 0.6,
        },
        evaluatorSummaries: [],
        disagreementFlags: [],
        scoreVersion: "v3",
      },
    });

    teamStore.saveImprovementProposal(session.id, {
      improvementId: "imp-snapshot",
      runId: "run-1",
      mergeKey: "research_strategy::proposal-snapshot::keep",
      title: "Research Strategy Improvement",
      targetArea: "research_strategy",
      hypothesis: "Keep reusable strategies visible.",
      rationale: "Stable report coverage matters.",
      expectedBenefit: "Safer UI/report evolution.",
      priorityScore: 0.83,
      reviewStatus: "queued",
      rollbackPlan: "Drop the proposal if the format regresses.",
      status: "proposed",
      createdAt: 1,
      updatedAt: 1,
    });

    const report = buildResearchReportInput(session.id, teamStore, sessionStore, { transcriptLimit: 10 });
    const expected = normalize(`
## Summary

- active_runs=0

- proposals=1

- revisit_due=0

- open_triggers=0

- latest_decision=n/a

## Proposal Briefs

- proposal-snapshot: Snapshot Proposal
  summary: Keep reporting layout stable.
  status: candidate
  expected_gain: high gain
  expected_risk: low risk
  target_modules: trainer
  code_change_scope: config
  decision_score: 0.7
  claim_support: evidence=0.80 freshness=0.70 contradiction=0.10 uncovered=0
  weighted_score: 0.74
  score_axes: expected_gain=0.8, evidence_strength=0.8, evidence_freshness=0.7, contradiction_pressure=0.1, memory_risk=0.2, stability_risk=0.2, integration_cost=0.3, rollback_difficulty=0.1, observability_readiness=0.6
  stop_conditions: loss regresses
  reconsider_conditions: new benchmark appears

## Approval Queue

- proposal proposal-snapshot: status=candidate; title=Snapshot Proposal

- improvement imp-snapshot: review=queued; priority=0.83; title=Research Strategy Improvement

## Self Improvement Proposals

- imp-snapshot: area=research_strategy; status=proposed; review=queued; priority=0.83; title=Research Strategy Improvement; expected_benefit=Safer UI/report evolution.; rollback=Drop the proposal if the format regresses.

## Improvement Review Queue

- imp-snapshot: priority=0.83; merge_key=research_strategy::proposal-snapshot::keep; title=Research Strategy Improvement
    `);

    assert.equal(normalize(report), expected);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

function normalize(value: string): string {
  return value.replace(/\r/g, "").trim();
}
