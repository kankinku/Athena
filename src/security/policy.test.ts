import test from "node:test";
import assert from "node:assert/strict";
import { SecurityManager } from "./policy.js";

test("SecurityManager blocks obviously destructive commands by default", () => {
  const security = new SecurityManager();
  const decision = security.evaluateCommand("sudo rm -rf /");

  assert.equal(decision.verdict, "block");
  assert.match(decision.reason, /dangerous command pattern/i);
});

test("SecurityManager marks risky but common remote commands for review", () => {
  const security = new SecurityManager();
  const decision = security.evaluateCommand("ssh gpu1 uptime");

  assert.equal(decision.verdict, "review");
  assert.match(decision.reason, /high-risk command pattern/i);
});

test("SecurityManager allows safe commands that do not match rules", () => {
  const security = new SecurityManager();
  const decision = security.evaluateCommand("python train.py --steps 10");

  assert.equal(decision.verdict, "allow");
});

test("SecurityManager requires approval for reading protected paths", () => {
  const security = new SecurityManager();
  const decision = security.evaluatePath("/home/test/.ssh/id_rsa", "read");

  assert.equal(decision.verdict, "review");
  assert.match(decision.reason, /sensitive read path/i);
});

test("SecurityManager blocks writing to protected paths", () => {
  const security = new SecurityManager();
  const decision = security.evaluatePath("/etc/passwd", "write");

  assert.equal(decision.verdict, "block");
  assert.match(decision.reason, /protected write path/i);
});

test("SecurityManager explicit allow rules override protected-path review", () => {
  const security = new SecurityManager({
    pathPolicy: {
      allowReadPaths: [String.raw`^/home/test/\.ssh/id_rsa$`],
    },
  });

  const decision = security.evaluatePath("/home/test/.ssh/id_rsa", "read");
  assert.equal(decision.verdict, "allow");
});

test("SecurityManager throws in enforce mode for review-worthy commands", () => {
  const security = new SecurityManager({ mode: "enforce" });
  assert.throws(() => security.assertCommandAllowed("ssh gpu1 hostname"), /requires approval/i);
});

test("SecurityManager only audits in audit mode", () => {
  const security = new SecurityManager({ mode: "audit" });
  assert.doesNotThrow(() => security.assertCommandAllowed("ssh gpu1 hostname"));
  assert.doesNotThrow(() => security.assertPathAllowed("/etc/passwd", "write"));
});
