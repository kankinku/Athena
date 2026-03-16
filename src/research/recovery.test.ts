import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type TeamRun = { id: string; status: string };

function createRecoverInterruptedRuns(
  teamStore: { listRecentTeamRuns: (sessionId: string, limit: number) => TeamRun[] },
  automationManager: { recoverSession: (sessionId: string) => Promise<Array<{ id: string }>> },
) {
  return async (sessionId: string): Promise<string[]> => {
    const runs = teamStore.listRecentTeamRuns(sessionId, 50);
    const interrupted = runs.filter((r) => r.status === "active");
    if (interrupted.length === 0) return [];
    const recovered = await automationManager.recoverSession(sessionId);
    return recovered.map((r) => r.id);
  };
}

async function readBackgroundExitCodeWithPidFallback(logPath: string): Promise<number | null> {
  const exitPath = `${logPath}.exit`;
  try {
    const value = readFileSync(exitPath, "utf8");
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    const pidPath = exitPath.replace(/\.exit$/, ".pid");
    try {
      const pidValue = readFileSync(pidPath, "utf8");
      const pid = Number.parseInt(pidValue.trim(), 10);
      if (!Number.isNaN(pid)) {
        try {
          process.kill(pid, 0);
          return null;
        } catch {
          try {
            writeFileSync(exitPath, "1", "utf8");
            unlinkSync(pidPath);
          } catch {
            // best effort
          }
          return 1;
        }
      }
    } catch {
      // no pid fallback available
    }
    return null;
  }
}

describe("restart recovery behavior", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "athena-recovery-test-"));
  });

  afterEach(() => {
    mock.restoreAll();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("recoverInterruptedRuns finds and recovers active runs", async () => {
    const listRecentTeamRuns = mock.fn<(sessionId: string, limit: number) => TeamRun[]>(() => [
      { id: "run-completed", status: "completed" },
      { id: "run-active", status: "active" },
      { id: "run-failed", status: "failed" },
    ]);
    const recoverSession = mock.fn<(sessionId: string) => Promise<Array<{ id: string }>>>(
      async () => [{ id: "run-active" }, { id: "run-resumed" }],
    );

    const recoverInterruptedRuns = createRecoverInterruptedRuns(
      { listRecentTeamRuns },
      { recoverSession },
    );

    const recoveredIds = await recoverInterruptedRuns("session-1");

    assert.deepEqual(recoveredIds, ["run-active", "run-resumed"]);
    assert.equal(listRecentTeamRuns.mock.calls.length, 1);
    assert.deepEqual(listRecentTeamRuns.mock.calls[0]?.arguments, ["session-1", 50]);
    assert.equal(recoverSession.mock.calls.length, 1);
    assert.deepEqual(recoverSession.mock.calls[0]?.arguments, ["session-1"]);
  });

  it("recoverInterruptedRuns returns an empty array when no interrupted runs exist", async () => {
    const listRecentTeamRuns = mock.fn<(sessionId: string, limit: number) => TeamRun[]>(() => []);
    const recoverSession = mock.fn<(sessionId: string) => Promise<Array<{ id: string }>>>(
      async () => [{ id: "unexpected" }],
    );

    const recoverInterruptedRuns = createRecoverInterruptedRuns(
      { listRecentTeamRuns },
      { recoverSession },
    );

    const recoveredIds = await recoverInterruptedRuns("session-empty");

    assert.deepEqual(recoveredIds, []);
    assert.equal(listRecentTeamRuns.mock.calls.length, 1);
    assert.equal(recoverSession.mock.calls.length, 0);
  });

  it("recovery skips completed and failed runs", async () => {
    const listRecentTeamRuns = mock.fn<(sessionId: string, limit: number) => TeamRun[]>(() => [
      { id: "run-1", status: "completed" },
      { id: "run-2", status: "failed" },
    ]);
    const recoverSession = mock.fn<(sessionId: string) => Promise<Array<{ id: string }>>>(
      async () => [{ id: "should-not-run" }],
    );

    const recoverInterruptedRuns = createRecoverInterruptedRuns(
      { listRecentTeamRuns },
      { recoverSession },
    );

    const recoveredIds = await recoverInterruptedRuns("session-skip");

    assert.deepEqual(recoveredIds, []);
    assert.deepEqual(listRecentTeamRuns.mock.calls[0]?.arguments, ["session-skip", 50]);
    assert.equal(recoverSession.mock.calls.length, 0);
  });

  it("pid fallback detects dead process and synthesizes exit code 1", async () => {
    const logPath = join(tempDir, "dead-process.log");
    const exitPath = `${logPath}.exit`;
    const pidPath = `${logPath}.pid`;

    writeFileSync(pidPath, "424242", "utf8");
    const killMock = mock.method(process, "kill", () => {
      throw new Error("ESRCH");
    });

    const code = await readBackgroundExitCodeWithPidFallback(logPath);

    assert.equal(code, 1);
    assert.equal(killMock.mock.calls.length, 1);
    assert.deepEqual(killMock.mock.calls[0]?.arguments, [424242, 0]);
    assert.equal(readFileSync(exitPath, "utf8"), "1");
    assert.equal(existsSync(pidPath), false);
  });

  it("pid fallback returns null while process is still running", async () => {
    const logPath = join(tempDir, "alive-process.log");
    const exitPath = `${logPath}.exit`;
    const pidPath = `${logPath}.pid`;

    writeFileSync(pidPath, "7777", "utf8");
    const killMock = mock.method(process, "kill", () => true);

    const code = await readBackgroundExitCodeWithPidFallback(logPath);

    assert.equal(code, null);
    assert.equal(killMock.mock.calls.length, 1);
    assert.deepEqual(killMock.mock.calls[0]?.arguments, [7777, 0]);
    assert.equal(existsSync(exitPath), false);
    assert.equal(existsSync(pidPath), true);
  });
});
