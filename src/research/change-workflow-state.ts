/**
 * change-workflow-state.ts
 *
 * 모듈 협의 기반 change proposal의 상태 전환 규칙.
 * 기존 workflow-state.ts (ResearchWorkflowState) 와 동일한 패턴으로,
 * ChangeWorkflowState에 대한 전환 검증을 제공한다.
 */

import type { ChangeWorkflowState, MeetingState } from "./contracts.js";

// ─── Change Workflow Transitions ──────────────────────────────────────────────

const VALID_CHANGE_TRANSITIONS: Record<ChangeWorkflowState, ChangeWorkflowState[]> = {
  "draft":            ["impact-analyzed", "failed"],
  "impact-analyzed":  ["agents-summoned", "draft", "failed"],
  "agents-summoned":  ["in-meeting", "failed"],
  "in-meeting":       ["agreed", "on-hold", "rejected", "failed"],
  "agreed":           ["executing", "on-hold", "failed"],
  "executing":        ["verifying", "failed"],
  "verifying":        ["completed", "remeeting", "failed"],
  "completed":        [],
  "remeeting":        ["in-meeting", "on-hold", "failed"],
  "on-hold":          ["draft", "in-meeting", "rejected", "failed"],
  "rejected":         [],
  "failed":           ["draft"],
};

/**
 * 주어진 상태 전환이 유효한지 검증한다.
 * 같은 상태로의 전환(no-op)은 허용한다.
 * @throws 유효하지 않은 전환일 때 Error
 */
export function assertValidChangeTransition(
  from: ChangeWorkflowState,
  to: ChangeWorkflowState,
): void {
  if (from === to) return;
  const allowed = VALID_CHANGE_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid change workflow transition: ${from} -> ${to}`);
  }
}

/**
 * 주어진 상태 전환이 유효한지 boolean으로 반환한다.
 */
export function canTransitionChange(
  from: ChangeWorkflowState,
  to: ChangeWorkflowState,
): boolean {
  if (from === to) return true;
  const allowed = VALID_CHANGE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * 주어진 상태에서 가능한 다음 상태 목록을 반환한다.
 */
export function getNextChangeStates(from: ChangeWorkflowState): ChangeWorkflowState[] {
  return VALID_CHANGE_TRANSITIONS[from] ?? [];
}

/**
 * 해당 상태가 종결 상태(terminal)인지 반환한다.
 */
export function isTerminalChangeState(state: ChangeWorkflowState): boolean {
  return state === "completed" || state === "rejected";
}

/**
 * 해당 상태로 롤백할 수 있는지 반환한다.
 * draft, on-hold 로만 롤백 가능.
 */
export function canRollbackToChangeState(target: ChangeWorkflowState): boolean {
  return target === "draft" || target === "on-hold";
}

// ─── Meeting State Transitions ────────────────────────────────────────────────

const VALID_MEETING_TRANSITIONS: Record<MeetingState, MeetingState[]> = {
  "scheduled":       ["pending-quorum", "round-1", "failed"],
  "pending-quorum":  ["round-1", "on-hold", "failed"],
  "round-1":         ["round-2", "on-hold", "failed"],
  "round-2":         ["round-3", "on-hold", "failed"],
  "round-3":         ["round-4", "round-5", "on-hold", "failed"],  // skip round 4 if no conflicts
  "round-4":         ["round-5", "on-hold", "failed"],
  "round-5":         ["completed", "on-hold", "failed"],
  "completed":       [],
  "on-hold":         ["scheduled", "round-1", "failed"],
  "failed":          ["scheduled"],
};

/**
 * 회의 상태 전환이 유효한지 검증한다.
 * @throws 유효하지 않은 전환일 때 Error
 */
export function assertValidMeetingTransition(
  from: MeetingState,
  to: MeetingState,
): void {
  if (from === to) return;
  const allowed = VALID_MEETING_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid meeting state transition: ${from} -> ${to}`);
  }
}

/**
 * 회의 상태 전환이 유효한지 boolean으로 반환한다.
 */
export function canTransitionMeeting(
  from: MeetingState,
  to: MeetingState,
): boolean {
  if (from === to) return true;
  const allowed = VALID_MEETING_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * 라운드 번호를 MeetingState로 변환한다.
 */
export function roundToMeetingState(round: number): MeetingState {
  if (round < 1 || round > 5) {
    throw new Error(`Invalid meeting round: ${round}`);
  }
  return `round-${round}` as MeetingState;
}
