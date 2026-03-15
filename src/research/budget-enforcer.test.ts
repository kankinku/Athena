import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("BudgetEnforcer: startTracking + recordFileChange + checkBudget", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-budget-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { BudgetEnforcer }] = await Promise.all([
      import("../store/database.js"),
      import("./budget-enforcer.js"),
    ]);
    const enforcer = new BudgetEnforcer();

    enforcer.startTracking("task_1", "prop_1", "mod-be", "agent:be", {
      maxWallClockMinutes: 60,
      maxRetries: 3,
      maxFilesChanged: 2,
      maxCostUsd: 10,
    });

    // First file
    const r1 = enforcer.recordFileChange("task_1", "src/a.ts");
    assert.equal(r1.exceeded, false);
    assert.equal(r1.details.filesChanged, 1);

    // Second file
    const r2 = enforcer.recordFileChange("task_1", "src/b.ts");
    assert.equal(r2.exceeded, false);
    assert.equal(r2.details.filesChanged, 2);

    // Third file → exceeds maxFilesChanged (2)
    const r3 = enforcer.recordFileChange("task_1", "src/c.ts");
    assert.equal(r3.exceeded, true);
    assert.ok(r3.exceedTypes.includes("files"));

    // Same file should not increase count
    const r4 = enforcer.recordFileChange("task_1", "src/a.ts");
    assert.equal(r4.details.filesChanged, 3); // 여전히 3

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("BudgetEnforcer: recordRetry + recordCost", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-budget-retry-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { BudgetEnforcer }] = await Promise.all([
      import("../store/database.js"),
      import("./budget-enforcer.js"),
    ]);
    const enforcer = new BudgetEnforcer();

    enforcer.startTracking("task_r", "prop_r", "mod-fe", "agent:fe", {
      maxWallClockMinutes: 60,
      maxRetries: 2,
      maxFilesChanged: 100,
      maxCostUsd: 5,
    });

    // Retries
    enforcer.recordRetry("task_r");
    enforcer.recordRetry("task_r");
    const r = enforcer.recordRetry("task_r"); // 3 > 2
    assert.equal(r.exceeded, true);
    assert.ok(r.exceedTypes.includes("retries"));
    assert.equal(r.details.retriesUsed, 3);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("BudgetEnforcer: enforceBudget blocks and creates audit event", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-budget-enforce-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { BudgetEnforcer }, { AuditEventStore }] = await Promise.all([
      import("../store/database.js"),
      import("./budget-enforcer.js"),
      import("./audit-event-store.js"),
    ]);
    const auditStore = new AuditEventStore();
    const enforcer = new BudgetEnforcer({ auditStore });

    enforcer.startTracking("task_e", "prop_e", "mod-be", "agent:be", {
      maxWallClockMinutes: 60,
      maxRetries: 0, // will exceed on first retry
      maxFilesChanged: 100,
      maxCostUsd: 100,
    });

    enforcer.recordRetry("task_e"); // retries: 1 > 0

    const blocked = enforcer.enforceBudget("task_e", "prop_e");
    assert.equal(blocked, true);

    // Verify audit event was created
    const events = auditStore.listByType("budget_exceeded");
    assert.ok(events.length >= 1);
    assert.equal(events[0].proposalId, "prop_e");

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
