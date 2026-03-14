import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("RunLeaseStore rejects competing owners until the lease is released", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-run-lease-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { RunLeaseStore }] = await Promise.all([
      import("../store/database.js"),
      import("./run-lease-store.js"),
    ]);
    const store = new RunLeaseStore();

    const lease = store.acquireLease("session-1", "run-1", "owner-a", 300_000);
    const competing = store.acquireLease("session-1", "run-1", "owner-b", 300_000);
    const heartbeat = store.heartbeatLease("run-1", "owner-a", 300_000);
    const released = store.releaseLease("run-1", "owner-a");
    const takeover = store.acquireLease("session-1", "run-1", "owner-b", 300_000);

    assert.equal(lease?.ownerId, "owner-a");
    assert.equal(competing, null);
    assert.equal(heartbeat?.ownerId, "owner-a");
    assert.equal(released?.status, "released");
    assert.equal(takeover?.ownerId, "owner-b");

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
