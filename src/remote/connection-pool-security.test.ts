import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { ConnectionPool } from "./connection-pool.js";
import { SecurityManager } from "../security/policy.js";
import { getExitFilePath } from "./local-runtime.js";

test("ConnectionPool rejects blocked commands before execution", async () => {
  const pool = new ConnectionPool(new SecurityManager({ mode: "enforce" }));

  await assert.rejects(
    pool.exec("local", "sudo rm -rf /"),
    /Security policy blocked this command/i,
  );
});

test("ConnectionPool still runs safe local commands under security floor", async () => {
  const pool = new ConnectionPool(new SecurityManager({ mode: "enforce" }));
  const result = await pool.exec("local", `"${process.execPath}" -e "console.log('secure-ok')"`, 10_000);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /secure-ok/);
});

test("ConnectionPool rejects protected tail reads before execution", async () => {
  const pool = new ConnectionPool(new SecurityManager({ mode: "enforce" }));

  await assert.rejects(
    pool.tailFile("local", "/home/test/.ssh/id_rsa", 20),
    /requires approval/i,
  );
});

test("ConnectionPool confines background logs to a managed path", async () => {
  const pool = new ConnectionPool(new SecurityManager({ mode: "enforce" }));
  const requestedPath = join(tmpdir(), "athena-log-escape';echo hacked;'.log");
  const proc = await pool.execBackground("local", "echo secure-background", requestedPath);

  assert.notEqual(proc.logPath, requestedPath);
  assert.match(proc.logPath, /athena-logs/i);

  for (let i = 0; i < 20; i++) {
    if (existsSync(getExitFilePath(proc.logPath))) break;
    await sleep(100);
  }

  assert.equal(existsSync(requestedPath), false);
  assert.match(readFileSync(proc.logPath, "utf8"), /secure-background/);

  rmSync(proc.logPath, { force: true });
  rmSync(getExitFilePath(proc.logPath), { force: true });
});
