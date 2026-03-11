import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();

test("research CLI renders workflow and automation operator views from persisted state", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-regression-"));
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
    const run = teamStore.createTeamRun(session.id, "CLI regression goal");

    teamStore.transitionWorkflow(run.id, "ready", "ready for review");
    teamStore.transitionWorkflow(run.id, "approved", "approved by operator");
    teamStore.configureAutomation(run.id, {
      automationPolicy: {
        mode: "overnight-auto",
        requireProposalApproval: false,
        requireExperimentApproval: false,
        requireRevisitApproval: true,
        maxAutoExperiments: 3,
      },
    });
    teamStore.recordAutomationCheckpoint(run.id, "overnight checkpoint");

    teamStore.saveImprovementProposal(session.id, {
      improvementId: "imp-cli",
      runId: run.id,
      mergeKey: "automation_policy::run-level::budget_exceeded",
      title: "Automation Policy Improvement: CLI regression goal",
      targetArea: "automation_policy",
      hypothesis: "Tighten automation policy before overnight runs.",
      rationale: "Checkpoint and retry behavior should be reviewable.",
      expectedBenefit: "Lower wasted spend and faster overnight recovery.",
      priorityScore: 0.9,
      reviewStatus: "queued",
      rollbackPlan: "Revert to manual approvals.",
      status: "proposed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    closeDb();

    const workflowOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "workflow", run.id],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    const automationOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "automation", run.id],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    const improvementsOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "improvements", run.id],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    assert.match(workflowOutput, /transition\s+draft -> ready reason=ready for review/);
    assert.match(workflowOutput, /transition\s+ready -> approved reason=approved by operator/);
    assert.match(automationOutput, /mode=overnight-auto/);
    assert.match(automationOutput, /checkpoint_record\s+approved\/collection reason=overnight checkpoint/);
    assert.match(improvementsOutput, /priority=0.90/);
    assert.match(improvementsOutput, /review=queued/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
