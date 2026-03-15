import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("loadPreferences defaults copyFriendly to true when no file exists", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-prefs-"));
  process.env.ATHENA_HOME = home;

  try {
    const { loadPreferences } = await import("./preferences.js");
    const prefs = loadPreferences();
    assert.equal(prefs.copyFriendly, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
