import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("ChangeDetector: fromGitDiff creates DetectedChange from git diff output", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-change-det-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { ChangeDetector }] = await Promise.all([
      import("../store/database.js"),
      import("./change-detector.js"),
    ]);
    const detector = new ChangeDetector();

    // Normal diff output
    const change = detector.fromGitDiff("src/api/user.ts\nsrc/api/auth.ts\n");
    assert.ok(change);
    assert.equal(change.source, "git-diff");
    assert.equal(change.changedPaths.length, 2);
    assert.ok(change.title.includes("2"));

    // Empty diff
    const empty = detector.fromGitDiff("");
    assert.equal(empty, null);

    // Whitespace only
    const ws = detector.fromGitDiff("  \n  \n");
    assert.equal(ws, null);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("ChangeDetector: fromTestFailure, fromPerformanceRegression, fromOpsAlert, fromAgentSuggestion", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-change-det2-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { ChangeDetector }] = await Promise.all([
      import("../store/database.js"),
      import("./change-detector.js"),
    ]);
    const detector = new ChangeDetector();

    // fromTestFailure
    const testFail = detector.fromTestFailure(["test/a.test.ts"], "AssertionError");
    assert.ok(testFail);
    assert.equal(testFail.source, "test-failure");
    assert.equal(testFail.changedPaths.length, 1);

    const noTests = detector.fromTestFailure([]);
    assert.equal(noTests, null);

    // fromPerformanceRegression
    const perf = detector.fromPerformanceRegression("latency_p99", 500, 200, ["src/api.ts"]);
    assert.ok(perf);
    assert.equal(perf.source, "performance-regression");

    const noPerf = detector.fromPerformanceRegression("latency_p99", 100, 200, ["src/api.ts"]);
    assert.equal(noPerf, null);

    // fromOpsAlert
    const ops = detector.fromOpsAlert("high-error-rate", "Error spike", ["src/handler.ts"]);
    assert.ok(ops);
    assert.equal(ops.source, "ops-alert");

    const noOps = detector.fromOpsAlert("type", "msg", []);
    assert.equal(noOps, null);

    // fromAgentSuggestion
    const suggestion = detector.fromAgentSuggestion("agent:be", "Refactor", "refactor API", ["src/api.ts"]);
    assert.ok(suggestion);
    assert.equal(suggestion.source, "agent-suggestion");

    const noSuggestion = detector.fromAgentSuggestion("agent:be", "Refactor", "desc", []);
    assert.equal(noSuggestion, null);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("ChangeDetector: createProposalFromChange creates proposal and detects duplicates", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-change-prop-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { ChangeDetector }] = await Promise.all([
      import("../store/database.js"),
      import("./change-detector.js"),
    ]);
    const detector = new ChangeDetector();
    const sessionId = "sess_test";

    const change = detector.fromGitDiff("src/mod.ts\n");
    assert.ok(change);

    const proposal = detector.createProposalFromChange(sessionId, change);
    assert.ok(proposal);
    assert.ok(proposal.proposalId);

    // Duplicate detection — same source + same paths
    const dup = detector.createProposalFromChange(sessionId, change);
    assert.equal(dup, null);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
