import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
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

test("SecurityManager requires approval when machine is outside the capability envelope", () => {
  const security = new SecurityManager({
    capabilityPolicy: {
      allowedMachineIds: ["local"],
      allowedToolCategories: ["shell"],
    },
  });

  const decision = security.evaluateCommand("python train.py", {
    machineId: "gpu-1",
    toolFamily: "shell",
  });

  assert.equal(decision.verdict, "review");
  assert.match(decision.reason, /allowed machines/i);
});

test("SecurityManager blocks writes outside configured capability path roots", () => {
  const security = new SecurityManager({
    capabilityPolicy: {
      allowedWritePathRoots: ["/workspace/project/tmp"],
    },
  });

  const blocked = security.evaluatePath("/workspace/project/secrets.txt", "write", {
    machineId: "local",
    toolFamily: "filesystem",
  });
  const allowed = security.evaluatePath("/workspace/project/tmp/out.txt", "write", {
    machineId: "local",
    toolFamily: "filesystem",
  });

  assert.equal(blocked.verdict, "block");
  assert.match(blocked.reason, /outside approved write roots/i);
  assert.equal(allowed.verdict, "allow");
});

test("SecurityManager requires approval for remote path reads when network access is disabled", () => {
  const security = new SecurityManager({
    capabilityPolicy: {
      allowNetworkAccess: false,
    },
  });

  const decision = security.evaluatePath("/workspace/project/log.txt", "read", {
    machineId: "gpu-1",
    toolFamily: "filesystem",
  });

  assert.equal(decision.verdict, "review");
  assert.match(decision.reason, /network or remote path access/i);
});

test("SecurityManager blocks destructive path writes when destructive actions are disabled", () => {
  const security = new SecurityManager({
    capabilityPolicy: {
      allowDestructiveActions: false,
    },
  });

  const decision = security.evaluatePath("/workspace/project/tmp/out.txt", "write", {
    machineId: "local",
    toolFamily: "filesystem",
  });

  assert.equal(decision.verdict, "block");
  assert.match(decision.reason, /destructive path action/i);
});

test("SecurityManager enforces role-based operator actions", () => {
  const security = new SecurityManager({
    rolePolicy: {
      actorBindings: [
        { actorId: "ops-reviewer", actorTier: "operator_reviewer" },
        { actorId: "ops-viewer", actorTier: "operator_observer" },
      ],
    },
  });

  const allowed = security.evaluateAction("approve", {
    actorRole: "operator",
    actorId: "ops-reviewer",
  });
  const blocked = security.evaluateAction("rollback", {
    actorRole: "operator",
    actorId: "ops-viewer",
  });

  assert.equal(allowed.verdict, "allow");
  assert.equal(blocked.verdict, "block");
  assert.match(blocked.reason, /actor tier operator_observer/i);
});

test("SecurityManager protects Athena secret config files by default", () => {
  const security = new SecurityManager();

  const hubConfig = security.evaluatePath(join(homedir(), ".athena", "hub.json"), "read");
  const machinesConfig = security.evaluatePath(join(homedir(), ".athena", "machines.json"), "write");

  assert.equal(hubConfig.verdict, "review");
  assert.match(hubConfig.reason, /sensitive read path/i);
  assert.equal(machinesConfig.verdict, "block");
  assert.match(machinesConfig.reason, /protected write path/i);
});

test("SecurityManager applies default actor tiers even without an explicit role policy", () => {
  const security = new SecurityManager();

  const operator = security.evaluateAction("approve", {
    actorRole: "operator",
  });
  const agent = security.evaluateAction("rollback", {
    actorRole: "agent",
  });

  assert.equal(operator.verdict, "allow");
  assert.equal(agent.verdict, "block");
});

test("web_fetch honors the network capability policy", async () => {
  const { createWebFetchTool } = await import("../tools/web-fetch.js");
  const security = new SecurityManager({
    mode: "enforce",
    capabilityPolicy: {
      allowNetworkAccess: false,
    },
  });
  const tool = createWebFetchTool(security);

  const result = JSON.parse(await tool.execute({ url: "https://example.com" })) as { error?: string };

  assert.match(result.error ?? "", /requires approval/i);
});
