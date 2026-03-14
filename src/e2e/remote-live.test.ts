import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { ConnectionPool } from "../remote/connection-pool.js";
import { FileSync } from "../remote/file-sync.js";
import type { RemoteMachine } from "../remote/types.js";

function getRemoteMachineFromEnv(): RemoteMachine | null {
  const host = process.env.ATHENA_TEST_SSH_HOST;
  const username = process.env.ATHENA_TEST_SSH_USER;
  if (!host || !username) {
    return null;
  }

  const keyPath = process.env.ATHENA_TEST_SSH_KEY;
  const authMethod = keyPath ? "key" : "agent";
  return {
    id: process.env.ATHENA_TEST_SSH_MACHINE_ID ?? "remote-live",
    host,
    port: Number.parseInt(process.env.ATHENA_TEST_SSH_PORT ?? "22", 10),
    username,
    authMethod,
    keyPath: keyPath || undefined,
  };
}

const remoteMachine = getRemoteMachineFromEnv();
const skipReason = remoteMachine
  ? false
  : "Set ATHENA_TEST_SSH_HOST and ATHENA_TEST_SSH_USER (optionally ATHENA_TEST_SSH_KEY / ATHENA_TEST_SSH_PORT) to run live remote E2E.";

test("live remote SSH e2e: exec, background run, and sync work against a real host", { skip: skipReason }, async () => {
  const machine = remoteMachine!;
  const pool = new ConnectionPool();
  const fileSync = new FileSync();
  pool.addMachine(machine);
  fileSync.addMachine(machine);

  const localDir = mkdtempSync(join(tmpdir(), "athena-remote-live-"));
  const localFile = join(localDir, "payload.txt");
  const downloadedFile = join(localDir, "payload.downloaded.txt");
  const remoteDir = `/tmp/athena-remote-live-${Date.now()}`;
  const remoteFile = `${remoteDir}/payload.txt`;
  const remoteDownloaded = `${remoteDir}/payload.copy.txt`;
  writeFileSync(localFile, "phase7-live-sync\n", "utf8");

  try {
    await pool.connect(machine.id);

    const execResult = await pool.exec(machine.id, "printf 'remote-ok\\n'");
    assert.equal(execResult.exitCode, 0);
    assert.equal(execResult.stdout.trim(), "remote-ok");

    await pool.exec(machine.id, `mkdir -p ${remoteDir}`);
    await fileSync.upload(machine.id, localFile, remoteFile);
    const catResult = await pool.exec(machine.id, `cat ${remoteFile}`);
    assert.equal(catResult.stdout.trim(), "phase7-live-sync");

    const bg = await pool.execBackground(machine.id, "printf 'bg-start\\n'; sleep 1; printf 'bg-done\\n'", `${remoteDir}/bg.log`);
    assert.ok(bg.pid > 0);

    let exitCode: number | null = null;
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      exitCode = await pool.readBackgroundExitCode(machine.id, bg.logPath);
      if (exitCode !== null) break;
    }

    assert.equal(exitCode, 0);
    const tail = await pool.tailFile(machine.id, bg.logPath, 10);
    assert.match(tail, /bg-done/);

    await pool.exec(machine.id, `cp ${remoteFile} ${remoteDownloaded}`);
    await fileSync.download(machine.id, remoteDownloaded, downloadedFile);
    assert.equal(readFileSync(downloadedFile, "utf8").trim(), "phase7-live-sync");
  } finally {
    await pool.exec(machine.id, `rm -rf ${remoteDir}`).catch(() => {});
    pool.disconnectAll();
    rmSync(localDir, { recursive: true, force: true });
  }
});
