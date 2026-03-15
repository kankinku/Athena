import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("AuditEventStore: save, listRecent, listByProposal, listByType, summarize", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-audit-evt-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { AuditEventStore }] = await Promise.all([
      import("../store/database.js"),
      import("./audit-event-store.js"),
    ]);
    const store = new AuditEventStore();

    const evt1 = {
      eventId: "evt_1",
      eventType: "proposal_created",
      proposalId: "prop_1",
      details: { actor: "agent:backend" },
      severity: "info" as const,
      timestamp: 1000,
    };
    const evt2 = {
      eventId: "evt_2",
      eventType: "meeting_concluded",
      proposalId: "prop_1",
      meetingId: "mtg_1",
      details: { actor: "system" },
      severity: "warning" as const,
      timestamp: 2000,
    };
    const evt3 = {
      eventId: "evt_3",
      eventType: "proposal_created",
      proposalId: "prop_2",
      details: { actor: "agent:frontend" },
      severity: "info" as const,
      timestamp: 3000,
    };

    store.save(evt1);
    store.save(evt2);
    store.save(evt3);

    // listRecent
    const recent = store.listRecent(10);
    assert.equal(recent.length, 3);
    assert.equal(recent[0].eventId, "evt_3"); // 최신순

    // listByProposal
    const byProposal = store.listByProposal("prop_1");
    assert.equal(byProposal.length, 2);
    assert.equal(byProposal[0].eventId, "evt_1"); // 시간순 ASC

    // listByType
    const byType = store.listByType("proposal_created");
    assert.equal(byType.length, 2);

    // summarize
    const summary = store.summarize();
    assert.equal(summary.total, 3);
    assert.equal(summary.proposalCount, 2);
    assert.equal(summary.byType["proposal_created"], 2);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("AuditEventStore: saveBatch handles batch insert", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-audit-batch-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { AuditEventStore }] = await Promise.all([
      import("../store/database.js"),
      import("./audit-event-store.js"),
    ]);
    const store = new AuditEventStore();

    const events = Array.from({ length: 5 }, (_, i) => ({
      eventId: `batch_${i}`,
      eventType: "test_event",
      details: {},
      severity: "info" as const,
      timestamp: 1000 + i,
    }));

    store.saveBatch(events);
    const all = store.listRecent(10);
    assert.equal(all.length, 5);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
