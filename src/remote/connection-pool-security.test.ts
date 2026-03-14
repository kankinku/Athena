import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionPool } from "./connection-pool.js";
import { SecurityManager } from "../security/policy.js";

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
