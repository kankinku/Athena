import type { ResearchWorkflowState } from "./contracts.js";

export interface WorkflowTransitionRule {
  from: ResearchWorkflowState;
  to: ResearchWorkflowState;
}

const VALID_WORKFLOW_TRANSITIONS: Record<ResearchWorkflowState, ResearchWorkflowState[]> = {
  draft: ["ready", "failed", "archived"],
  ready: ["approved", "draft", "failed", "archived"],
  approved: ["running", "draft", "failed", "archived"],
  running: ["evaluating", "failed", "archived"],
  evaluating: ["reported", "revisit_due", "running", "failed", "archived"],
  reported: ["revisit_due", "archived"],
  revisit_due: ["approved", "archived", "failed"],
  archived: [],
  failed: ["draft", "ready", "archived"],
};

export function assertValidWorkflowTransition(
  from: ResearchWorkflowState,
  to: ResearchWorkflowState,
): void {
  if (from === to) return;
  const allowed = VALID_WORKFLOW_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid research workflow transition: ${from} -> ${to}`);
  }
}

export function canRollbackWorkflowState(target: ResearchWorkflowState): boolean {
  return target === "draft" || target === "ready" || target === "approved" || target === "running";
}
