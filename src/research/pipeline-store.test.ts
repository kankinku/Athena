import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("PipelineStore: save, load, getById, listActive, updateState", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-pipeline-store-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { PipelineStore }] = await Promise.all([
      import("../store/database.js"),
      import("./pipeline-store.js"),
    ]);
    const store = new PipelineStore();

    const ctx = {
      pipelineId: "pipe_1",
      proposalId: "prop_1",
      sessionId: "sess_1",
      currentState: "draft" as const,
      stages: [{ stage: "impact" as const, status: "running" as const, startedAt: Date.now() }],
      auditTrail: [],
    };

    // save + load
    store.save(ctx);
    const loaded = store.load("prop_1");
    assert.ok(loaded);
    assert.equal(loaded.pipelineId, "pipe_1");
    assert.equal(loaded.currentState, "draft");

    // getById
    const byId = store.getById("pipe_1");
    assert.ok(byId);
    assert.equal(byId.proposalId, "prop_1");

    // listActive (non-terminal)
    const active = store.listActive();
    assert.equal(active.length, 1);

    // updateState to terminal
    store.updateState("pipe_1", "merged");
    const updated = store.getById("pipe_1");
    assert.ok(updated);
    assert.equal(updated.currentState, "merged");

    // listActive should be empty now
    const afterMerge = store.listActive();
    assert.equal(afterMerge.length, 0);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("PipelineStore: upsert updates existing pipeline", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-pipeline-upsert-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { PipelineStore }] = await Promise.all([
      import("../store/database.js"),
      import("./pipeline-store.js"),
    ]);
    const store = new PipelineStore();

    const ctx = {
      pipelineId: "pipe_u",
      proposalId: "prop_u",
      sessionId: "sess_u",
      currentState: "draft" as const,
      stages: [],
      auditTrail: [],
    };

    store.save(ctx);
    store.save({ ...ctx, currentState: "agents-summoned" as const });

    const loaded = store.load("prop_u");
    assert.ok(loaded);
    assert.equal(loaded.currentState, "agents-summoned");

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
