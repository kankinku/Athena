import test from "node:test";
import assert from "node:assert/strict";
import { OPERATOR_SUPERVISED_EVAL_FIXTURES } from "./operator-supervised-fixtures.js";

test("operator-supervised eval fixtures cover all supervised production categories", () => {
  const categories = new Set(OPERATOR_SUPERVISED_EVAL_FIXTURES.map((fixture) => fixture.category));
  assert.deepEqual([...categories].sort(), [
    "operator_intervention",
    "proposal_quality",
    "report_quality",
    "simulation_quality",
  ]);
  assert.equal(new Set(OPERATOR_SUPERVISED_EVAL_FIXTURES.map((fixture) => fixture.id)).size, OPERATOR_SUPERVISED_EVAL_FIXTURES.length);
});
