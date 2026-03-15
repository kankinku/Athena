import test from "node:test";
import assert from "node:assert/strict";

import {
  assertValidChangeTransition,
  canTransitionChange,
  getNextChangeStates,
  isTerminalChangeState,
  canRollbackToChangeState,
  assertValidMeetingTransition,
  canTransitionMeeting,
  roundToMeetingState,
} from "./change-workflow-state.js";

// ─── ChangeWorkflowState transitions ──────────────────────────────────────────

test("ChangeWorkflow: draft → impact-analyzed is valid", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("draft", "impact-analyzed"));
});

test("ChangeWorkflow: impact-analyzed → agents-summoned is valid", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("impact-analyzed", "agents-summoned"));
});

test("ChangeWorkflow: in-meeting → agreed is valid (합의 도달)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("in-meeting", "agreed"));
});

test("ChangeWorkflow: in-meeting → on-hold is valid (타임아웃)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("in-meeting", "on-hold"));
});

test("ChangeWorkflow: verifying → remeeting is valid (테스트 실패)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("verifying", "remeeting"));
});

test("ChangeWorkflow: remeeting → in-meeting is valid (재회의 시작)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("remeeting", "in-meeting"));
});

test("ChangeWorkflow: agreed → executing is valid (게이트 통과)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("agreed", "executing"));
});

test("ChangeWorkflow: executing → failed is valid (실행 오류)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("executing", "failed"));
});

test("ChangeWorkflow: same state transition is allowed (no-op)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("draft", "draft"));
  assert.doesNotThrow(() => assertValidChangeTransition("in-meeting", "in-meeting"));
});

test("ChangeWorkflow: merged → executing is blocked (terminal)", () => {
  assert.throws(
    () => assertValidChangeTransition("merged", "executing"),
    /Invalid change workflow transition: merged -> executing/,
  );
});

test("ChangeWorkflow: rejected → executing is blocked (terminal)", () => {
  assert.throws(
    () => assertValidChangeTransition("rejected", "executing"),
    /Invalid change workflow transition: rejected -> executing/,
  );
});

test("ChangeWorkflow: draft → verifying is blocked (state skip)", () => {
  assert.throws(
    () => assertValidChangeTransition("draft", "verifying"),
    /Invalid change workflow transition: draft -> verifying/,
  );
});

test("ChangeWorkflow: agents-summoned → agreed is blocked (must go through meeting)", () => {
  assert.throws(
    () => assertValidChangeTransition("agents-summoned", "agreed"),
    /Invalid change workflow transition: agents-summoned -> agreed/,
  );
});

test("ChangeWorkflow: failed → draft recovery is valid", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("failed", "draft"));
});

test("ChangeWorkflow: on-hold → draft restart is valid", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("on-hold", "draft"));
});

// ─── canTransitionChange ──────────────────────────────────────────────────────

test("canTransitionChange returns true for valid transitions", () => {
  assert.equal(canTransitionChange("draft", "impact-analyzed"), true);
  assert.equal(canTransitionChange("in-meeting", "agreed"), true);
});

test("canTransitionChange returns false for invalid transitions", () => {
  assert.equal(canTransitionChange("completed", "draft"), false);
  assert.equal(canTransitionChange("rejected", "agreed"), false);
});

// ─── getNextChangeStates ──────────────────────────────────────────────────────

test("getNextChangeStates for draft", () => {
  const next = getNextChangeStates("draft");
  assert.ok(next.includes("impact-analyzed"));
  assert.ok(next.includes("failed"));
  assert.ok(!next.includes("executing"));
});

test("getNextChangeStates for merged is empty (terminal)", () => {
  const next = getNextChangeStates("merged");
  assert.equal(next.length, 0);
});

// ─── isTerminalChangeState ────────────────────────────────────────────────────

test("merged and rejected are terminal states", () => {
  assert.equal(isTerminalChangeState("merged"), true);
  assert.equal(isTerminalChangeState("rejected"), true);
});

test("draft and executing are not terminal", () => {
  assert.equal(isTerminalChangeState("draft"), false);
  assert.equal(isTerminalChangeState("executing"), false);
});

// ─── canRollbackToChangeState ─────────────────────────────────────────────────

test("can rollback to draft and on-hold", () => {
  assert.equal(canRollbackToChangeState("draft"), true);
  assert.equal(canRollbackToChangeState("on-hold"), true);
});

test("cannot rollback to completed or executing", () => {
  assert.equal(canRollbackToChangeState("completed"), false);
  assert.equal(canRollbackToChangeState("executing"), false);
});

// ─── MeetingState transitions ─────────────────────────────────────────────────

test("Meeting: scheduled → round-1 is valid", () => {
  assert.doesNotThrow(() => assertValidMeetingTransition("scheduled", "round-1"));
});

test("Meeting: round-2 → round-3 is valid", () => {
  assert.doesNotThrow(() => assertValidMeetingTransition("round-2", "round-3"));
});

test("Meeting: round-3 → round-5 is valid (skip round-4 when no conflicts)", () => {
  assert.doesNotThrow(() => assertValidMeetingTransition("round-3", "round-5"));
});

test("Meeting: round-5 → completed is valid", () => {
  assert.doesNotThrow(() => assertValidMeetingTransition("round-5", "completed"));
});

test("Meeting: round-1 → round-5 is blocked (cannot skip)", () => {
  assert.throws(
    () => assertValidMeetingTransition("round-1", "round-5"),
    /Invalid meeting state transition: round-1 -> round-5/,
  );
});

test("Meeting: completed → scheduled is blocked (terminal)", () => {
  assert.throws(
    () => assertValidMeetingTransition("completed", "scheduled"),
    /Invalid meeting state transition: completed -> scheduled/,
  );
});

test("Meeting: on-hold → scheduled allows resume", () => {
  assert.doesNotThrow(() => assertValidMeetingTransition("on-hold", "scheduled"));
});

// ─── New states: merged, rolled-back, archived ────────────────────────────────

test("ChangeWorkflow: verifying → merged is valid (final merge)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("verifying", "merged"));
});

test("ChangeWorkflow: executing → rolled-back is valid", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("executing", "rolled-back"));
});

test("ChangeWorkflow: rolled-back → draft allows restart", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("rolled-back", "draft"));
});

test("ChangeWorkflow: completed → merged is valid (promote)", () => {
  assert.doesNotThrow(() => assertValidChangeTransition("completed", "merged"));
});

test("Meeting: completed → archived is valid", () => {
  assert.doesNotThrow(() => assertValidMeetingTransition("completed", "archived"));
});

test("Meeting: archived is terminal (no transitions out)", () => {
  const next = canTransitionMeeting("archived", "scheduled");
  assert.equal(next, false);
});

// ─── roundToMeetingState ──────────────────────────────────────────────────────

test("roundToMeetingState converts valid rounds", () => {
  assert.equal(roundToMeetingState(1), "round-1");
  assert.equal(roundToMeetingState(5), "round-5");
});

test("roundToMeetingState rejects invalid rounds", () => {
  assert.throws(() => roundToMeetingState(0));
  assert.throws(() => roundToMeetingState(6));
});
