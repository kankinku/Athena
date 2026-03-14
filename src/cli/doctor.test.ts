import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();

test("doctor command runs without unix-only shell assumptions", () => {
  const home = mkdtempSync(join(tmpdir(), "athena-doctor-"));

  try {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "doctor"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    assert.match(output, /athena doctor/i);
    assert.match(output, /Auth/);
    assert.match(output, /Machines/);
    assert.match(output, /Storage/);
    assert.match(output, /Dependencies/);
    assert.doesNotMatch(output, /could not check/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
