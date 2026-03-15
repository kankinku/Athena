import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("InterfaceContractStore: register, get, listByModule, checkBreakingChange", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-iface-store-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { InterfaceContractStore }] = await Promise.all([
      import("../store/database.js"),
      import("./interface-contract-store.js"),
    ]);
    const store = new InterfaceContractStore();

    const contract = {
      contractId: "ifc_1",
      moduleId: "mod-backend",
      interfaceName: "UserService",
      interfaceType: "class" as const,
      sourceFile: "src/services/user.ts",
      signature: "getUser(id: string): User",
      dependentModules: ["mod-frontend", "mod-api"],
      breakingChangeRisk: "high" as const,
      version: "1.0.0",
      lastChangedAt: Date.now(),
    };

    // register + get
    store.register(contract);
    const loaded = store.get("ifc_1");
    assert.ok(loaded);
    assert.equal(loaded.moduleId, "mod-backend");
    assert.equal(loaded.interfaceName, "UserService");

    // listByModule
    const byModule = store.listByModule("mod-backend");
    assert.equal(byModule.length, 1);

    // listConsumers
    const consumers = store.listConsumers("ifc_1");
    assert.deepEqual(consumers, ["mod-frontend", "mod-api"]);

    // checkBreakingChange — same signature
    const noBreak = store.checkBreakingChange("ifc_1", "getUser(id: string): User", "1.0.1");
    assert.equal(noBreak.isBreaking, false);

    // checkBreakingChange — different signature
    const breaking = store.checkBreakingChange("ifc_1", "getUser(id: number): User", "2.0.0");
    assert.equal(breaking.isBreaking, true);
    assert.equal(breaking.affectedConsumers.length, 2);
    assert.ok(breaking.riskLevel === "critical");

    // checkBreakingChange — unknown contract
    const notFound = store.checkBreakingChange("nonexistent", "foo()", "1.0.0");
    assert.equal(notFound.isBreaking, false);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("InterfaceContractStore: updateSignature, markVerified, delete", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-iface-ops-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { InterfaceContractStore }] = await Promise.all([
      import("../store/database.js"),
      import("./interface-contract-store.js"),
    ]);
    const store = new InterfaceContractStore();

    store.register({
      contractId: "ifc_u",
      moduleId: "mod-data",
      interfaceName: "DataRepo",
      interfaceType: "type" as const,
      sourceFile: "src/data/repo.ts",
      signature: "find(q: Query): Result[]",
      dependentModules: [],
      breakingChangeRisk: "medium" as const,
      version: "1.0.0",
    });

    // updateSignature
    store.updateSignature("ifc_u", "find(q: Query, opts?: Options): Result[]", "1.1.0");
    const updated = store.get("ifc_u");
    assert.ok(updated);
    assert.equal(updated.signature, "find(q: Query, opts?: Options): Result[]");
    assert.equal(updated.version, "1.1.0");

    // markVerified
    store.markVerified("ifc_u");
    const verified = store.get("ifc_u");
    assert.ok(verified?.lastVerifiedAt);

    // delete
    store.delete("ifc_u");
    const deleted = store.get("ifc_u");
    assert.equal(deleted, null);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
