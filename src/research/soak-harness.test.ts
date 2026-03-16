import test from "node:test";
import assert from "node:assert/strict";
import { buildEnvironmentAwareScenarios, buildSupervisedProductionChecklist, createSoakArtifact, evaluateSoakScenario } from "./soak-harness.js";

test("soak harness flags unrecoverable scenarios and builds a checklist", () => {
  const green = evaluateSoakScenario({
    id: "local-only",
    label: "local_only",
    inducedFailures: ["restart", "stuck_action"],
    completed: 10,
    recovered: 2,
    rolledBack: 1,
    unrecoverable: 0,
  });
  const red = evaluateSoakScenario({
    id: "multi-host",
    label: "multi_host",
    inducedFailures: ["host_loss", "network_interrupt"],
    completed: 7,
    recovered: 1,
    rolledBack: 0,
    unrecoverable: 1,
  });

  assert.equal(green.pass, true);
  assert.equal(red.pass, false);
  const checklist = buildSupervisedProductionChecklist([green, red]);
  assert.match(checklist, /overall=red/);
  assert.match(checklist, /local-only: status=pass pass=true/);
  assert.match(checklist, /multi-host: status=fail pass=false/);
});

test("soak harness marks unavailable topologies as blocked and smoke-only as synthetic", () => {
  const artifact = createSoakArtifact(["local"], buildEnvironmentAwareScenarios([], { localSmokePassed: true }));
  const checklist = buildSupervisedProductionChecklist(artifact.results);

  // Smoke-only local scenario is correctly marked as synthetic (not a real soak)
  assert.equal(artifact.results[0]?.status, "synthetic");
  assert.equal(artifact.results[1]?.status, "blocked");
  assert.equal(artifact.results[2]?.status, "blocked");
  assert.equal(artifact.synthetic, true);
  assert.match(checklist, /overall=synthetic_only/);
  assert.match(checklist, /WARNING: synthetic results present/);
  assert.match(checklist, /single_remote: status=blocked/);
  assert.match(checklist, /multi_host: status=blocked/);
});
