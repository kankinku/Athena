import { nanoid } from "nanoid";
import type {
  AutomationCheckpointRecord,
  TeamRunRecord,
} from "./contracts.js";
import type { AutomationStore } from "./automation-store.js";
import type { TeamRunStore, TeamRunUpdateInput } from "./team-run-store.js";
import type { WorkflowStore } from "./workflow-store.js";
import { assertValidWorkflowTransition, canRollbackWorkflowState } from "./workflow-state.js";

export type AutomationAction = "proposal" | "experiment" | "resume" | "retry" | "revisit";

export class WorkflowAutomationService {
  constructor(
    private readonly teamRunStore: TeamRunStore,
    private readonly workflowStore: WorkflowStore,
    private readonly automationStore: AutomationStore,
  ) {}

  transitionWorkflow(
    runId: string,
    toState: TeamRunRecord["workflowState"],
    reason: string,
    options: {
      rollbackOfTransitionId?: string;
      metadata?: Record<string, unknown>;
      currentStage?: TeamRunRecord["currentStage"];
    } = {},
  ): TeamRunRecord | null {
    const run = this.teamRunStore.getTeamRun(runId);
    if (!run) return null;
    assertValidWorkflowTransition(run.workflowState, toState);

    const stageStartReset = toState === "running" && run.automationState.stageStartedAt === undefined
      ? { ...run.automationState, stageStartedAt: Date.now() }
      : undefined;
    const next = this.teamRunStore.updateTeamRun(runId, {
      currentStage: options.currentStage,
      workflowState: toState,
      status: toState === "failed"
        ? "failed"
        : toState === "archived"
          ? "completed"
          : run.status,
      automationState: stageStartReset,
    });
    if (!next) return null;

    this.workflowStore.saveWorkflowTransition(run.sessionId, {
      transitionId: nanoid(),
      runId,
      fromState: run.workflowState,
      toState,
      reason,
      rollbackOfTransitionId: options.rollbackOfTransitionId,
      metadata: options.metadata,
      createdAt: Date.now(),
    });

    return next;
  }

  rollbackWorkflow(runId: string, reason: string): TeamRunRecord | null {
    const run = this.teamRunStore.getTeamRun(runId);
    if (!run) return null;

    const history = this.workflowStore.listWorkflowTransitions(run.sessionId, runId);
    const target = [...history].reverse().find((entry) => canRollbackWorkflowState(entry.fromState));
    if (!target) return null;

    const next = this.teamRunStore.updateTeamRun(runId, {
      workflowState: target.fromState,
      status: "active",
    });
    if (!next) return null;

    this.workflowStore.saveWorkflowTransition(run.sessionId, {
      transitionId: nanoid(),
      runId,
      fromState: run.workflowState,
      toState: target.fromState,
      reason,
      rollbackOfTransitionId: target.transitionId,
      metadata: { rollback: true },
      createdAt: Date.now(),
    });

    return next;
  }

  configureAutomation(
    runId: string,
    updates: Partial<Pick<TeamRunRecord, "automationPolicy" | "checkpointPolicy" | "retryPolicy" | "timeoutPolicy">>,
  ): TeamRunRecord | null {
    const run = this.teamRunStore.getTeamRun(runId);
    if (!run) return null;

    const checkpointPolicy = updates.checkpointPolicy ?? run.checkpointPolicy;
    const timeoutPolicy = updates.timeoutPolicy ?? run.timeoutPolicy;

    return this.teamRunStore.updateTeamRun(runId, {
      automationPolicy: updates.automationPolicy ?? run.automationPolicy,
      checkpointPolicy,
      retryPolicy: updates.retryPolicy ?? run.retryPolicy,
      timeoutPolicy,
      automationState: {
        ...run.automationState,
        timeoutAt: timeoutPolicy.maxRunMinutes > 0
          ? run.createdAt + (timeoutPolicy.maxRunMinutes * 60_000)
          : undefined,
        nextCheckpointAt: checkpointPolicy.intervalMinutes > 0
          ? Date.now() + (checkpointPolicy.intervalMinutes * 60_000)
          : undefined,
      },
    });
  }

  canAutomateAction(
    runId: string,
    action: AutomationAction,
  ): { ok: true; run: TeamRunRecord } | { ok: false; run: TeamRunRecord | null; reason: string } {
    const run = this.teamRunStore.getTeamRun(runId);
    if (!run) {
      return { ok: false, run: null, reason: "run not found" };
    }
    if (run.automationState.timeoutAt !== undefined && Date.now() >= run.automationState.timeoutAt) {
      return { ok: false, run, reason: "automation timeout exceeded" };
    }
    if (
      run.timeoutPolicy.maxStageMinutes !== undefined
      && run.timeoutPolicy.maxStageMinutes > 0
      && run.automationState.stageStartedAt !== undefined
      && (Date.now() - run.automationState.stageStartedAt) >= (run.timeoutPolicy.maxStageMinutes * 60_000)
    ) {
      return { ok: false, run, reason: `automation stage timeout exceeded for ${run.currentStage}` };
    }
    if (run.automationPolicy.mode === "fully-autonomous") {
      const policy = run.automationPolicy.autonomyPolicy;
      if (!policy) {
        return { ok: false, run, reason: "fully autonomous mode requires an autonomy policy" };
      }
      if (
        policy.maxWallClockMinutes !== undefined
        && ((Date.now() - run.createdAt) / 60_000) >= policy.maxWallClockMinutes
      ) {
        return { ok: false, run, reason: "autonomous wall clock budget exceeded" };
      }
      if (
        action === "retry"
        && policy.maxRetryCount !== undefined
        && run.automationState.retryCount >= policy.maxRetryCount
      ) {
        return { ok: false, run, reason: "autonomous retry limit reached" };
      }
      if (
        action === "experiment"
        && policy.maxWallClockMinutes !== undefined
        && run.budget?.maxWallClockMinutes !== undefined
        && run.budget.maxWallClockMinutes > policy.maxWallClockMinutes
      ) {
        return { ok: false, run, reason: "run budget exceeds autonomous wall clock policy" };
      }
      if (
        action === "experiment"
        && policy.maxCostUsd !== undefined
        && run.budget?.maxCostUsd !== undefined
        && run.budget.maxCostUsd > policy.maxCostUsd
      ) {
        return { ok: false, run, reason: "run budget exceeds autonomous cost policy" };
      }
    }
    if (action === "proposal" && run.automationPolicy.requireProposalApproval) {
      return { ok: false, run, reason: "proposal approval required by automation policy" };
    }
    if (action === "experiment" && run.automationPolicy.requireExperimentApproval) {
      return { ok: false, run, reason: "experiment approval required by automation policy" };
    }
    if (action === "revisit" && run.automationPolicy.requireRevisitApproval) {
      return { ok: false, run, reason: "revisit approval required by automation policy" };
    }
    if (action === "retry" && run.automationState.retryCount >= run.retryPolicy.maxRetries) {
      return { ok: false, run, reason: "retry limit reached" };
    }
    return { ok: true, run };
  }

  noteAutomationBlock(runId: string, action: AutomationAction, reason: string): TeamRunRecord | null {
    const run = this.teamRunStore.getTeamRun(runId);
    if (!run) return null;

    const next = this.teamRunStore.updateTeamRun(runId, {
      latestOutput: {
        ...(run.latestOutput ?? {}),
        automationBlock: {
          action,
          reason,
          at: Date.now(),
        },
      },
    });

    if (next) {
      this.recordAutomationCheckpoint(runId, `blocked:${action}`, {
        reason,
        workflowState: next.workflowState,
      });
    }

    return next;
  }

  recordAutomationCheckpoint(
    runId: string,
    reason: string,
    snapshot?: Record<string, unknown>,
  ): AutomationCheckpointRecord | null {
    const run = this.teamRunStore.getTeamRun(runId);
    if (!run) return null;

    const now = Date.now();
    this.teamRunStore.updateTeamRun(runId, {
      automationState: {
        ...run.automationState,
        lastCheckpointAt: now,
        lastCheckpointReason: reason,
        nextCheckpointAt: run.checkpointPolicy.intervalMinutes > 0
          ? now + (run.checkpointPolicy.intervalMinutes * 60_000)
          : undefined,
      },
    });

    return this.automationStore.saveAutomationCheckpoint(run.sessionId, {
      checkpointId: nanoid(),
      runId,
      workflowState: run.workflowState,
      stage: run.currentStage,
      reason,
      snapshot,
      createdAt: now,
    });
  }

  resumeAutomation(runId: string, reason: string): TeamRunRecord | null {
    const gate = this.canAutomateAction(runId, "resume");
    if (!gate.ok) {
      return this.noteAutomationBlock(runId, "resume", gate.reason);
    }
    return this.teamRunStore.updateTeamRun(runId, {
      automationState: {
        ...gate.run.automationState,
        resumeCount: gate.run.automationState.resumeCount + 1,
      },
      latestOutput: {
        ...(gate.run.latestOutput ?? {}),
        resumeReason: reason,
      },
      status: "active",
    });
  }

  recordAutomationRetry(runId: string, reason: string): TeamRunRecord | null {
    const gate = this.canAutomateAction(runId, "retry");
    if (!gate.ok) {
      return this.noteAutomationBlock(runId, "retry", gate.reason);
    }

    const retryCount = Math.min(gate.run.retryPolicy.maxRetries, gate.run.automationState.retryCount + 1);
    return this.teamRunStore.updateTeamRun(runId, {
      automationState: {
        ...gate.run.automationState,
        retryCount,
      },
      latestOutput: {
        ...(gate.run.latestOutput ?? {}),
        retryReason: reason,
        retryCount,
      },
    });
  }

  updateTeamRun(id: string, updates: TeamRunUpdateInput): TeamRunRecord | null {
    return this.teamRunStore.updateTeamRun(id, updates);
  }
}
