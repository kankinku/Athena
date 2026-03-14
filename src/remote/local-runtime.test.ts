import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ConnectionPool } from "./connection-pool.js";
import {
  createTempLogPath,
  getExitFilePath,
  getLocalShell,
} from "./local-runtime.js";
import { resolveFileSyncTransport } from "./file-sync.js";

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      readFileSync(path, "utf8");
      return;
    } catch {
      await sleep(50);
    }
  }
  throw new Error(`Timed out waiting for file: ${path}`);
}

test("local runtime picks the current platform shell and temp log path", () => {
  assert.equal(getLocalShell("win32"), process.env.ComSpec ?? "cmd.exe");
  assert.equal(getLocalShell("linux"), process.env.SHELL ?? "/bin/bash");

  const logPath = createTempLogPath("athena-test");
  assert.ok(logPath.startsWith(tmpdir()));
  assert.match(logPath, /athena-test-/);
});

test("file sync falls back to scp on Windows when rsync is unavailable", async () => {
  const transport = await resolveFileSyncTransport("win32", async (command) => command === "scp");
  assert.equal(transport, "scp");
});

test("file sync keeps rsync as the required transport on unix platforms", async () => {
  await assert.rejects(
    resolveFileSyncTransport("linux", async () => false),
    /requires `rsync`/i,
  );
});

test("connection pool runs local commands and captures background logs cross-platform", async () => {
  const pool = new ConnectionPool();

  const foreground = await pool.exec(
    "local",
    `"${process.execPath}" -e "console.log('foreground-ok')"`,
    10_000,
  );

  assert.equal(foreground.exitCode, 0);
  assert.match(foreground.stdout, /foreground-ok/);

  const background = await pool.execBackground(
    "local",
    "echo background-ok",
  );

  assert.ok(background.logPath.startsWith(tmpdir()));
  await waitForFile(getExitFilePath(background.logPath));
  await sleep(250);

  const log = readFileSync(background.logPath, "utf8");
  assert.match(log, /background-ok/);

  const tail = await pool.tailFile("local", background.logPath, 5);
  assert.match(tail, /background-ok/);

  assert.equal(await pool.isProcessRunning("local", background.pid), false);

  rmSync(background.logPath, { force: true });
  rmSync(getExitFilePath(background.logPath), { force: true });
});
