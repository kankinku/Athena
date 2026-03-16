import type { TeamRunRecord } from "./contracts.js";

export interface AutonomousContinuationContext {
  isStreaming: boolean;
  isSleeping: boolean;
  monitorActive: boolean;
}

export function shouldContinueAutonomously(
  run: TeamRunRecord | null,
  context: AutonomousContinuationContext,
): boolean {
  if (!run) return false;
  if (run.status !== "active") return false;
  if (run.automationPolicy.mode === "manual") return false;
  const automationBlock = (run.latestOutput as { automationBlock?: { action?: string } } | undefined)?.automationBlock;
  if (automationBlock?.action === "proposal" && run.automationPolicy.requireProposalApproval) return false;
  if (automationBlock?.action === "experiment" && run.automationPolicy.requireExperimentApproval) return false;
  if (automationBlock?.action === "revisit" && run.automationPolicy.requireRevisitApproval) return false;
  if (automationBlock?.action === "retry" || automationBlock?.action === "resume") return false;
  if (context.isStreaming || context.isSleeping || context.monitorActive) return false;
  return true;
}

export function buildAutonomousContinuationPrompt(run: TeamRunRecord): string {
  return [
    "[Autonomous continuation]",
    `run_id=${run.id}`,
    `goal=${run.goal}`,
    `workflow_state=${run.workflowState}`,
    `stage=${run.currentStage}`,
    `iteration=${run.iterationCount}`,
    "",
    "Do not summarize past work or promise future work.",
    "Take the single next bounded action now.",
    "If you need to wait on an external condition, call start_monitor or sleep before ending the turn.",
    "Only stop when the goal is done, policy blocks the run, or human-only input is required.",
  ].join("\n");
}
