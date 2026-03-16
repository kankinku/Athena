import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();
const CLI_ENV = { ...process.env, ANTHROPIC_API_KEY: "test-key" };

test("operator review CLI safely updates proposal and improvement approval state", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-review-flow-"));
  process.env.ATHENA_HOME = home;

  const [{ SessionStore }, { TeamStore }, { buildResearchReportInput }, { closeDb }] = await Promise.all([
    import("../store/session-store.js"),
    import("./team-store.js"),
    import("./reporting.js"),
    import("../store/database.js"),
  ]);

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");

    // Evidence gate: proposals require at least one claimId before approval.
    // Without a claim link, the proposal cannot be promoted to ready_for_experiment.
    teamStore.saveProposalBrief(session.id, {
      proposalId: "proposal-review",
      title: "Review me",
      summary: "Operator approval should move this safely.",
      targetModules: ["trainer"],
      expectedGain: "moderate gain",
      expectedRisk: "low risk",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 10 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: ["claim-001"],  // Evidence required for approval
    });

    teamStore.saveImprovementProposal(session.id, {
      improvementId: "imp-review",
      runId: "run-1",
      mergeKey: "automation_policy::proposal-review::budget_exceeded",
      title: "Automation Policy Improvement",
      targetArea: "automation_policy",
      hypothesis: "Reduce retries.",
      rationale: "Operator review should promote this safely.",
      expectedBenefit: "Lower wasted spend.",
      priorityScore: 0.9,
      reviewStatus: "queued",
      rollbackPlan: "Revert to previous policy.",
      status: "proposed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    closeDb();

    const proposalOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "operate", "proposal-review", "--kind", "proposal", "--action", "approve"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const improvementOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "operate", "imp-review", "--kind", "improvement", "--action", "promote"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const reportOutput = buildResearchReportInput(session.id, new TeamStore(), new SessionStore(), {
      transcriptLimit: 20,
    });

    assert.match(proposalOutput, /proposal-review\s+status=ready_for_experiment/);
    assert.match(improvementOutput, /imp-review\s+review=promoted status=approved/);
    assert.match(reportOutput, /## Improvement Review Queue/);
    assert.doesNotMatch(reportOutput, /proposal proposal-review: status=candidate/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("evidence gate blocks approval of proposals without claim links", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-review-flow-"));
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
      proposalId: "no-evidence-proposal",
      title: "No evidence",
      summary: "Should be blocked at approval.",
      targetModules: ["trainer"],
      expectedGain: "moderate gain",
      expectedRisk: "low risk",
      codeChangeScope: ["config"],
      status: "candidate",
      experimentBudget: { maxWallClockMinutes: 10 },
      stopConditions: [],
      reconsiderConditions: [],
      claimIds: [],  // No evidence — approval must fail
    });

    closeDb();

    let threw = false;
    try {
      execFileSync(
        process.execPath,
        ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "operate", "no-evidence-proposal", "--kind", "proposal", "--action", "approve"],
        { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
      );
    } catch {
      threw = true;
    }
    assert.ok(threw, "Expected approval of an evidence-free proposal to fail (evidence gate)");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
