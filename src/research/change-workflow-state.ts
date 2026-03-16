/**
 * change-workflow-state.ts
 *
 * @experimental
 * 이 모듈은 코어 루프와 직접 통합되지 않은 legacy change-management 서브시스템이다.
 * 코어 루프의 workflow-state.ts(ResearchWorkflowState)와 별개이며 혼용하지 않는다.
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
  "executing":        ["verifying", "rolled-back", "remeeting", "failed"],
  "verifying":        ["merged", "completed", "remeeting", "rolled-back", "failed"],
  "merged":           [],                                         // terminal
  "completed":        ["merged"],                                 // can promote to merged
  "remeeting":        ["in-meeting", "on-hold", "rolled-back", "failed"],
  "rolled-back":      ["draft"],                                  // can restart from draft
  "on-hold":          ["draft", "in-meeting", "rejected", "failed"],
  "rejected":         [],                                         // terminal
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
  return state === "merged" || state === "rejected";
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
  "scheduled":       ["pending-quorum", "round-1", "cancelled", "failed"],
  "pending-quorum":  ["round-1", "on-hold", "timed-out", "cancelled", "failed"],
  "round-1":         ["round-2", "on-hold", "timed-out", "cancelled", "failed"],
  "round-2":         ["round-3", "on-hold", "timed-out", "cancelled", "failed"],
  "round-3":         ["round-4", "round-5", "on-hold", "timed-out", "cancelled", "failed"],
  "round-4":         ["round-5", "on-hold", "timed-out", "cancelled", "failed"],
  "round-5":         ["completed", "on-hold", "timed-out", "cancelled", "failed"],
  "completed":       ["archived"],
  "archived":        [],                                            // terminal
  "on-hold":         ["scheduled", "round-1", "cancelled", "failed"],
  "cancelled":       [],                                            // terminal — 운영자 취소
  "timed-out":       ["scheduled"],                                  // 재스케줄 가능
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
