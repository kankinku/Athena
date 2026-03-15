import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("InterfaceWatcher: start, stop, isRunning lifecycle", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-iw-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { InterfaceWatcher }] = await Promise.all([
      import("../store/database.js"),
      import("./interface-watcher.js"),
    ]);

    const violations: unknown[] = [];
    const watcher = new InterfaceWatcher("prop_test", {
      onViolation: (v) => violations.push(v),
    });

    assert.equal(watcher.isRunning(), false);

    // Start with no modules → still marks as running
    watcher.start([], home);
    assert.equal(watcher.isRunning(), true);
    assert.equal(watcher.getViolations().length, 0);

    // Stop
    watcher.stop();
    assert.equal(watcher.isRunning(), false);

    // Double-start is safe
    watcher.start([], home);
    watcher.start([], home); // should not error
    watcher.stop();

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("InterfaceWatcher: getViolations returns copy", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-iw-copy-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { InterfaceWatcher }] = await Promise.all([
      import("../store/database.js"),
      import("./interface-watcher.js"),
    ]);

    const watcher = new InterfaceWatcher("prop_test", {
      onViolation: () => {},
    });

    const v1 = watcher.getViolations();
    const v2 = watcher.getViolations();
    assert.notStrictEqual(v1, v2); // different array references
    assert.deepEqual(v1, v2);

    watcher.stop();
    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
