import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();

test("history command outputs timeline header", () => {
  const home = mkdtempSync(join(tmpdir(), "athena-history-"));

  try {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "history"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    // Empty DB → "이력 없음" or "History Timeline"
    const hasContent = output.includes("이력 없음") || output.includes("History Timeline");
    assert.ok(hasContent, `Expected history output, got: ${output.slice(0, 200)}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("history command accepts --limit flag", () => {
  const home = mkdtempSync(join(tmpdir(), "athena-history-limit-"));

  try {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "history", "--limit", "5"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    // Should not crash
    assert.ok(typeof output === "string");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
