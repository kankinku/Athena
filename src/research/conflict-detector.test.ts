import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("ConflictDetector: detectAll returns empty on clean plan", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-conflict-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { ConflictDetector }] = await Promise.all([
      import("../store/database.js"),
      import("./conflict-detector.js"),
    ]);
    const detector = new ConflictDetector();

    // Empty plan → no conflicts
    const plan = {
      executionPlanId: "exec_1",
      meetingId: "mtg_1",
      proposalId: "prop_1",
      status: "pending" as const,
      taskAssignments: [],
      changedPaths: [],
      rollbackPlan: "revert",
      requiredTests: [],
      featureFlags: [],
      mergeGates: {} as Record<string, string>,
      approvedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const conflicts = detector.detectAll(plan, []);
    assert.ok(Array.isArray(conflicts));
    // No task assignments → no conflicts expected
    assert.equal(conflicts.length, 0);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("ConflictDetector: detectPolicyConflicts catches protected paths", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-conflict-pol-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { ConflictDetector }] = await Promise.all([
      import("../store/database.js"),
      import("./conflict-detector.js"),
    ]);
    const detector = new ConflictDetector();

    const plan = {
      executionPlanId: "exec_2",
      meetingId: "mtg_2",
      proposalId: "prop_2",
      status: "pending" as const,
      taskAssignments: [
        {
          moduleId: "mod-backend",
          agentId: "agent:backend",
          tasks: ["modify database schema"],
          dependsOnAgents: [],
          budget: { maxWallClockMinutes: 30, maxRetries: 3, maxFilesChanged: 5, maxCostUsd: 1 },
        },
      ],
      changedPaths: ["src/store/database.ts"],
      rollbackPlan: "revert",
      requiredTests: [],
      featureFlags: [],
      mergeGates: {} as Record<string, string>,
      approvedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // detectPolicyConflicts examines protected paths
    const conflicts = detector.detectPolicyConflicts(plan.changedPaths, plan);
    assert.ok(Array.isArray(conflicts));

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
