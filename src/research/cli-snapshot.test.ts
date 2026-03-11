import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();

test("research CLI key operator views stay text-stable", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-snapshot-"));
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
    const run = teamStore.createTeamRun(session.id, "Snapshot run");

    teamStore.saveProposalBrief(session.id, {
      proposalId: "proposal-cli",
      title: "CLI Proposal",
      summary: "Snapshot me",
      targetModules: ["trainer"],
      expectedGain: "high gain",
      expectedRisk: "low risk",
      codeChangeScope: ["config"],
      status: "ready_for_experiment",
      experimentBudget: { maxWallClockMinutes: 10 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: ["claim-1"],
      claimSupport: {
        claimIds: ["claim-1"],
        sourceCoverage: 0.6,
        evidenceStrength: 0.81,
        freshnessScore: 0.74,
        contradictionPressure: 0.15,
        unresolvedClaims: [],
      },
      scorecard: {
        proposalId: "proposal-cli",
        merit: 0.7,
        risk: 0.2,
        decisionScore: 0.68,
        weightedScore: 0.72,
        axisScores: {
          expected_gain: 0.8,
          evidence_strength: 0.81,
          evidence_freshness: 0.74,
          contradiction_pressure: 0.15,
          memory_risk: 0.2,
          stability_risk: 0.1,
          integration_cost: 0.25,
          rollback_difficulty: 0.1,
          observability_readiness: 0.7,
        },
        evaluatorSummaries: [],
        disagreementFlags: [],
        scoreVersion: "v3",
      },
    });

    teamStore.saveImprovementProposal(session.id, {
      improvementId: "imp-cli-snapshot",
      runId: run.id,
      mergeKey: "automation_policy::proposal-cli::budget_exceeded",
      title: "Automation Policy Improvement",
      targetArea: "automation_policy",
      hypothesis: "Snapshot output must stay stable.",
      rationale: "Safety review depends on exact operator strings.",
      expectedBenefit: "Safer CLI changes.",
      priorityScore: 0.91,
      reviewStatus: "queued",
      rollbackPlan: "Revert snapshot changes.",
      status: "proposed",
      createdAt: 1,
      updatedAt: 1,
    });

    closeDb();

    const proposalsOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "proposals"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    const improvementsOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "improvements"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    const nextActionsOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "next-actions"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    assert.equal(
      normalize(proposalsOutput),
      "proposal-cli  ready_for_experiment score=0.68 evidence=0.81 freshness=0.74 contradiction=0.15  CLI Proposal",
    );
    assert.equal(
      normalize(improvementsOutput),
      "imp-cli-snapshot  proposed   review=queued     priority=0.91 area=automation_policy  Automation Policy Improvement",
    );
    assert.equal(
      normalize(nextActionsOutput),
      `run  ${run.id} continue workflow=draft stage=collection\nexperiment  proposal-cli prepare validation run`,
    );
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

function normalize(value: string): string {
  return value.replace(/\r/g, "").trim();
}
