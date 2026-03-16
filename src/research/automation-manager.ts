import type { MetricCollector } from "../metrics/collector.js";
import type { RemoteExecutor } from "../remote/executor.js";
import { nanoid } from "nanoid";
import type { ExperimentResult, TeamRunRecord } from "./contracts.js";
import type { TeamOrchestrator } from "./team-orchestrator.js";
import type { SimulationRunRecord, TeamStore } from "./team-store.js";
import type { SimulationRunner } from "./simulation-runner.js";

export class ResearchAutomationManager {
  private readonly ownerId = `automation-manager:${process.pid}`;

  constructor(
    private teamStore: TeamStore,
    private teamOrchestrator: TeamOrchestrator,
    private simulationRunner: SimulationRunner,
    private executor: RemoteExecutor,
    private metricCollector: MetricCollector,
  ) {}

  async tickSession(sessionId: string): Promise<TeamRunRecord[]> {
    if (!sessionId || sessionId === "pending") return [];

    const updates: TeamRunRecord[] = [];
    const runs = this.teamStore.listRecentTeamRuns(sessionId, 50);
    for (const run of runs.filter((item) => item.status === "active")) {
      const lease = this.teamStore.acquireRunLease(sessionId, run.id, this.ownerId);
      if (!lease) continue;
      this.recordAction(run, "session_tick", "running", `ticking ${run.workflowState}/${run.currentStage}`, {
        leaseId: lease.leaseId,
        workflowState: run.workflowState,
        stage: run.currentStage,
      });
    }

    updates.push(...await this.processSimulationRuns(sessionId));

    for (const run of runs.filter((item) => item.status === "active")) {
      if (!this.teamStore.heartbeatRunLease(run.id, this.ownerId)) continue;
      const ticked = this.tickRunState(run);
      if (ticked) updates.push(ticked);
    }

    for (const run of runs.filter((item) => item.status !== "failed")) {
      const retried = await this.maybeRetryRun(run.id);
      if (retried) updates.push(retried);
    }

    return updates;
  }

  async recoverSession(sessionId: string): Promise<TeamRunRecord[]> {
    const updates: TeamRunRecord[] = [];
    for (const run of this.teamStore.listRecentTeamRuns(sessionId, 50).filter((item) => item.status === "active")) {
      if (run.automationPolicy.mode === "manual") continue;
      const lease = this.teamStore.acquireRunLease(sessionId, run.id, this.ownerId);
      if (!lease) continue;
      const resumed = this.teamOrchestrator.resumeRunAutomation(run.id, "runtime startup recovery");
      if (resumed) {
        this.recordAction(resumed, "session_recovery", "committed", "resumed automation after startup recovery", {
          leaseId: lease.leaseId,
          resumeCount: resumed.automationState.resumeCount,
        });
        updates.push(resumed);
      }
    }
    updates.push(...await this.tickSession(sessionId));
    return updates;
  }

  private tickRunState(run: TeamRunRecord): TeamRunRecord | null {
    if (this.shouldCheckpoint(run)) {
      this.teamOrchestrator.checkpointRun(run.id, "scheduled checkpoint", {
        workflowState: run.workflowState,
        stage: run.currentStage,
        latestOutput: run.latestOutput,
      });
    }

    const gate = this.teamStore.canAutomateAction(run.id, "resume");
    if (!gate.ok && /timeout/i.test(gate.reason)) {
      const blocked = this.teamStore.noteAutomationBlock(run.id, "resume", gate.reason);
      this.teamStore.transitionWorkflow(run.id, "failed", gate.reason, {
        currentStage: "reporting",
        metadata: { source: "automation-manager" },
      });
      this.recordAction(run, "session_tick", "needs_recovery", "stage timeout exceeded", {
        workflowState: run.workflowState,
        stage: run.currentStage,
      }, gate.reason);
      const updated = this.teamStore.updateTeamRun(run.id, {
        status: "failed",
        latestOutput: {
          ...(blocked?.latestOutput ?? run.latestOutput ?? {}),
          automationTimeout: true,
        },
      });
      if (updated) {
        this.teamStore.releaseRunLease(updated.id, this.ownerId);
      }
      return updated;
    }

    return null;
  }

  private async processSimulationRuns(sessionId: string): Promise<TeamRunRecord[]> {
    const updates: TeamRunRecord[] = [];
    const budgetExceeded = await this.simulationRunner.enforceBudgets();
    for (const result of budgetExceeded) {
      const parent = this.findRunByProposal(sessionId, result.proposalId);
      if (!parent) continue;
      this.recordAction(parent, "simulation_budget_enforcement", "verifying", `budget exceeded for ${result.experimentId}`, {
        experimentId: result.experimentId,
        proposalId: result.proposalId,
      });
      const updated = this.teamOrchestrator.recordSimulationResult(parent.id, result);
      if (updated) {
        if (updated.status !== "active") {
          this.teamStore.releaseRunLease(updated.id, this.ownerId);
        }
        this.recordAction(updated, "simulation_budget_enforcement", "committed", `budget enforcement committed for ${result.experimentId}`, {
          experimentId: result.experimentId,
          proposalId: result.proposalId,
          outcomeStatus: result.outcomeStatus,
        });
        updates.push(updated);
      }
    }

    for (const simulation of this.teamStore.listRunningSimulationRuns(sessionId)) {
      if (!simulation.taskKey) continue;
      const [machineId, pidText] = simulation.taskKey.split(":");
      const pid = Number.parseInt(pidText, 10);
      if (Number.isNaN(pid)) continue;
      const running = await this.executor.isRunning(machineId, pid).catch(() => false);
      if (running) continue;

      await this.metricCollector.collectAll().catch(() => {});
      this.metricCollector.removeSource(simulation.taskKey);
      this.executor.removeBackgroundProcess(simulation.taskKey);

      const result = await this.buildResultFromFinishedSimulation(simulation, machineId);
      this.simulationRunner.finalize(simulation.id, result);
      const parent = this.findRunByProposal(sessionId, simulation.proposalId);
      if (!parent) continue;
      this.recordAction(parent, "simulation_finalize", "verifying", `finalizing simulation ${simulation.id}`, {
        experimentId: simulation.id,
        proposalId: simulation.proposalId,
      });
      const updated = this.teamOrchestrator.recordSimulationResult(parent.id, result);
      if (updated) {
        if (updated.status !== "active") {
          this.teamStore.releaseRunLease(updated.id, this.ownerId);
        }
        this.recordAction(updated, "simulation_finalize", "committed", `simulation ${simulation.id} finalized`, {
          experimentId: simulation.id,
          outcomeStatus: result.outcomeStatus,
        });
        updates.push(updated);
      }
    }

    return updates;
  }

  private async buildResultFromFinishedSimulation(
    simulation: SimulationRunRecord,
    machineId: string,
  ): Promise<ExperimentResult> {
    const exitCode = simulation.logPath
      ? await this.executor.readExitCode(machineId, simulation.logPath).catch(() => null)
      : null;
    const afterMetrics = simulation.taskKey
      ? this.simulationRunner.summarizeTask(simulation.taskKey)
      : {};
    const beforeMetrics = simulation.charter.baselineTaskId
      ? this.simulationRunner.summarizeTask(simulation.charter.baselineTaskId)
      : {};
    const tail = simulation.logPath
      ? await this.executor.tail(machineId, simulation.logPath, 20).catch(() => "")
      : "";
    const outcomeStatus = classifyFinishedSimulationOutcome(
      simulation.charter,
      exitCode,
      beforeMetrics,
      afterMetrics,
    );

    return {
      experimentId: simulation.id,
      proposalId: simulation.proposalId,
      taskId: simulation.taskKey,
      branchName: simulation.charter.branchName,
      outcomeStatus,
      beforeMetrics,
      afterMetrics,
      resourceDelta: {},
      surprisingFindings: tail
        ? tail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-3)
        : [exitCode === 0 ? "Process exited without explicit evaluation payload" : "Process exited with a non-zero status"],
      notes: `automation finalized background simulation (exit=${exitCode ?? "unknown"})`,
    };
  }

  private async maybeRetryRun(runId: string): Promise<TeamRunRecord | null> {
    const run = this.teamStore.getTeamRun(runId);
    if (!run || run.automationPolicy.mode === "manual") return null;
    const latest = run.latestOutput as { outcomeStatus?: string; proposalId?: string; experimentId?: string; automationRetriedFor?: string } | undefined;
    const outcome = latest?.outcomeStatus;
    if (!outcome || latest?.automationRetriedFor === latest.experimentId) return null;
    if (!run.retryPolicy.retryOn.includes(outcome as ExperimentResult["outcomeStatus"])) return null;

    const simulation = this.teamStore.listRecentSimulationRuns(run.sessionId, 20)
      .find((item) => item.id === latest?.experimentId || item.proposalId === latest?.proposalId);
    if (!simulation) return null;

    const retried = this.teamOrchestrator.retryRunAutomation(runId, `automatic retry for ${outcome}`);
    if (!retried) return null;
    const retryBlocked = (retried.latestOutput as { automationBlock?: { action?: string } } | undefined)?.automationBlock?.action === "retry";
    if (retryBlocked || retried.automationState.retryCount === run.automationState.retryCount) {
      return retried;
    }

    try {
      this.recordAction(retried, "automation_retry", "issued", `launching retry for ${simulation.id}`, {
        experimentId: simulation.id,
        proposalId: simulation.proposalId,
        retryCount: retried.automationState.retryCount,
      });
      await this.simulationRunner.launch({
        ...simulation.charter,
        experimentId: `${simulation.charter.experimentId}-retry-${retried.automationState.retryCount}`,
      });
      this.teamStore.transitionWorkflow(runId, "running", `automatic retry launched after ${outcome}`, {
        currentStage: "simulation",
        metadata: { proposalId: simulation.proposalId, previousSimulationId: simulation.id },
      });
      const updated = this.teamStore.updateTeamRun(runId, {
        status: "active",
        latestOutput: {
          ...(retried.latestOutput ?? {}),
          proposalId: simulation.proposalId,
          automationRetriedFor: simulation.id,
        },
      });
      if (updated) {
        this.recordAction(updated, "automation_retry", "committed", `retry launched for ${simulation.id}`, {
          experimentId: simulation.id,
          proposalId: simulation.proposalId,
          retryCount: updated.automationState.retryCount,
        });
      }
      return updated;
    } catch (error) {
      this.recordAction(retried, "automation_retry", "needs_recovery", `retry failed for ${simulation.id}`, {
        experimentId: simulation.id,
        proposalId: simulation.proposalId,
      }, error instanceof Error ? error.message : String(error));
      return this.teamStore.noteAutomationBlock(
        runId,
        "retry",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private shouldCheckpoint(run: TeamRunRecord): boolean {
    const nextAt = run.automationState.nextCheckpointAt;
    if (!nextAt || Date.now() < nextAt) return false;
    return run.checkpointPolicy.onWorkflowStates.includes(run.workflowState);
  }

  private findRunByProposal(sessionId: string, proposalId: string): TeamRunRecord | undefined {
    return this.teamStore.listRecentTeamRuns(sessionId, 100).find((candidate) => {
      const latest = candidate.latestOutput as { proposalId?: string } | undefined;
      return latest?.proposalId === proposalId;
    });
  }

  private recordAction(
    run: TeamRunRecord,
    actionType: import("./contracts.js").ActionJournalType,
    state: import("./contracts.js").ActionJournalState,
    summary: string,
    result?: Record<string, unknown>,
    error?: string,
  ): void {
    const suffix = result?.experimentId ?? result?.proposalId ?? result?.workflowState ?? summary;
    this.teamStore.saveActionJournal({
      actionId: nanoid(),
      sessionId: run.sessionId,
      runId: run.id,
      actionType,
      state,
      dedupeKey: `${actionType}:${String(suffix)}`,
      summary,
      result,
      error,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
  }
}

function classifyFinishedSimulationOutcome(
  charter: SimulationRunRecord["charter"],
  exitCode: number | null,
  beforeMetrics: Record<string, number>,
  afterMetrics: Record<string, number>,
): ExperimentResult["outcomeStatus"] {
  if (exitCode === null) return "inconclusive";
  if (exitCode !== 0) return "crash";

  const metricName = charter.evaluationMetric;
  const after = afterMetrics[metricName];
  const before = beforeMetrics[metricName];

  if (typeof after !== "number") {
    return "inconclusive";
  }

  const direction = charter.optimizationGoal ?? inferOptimizationGoal(metricName);
  if (typeof charter.successThreshold === "number" && meetsThreshold(after, charter.successThreshold, direction)) {
    return "success";
  }
  if (typeof charter.regressThreshold === "number" && exceedsRegressionThreshold(after, charter.regressThreshold, direction)) {
    return "regression";
  }
  if (typeof before === "number") {
    if (isImprovement(after, before, direction)) return "success";
    if (isRegression(after, before, direction)) return "regression";
  }

  return "inconclusive";
}

function inferOptimizationGoal(metricName: string): "minimize" | "maximize" {
  return /(loss|error|latency|time|memory|cost|perplexity|bpb|wer|cer)/i.test(metricName)
    ? "minimize"
    : "maximize";
}

function meetsThreshold(
  value: number,
  threshold: number,
  direction: "minimize" | "maximize",
): boolean {
  return direction === "minimize" ? value <= threshold : value >= threshold;
}

function exceedsRegressionThreshold(
  value: number,
  threshold: number,
  direction: "minimize" | "maximize",
): boolean {
  return direction === "minimize" ? value >= threshold : value <= threshold;
}

function isImprovement(
  after: number,
  before: number,
  direction: "minimize" | "maximize",
): boolean {
  return direction === "minimize" ? after < before : after > before;
}

function isRegression(
  after: number,
  before: number,
  direction: "minimize" | "maximize",
): boolean {
  return direction === "minimize" ? after > before : after < before;
}
