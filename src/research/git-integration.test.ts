import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("GitIntegration: constructor accepts custom repoPath", async () => {
  const { GitIntegration } = await import("./git-integration.js");
  const gi = new GitIntegration("/some/path");
  // Should not throw on construction
  assert.ok(gi);
});

test("GitIntegration: isGitRepo returns false for non-git directory", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "athena-git-test-"));
  try {
    const { GitIntegration } = await import("./git-integration.js");
    const gi = new GitIntegration(tmpDir);
    const result = await gi.isGitRepo();
    assert.equal(result, false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("GitIntegration: isGitRepo returns true for a git directory", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "athena-git-repo-"));
  try {
    execFileSync("git", ["init"], { cwd: tmpDir });
    const { GitIntegration } = await import("./git-integration.js");
    const gi = new GitIntegration(tmpDir);
    const result = await gi.isGitRepo();
    assert.equal(result, true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("GitIntegration: getCurrentBranch and getStatus on fresh git repo", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "athena-git-status-"));
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });

    const { GitIntegration } = await import("./git-integration.js");
    const gi = new GitIntegration(tmpDir);

    const branch = await gi.getCurrentBranch();
    assert.equal(branch, "main");

    const status = await gi.getStatus();
    assert.equal(status.branch, "main");
    assert.equal(status.isClean, true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("GitIntegration: preparePR restores the original branch when commit preparation fails", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "athena-git-pr-restore-"));
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: tmpDir });

    const { GitIntegration } = await import("./git-integration.js");
    const gi = new GitIntegration(tmpDir);

    const result = await gi.preparePR({
      title: "Broken PR prep",
      body: "This should fail before commit",
      sourceBranch: "main",
      targetBranch: "main",
      proposalId: "proposal-restore",
      changedPaths: ["does-not-exist.txt"],
    });

    assert.equal(result.success, false);
    assert.equal(result.branchCreated, true);
    assert.match(result.message, /restored/i);
    assert.equal(await gi.getCurrentBranch(), "main");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
