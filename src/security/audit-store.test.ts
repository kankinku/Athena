import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("SecurityAuditStore records and summarizes security decisions", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-security-audit-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { SecurityAuditStore }, { SecurityManager }] = await Promise.all([
      import("../store/database.js"),
      import("./audit-store.js"),
      import("./policy.js"),
    ]);
    const auditStore = new SecurityAuditStore();
    const security = new SecurityManager({
      mode: "audit",
      capabilityPolicy: {
        allowedMachineIds: ["local"],
        allowedToolCategories: ["filesystem"],
        allowedWritePathRoots: ["/workspace/project/tmp"],
      },
    }, auditStore);

    security.assertPathAllowed("/workspace/project/tmp/out.txt", "write", {
      actorRole: "operator",
      actorId: "ops-admin",
      machineId: "local",
      toolName: "write_file",
      toolFamily: "filesystem",
    });
    security.assertActionAllowed("approve", {
      actorRole: "operator",
      actorId: "ops-admin",
      toolName: "research_operate",
      toolFamily: "research-orchestration",
    });

    const recent = auditStore.listRecent(5);
    const summary = auditStore.summarize();

    assert.equal(recent.length, 2);
    assert.equal(summary.total, 2);
    assert.equal(summary.allow, 2);
    assert.equal(summary.review, 0);
    assert.equal(summary.block, 0);
    assert.equal(recent[0]?.actionClass, "approve");
    assert.equal(recent[0]?.actorId, "ops-admin");
    assert.equal(recent[0]?.actorTier, "operator_admin");
    assert.equal(recent[1]?.toolFamily, "filesystem");
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
