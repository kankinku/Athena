import test from "node:test";
import assert from "node:assert/strict";

import { assertValidWorkflowTransition, canRollbackWorkflowState } from "./workflow-state.js";

test("assertValidWorkflowTransition accepts valid transitions", () => {
  assert.doesNotThrow(() => assertValidWorkflowTransition("draft", "ready"));
  assert.doesNotThrow(() => assertValidWorkflowTransition("evaluating", "revisit_due"));
});

test("assertValidWorkflowTransition rejects invalid transitions", () => {
  assert.throws(
    () => assertValidWorkflowTransition("running", "revisit_due"),
    /Invalid research workflow transition: running -> revisit_due/,
  );
});

test("canRollbackWorkflowState only allows rollback-safe states", () => {
  assert.equal(canRollbackWorkflowState("draft"), true);
  assert.equal(canRollbackWorkflowState("running"), true);
  assert.equal(canRollbackWorkflowState("reported"), false);
  assert.equal(canRollbackWorkflowState("revisit_due"), false);
});
