import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("IncidentStore saves and filters open incidents", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-incident-store-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { IncidentStore }] = await Promise.all([
      import("../store/database.js"),
      import("./incident-store.js"),
    ]);
    const store = new IncidentStore();

    store.saveIncident({
      incidentId: "incident-1",
      sessionId: "session-1",
      runId: "run-1",
      type: "automation_block",
      severity: "warning",
      summary: "Automation blocked",
      status: "open",
      actionRequired: true,
      createdAt: 1,
      updatedAt: 1,
    });
    store.saveIncident({
      incidentId: "incident-2",
      sessionId: "session-1",
      runId: "run-2",
      type: "budget_exceeded",
      severity: "critical",
      summary: "Budget exceeded",
      status: "resolved",
      actionRequired: false,
      createdAt: 2,
      updatedAt: 2,
    });

    const open = store.listOpenIncidents("session-1");
    assert.equal(open.length, 1);
    assert.equal(open[0]?.incidentId, "incident-1");
    assert.equal(store.resolveRunIncidents("session-1", "run-1"), 1);
    assert.equal(store.listOpenIncidents("session-1").length, 0);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
