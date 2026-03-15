import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidTaskTransition,
  canTransitionTask,
  getNextTaskStates,
} from "./task-workflow-state.js";

test("assertValidTaskTransition: allows valid transitions", () => {
  assert.doesNotThrow(() => assertValidTaskTransition("queued", "running"));
  assert.doesNotThrow(() => assertValidTaskTransition("running", "needs-review"));
  assert.doesNotThrow(() => assertValidTaskTransition("needs-review", "ready-for-merge"));
  assert.doesNotThrow(() => assertValidTaskTransition("ready-for-merge", "merged"));
  assert.doesNotThrow(() => assertValidTaskTransition("queued", "policy-blocked"));
  assert.doesNotThrow(() => assertValidTaskTransition("running", "test-failed"));
  assert.doesNotThrow(() => assertValidTaskTransition("test-failed", "running")); // retry
  assert.doesNotThrow(() => assertValidTaskTransition("running", "rolled-back"));
});

test("assertValidTaskTransition: same state is always valid", () => {
  assert.doesNotThrow(() => assertValidTaskTransition("queued", "queued"));
  assert.doesNotThrow(() => assertValidTaskTransition("merged", "merged"));
});

test("assertValidTaskTransition: rejects invalid transitions", () => {
  assert.throws(() => assertValidTaskTransition("queued", "merged"), /Invalid task state transition/);
  assert.throws(() => assertValidTaskTransition("merged", "running"), /Invalid task state transition/);
  assert.throws(() => assertValidTaskTransition("rolled-back", "queued"), /Invalid task state transition/);
});

test("canTransitionTask: returns boolean for validity", () => {
  assert.equal(canTransitionTask("queued", "running"), true);
  assert.equal(canTransitionTask("merged", "running"), false);
  assert.equal(canTransitionTask("running", "running"), true); // same state
});

test("getNextTaskStates: returns correct next states", () => {
  const fromQueued = getNextTaskStates("queued");
  assert.ok(fromQueued.includes("running"));
  assert.ok(fromQueued.includes("policy-blocked"));
  assert.equal(fromQueued.length, 2);

  const fromMerged = getNextTaskStates("merged");
  assert.equal(fromMerged.length, 0); // terminal
});
