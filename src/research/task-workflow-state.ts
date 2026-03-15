/**
 * task-workflow-state.ts
 *
 * 개별 태스크(TaskAssignment)의 상태 전환 규칙.
 * change-workflow-state.ts, meeting 상태 머신과 동일 패턴.
 */

import type { TaskState } from "./contracts.js";

// ─── Task State Transitions ───────────────────────────────────────────────────

const VALID_TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  "queued":           ["running", "policy-blocked"],
  "running":          ["needs-review", "test-failed", "policy-blocked", "rolled-back"],
  "needs-review":     ["ready-for-merge", "running", "test-failed", "rolled-back"],
  "ready-for-merge":  ["merged", "running", "rolled-back"],
  "merged":           [],                                           // terminal
  "policy-blocked":   ["queued", "rolled-back"],                    // 정책 해제 시 재큐잉
  "test-failed":      ["running", "rolled-back"],                   // 재시도 또는 롤백
  "rolled-back":      [],                                           // terminal
};

/**
 * 태스크 상태 전환이 유효한지 검증한다.
 * @throws 유효하지 않은 전환일 때 Error
 */
export function assertValidTaskTransition(
  from: TaskState,
  to: TaskState,
): void {
  if (from === to) return;
  const allowed = VALID_TASK_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid task state transition: ${from} -> ${to}`);
  }
}

/**
 * 태스크 상태 전환이 유효한지 boolean으로 반환한다.
 */
export function canTransitionTask(
  from: TaskState,
  to: TaskState,
): boolean {
  if (from === to) return true;
  const allowed = VALID_TASK_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * 주어진 상태에서 가능한 다음 상태 목록을 반환한다.
 */
export function getNextTaskStates(from: TaskState): TaskState[] {
  return VALID_TASK_TRANSITIONS[from] ?? [];
}

/**
 * 해당 상태가 종결 상태(terminal)인지 반환한다.
 */
export function isTerminalTaskState(state: TaskState): boolean {
  return state === "merged" || state === "rolled-back";
}
