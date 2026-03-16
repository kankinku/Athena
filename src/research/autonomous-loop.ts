import type { TeamRunRecord } from "./contracts.js";

export interface AutonomousContinuationContext {
  isStreaming: boolean;
  isSleeping: boolean;
  monitorActive: boolean;
}

// ─── Loop Execution Gate ──────────────────────────────────────────────────────
// Checks that a run satisfies all policy, budget, and rollback preconditions
// before entering the execution stage. Every autonomous execution path must
// pass this gate; skipping it is not permitted.
//
// This gate is intentionally lightweight: the full policy/security check runs
// inside the security layer (security/policy.ts). This gate focuses on the
// loop-level invariants that must hold before ANY execution attempt.

export interface LoopExecutionGateResult {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

export function checkLoopExecutionGate(run: TeamRunRecord): LoopExecutionGateResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 1. Run must be active.
  if (run.status !== "active") {
    blockers.push(`Run ${run.id} is not active (status=${run.status}). Cannot execute.`);
  }

  // 2. Workflow must be at a stage that permits execution.
  if (run.workflowState !== "running" && run.workflowState !== "approved") {
    blockers.push(
      `Workflow state '${run.workflowState}' does not permit execution. ` +
      "Expected 'running' or 'approved'.",
    );
  }

  // 3. Budget ceiling must not already be exceeded.
  const budget = run.budget;
  if (budget) {
    if (budget.maxIterations != null && run.iterationCount >= budget.maxIterations) {
      blockers.push(
        `Iteration budget exhausted: ${run.iterationCount}/${budget.maxIterations}. ` +
        "Increase maxIterations or mark run complete.",
      );
    }
    if (budget.maxWallClockMinutes != null) {
      const ageMinutes = (Date.now() - run.createdAt) / 60_000;
      if (ageMinutes >= budget.maxWallClockMinutes) {
        blockers.push(
          `Wall-clock budget exhausted: ${ageMinutes.toFixed(1)}/${budget.maxWallClockMinutes} minutes.`,
        );
      }
    }
  }

  // 4. Automation mode must permit execution.
  const mode = run.automationPolicy.mode;
  if (mode === "manual") {
    blockers.push(
      "Automation mode is 'manual'. Execution requires explicit operator action.",
    );
  }

  // 5. Current stage must be 'simulation' (execution) — 'collection' or 'planning'
  //    alone should not trigger direct execution.
  if (run.currentStage === "collection" || run.currentStage === "reporting") {
    warnings.push(
      `Current stage is '${run.currentStage}'. Execution should be preceded by planning.`,
    );
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
  };
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
  const budgetLines: string[] = [];
  if (run.budget?.maxIterations != null) {
    budgetLines.push(`budget_iterations=${run.iterationCount}/${run.budget.maxIterations}`);
  }
  if (run.budget?.maxWallClockMinutes != null) {
    const elapsed = ((Date.now() - run.createdAt) / 60_000).toFixed(1);
    budgetLines.push(`budget_minutes=${elapsed}/${run.budget.maxWallClockMinutes}`);
  }

  return [
    "[Autonomous continuation]",
    `run_id=${run.id}`,
    `goal=${run.goal}`,
    `workflow_state=${run.workflowState}`,
    `stage=${run.currentStage}`,
    `iteration=${run.iterationCount}`,
    ...budgetLines,
    "",
    "Do not summarize past work or promise future work.",
    "Take the single next bounded action now.",
    "If you need to wait on an external condition, call start_monitor or sleep before ending the turn.",
    "Only stop when the goal is done, policy blocks the run, or human-only input is required.",
    "Before executing any change: verify policy allows it, a rollback path exists, and evaluation criteria are defined.",
  ].join("\n");
}
