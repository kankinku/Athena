import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("rollbackRun records a recovery checkpoint after workflow rollback", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-runtime-closure-"));
  process.env.ATHENA_HOME = home;

  const [{ SessionStore }, { TeamStore }, { MemoryStore }, { GraphMemory }, { TeamOrchestrator }, { closeDb }] = await Promise.all([
    import("../store/session-store.js"),
    import("./team-store.js"),
    import("../memory/memory-store.js"),
    import("../memory/graph-memory.js"),
    import("./team-orchestrator.js"),
    import("../store/database.js"),
  ]);

  try {
    const sessionStore = new SessionStore();
    const teamStore = new TeamStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);

    const run = orchestrator.startRun("runtime closure rollback test");
    teamStore.transitionWorkflow(run.id, "evaluating", "force evaluation state");

    const rolledBack = orchestrator.rollbackRun(run.id, "operator requested rollback after failed review");
    assert.ok(rolledBack);

    const checkpoints = teamStore.listAutomationCheckpoints(session.id, run.id);
    assert.ok(checkpoints.some((checkpoint) => checkpoint.reason === "rollback"));
    assert.equal(rolledBack?.status, "active");
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
