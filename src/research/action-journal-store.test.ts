import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("ActionJournalStore preserves lifecycle history and returns latest action by dedupe key", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-action-journal-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { ActionJournalStore }] = await Promise.all([
      import("../store/database.js"),
      import("./action-journal-store.js"),
    ]);
    const store = new ActionJournalStore();

    store.saveAction({
      actionId: "action-1",
      sessionId: "session-1",
      runId: "run-1",
      actionType: "session_tick",
      state: "running",
      dedupeKey: "tick:run-1",
      summary: "tick started",
      createdAt: 1,
      updatedAt: 1,
      heartbeatAt: 1,
    });
    store.saveAction({
      actionId: "action-2",
      sessionId: "session-1",
      runId: "run-1",
      actionType: "session_tick",
      state: "committed",
      dedupeKey: "tick:run-1",
      summary: "tick committed",
      result: { ok: true },
      createdAt: 2,
      updatedAt: 2,
      heartbeatAt: 2,
    });

    const actions = store.listRunActions("session-1", "run-1");
    assert.equal(actions.length, 2);
    assert.equal(actions[0]?.state, "committed");
    assert.equal(actions[1]?.state, "running");
    assert.deepEqual(store.getActionByDedupeKey("session-1", "run-1", "tick:run-1")?.result, { ok: true });

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
