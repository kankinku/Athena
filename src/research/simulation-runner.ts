import type { ConnectionPool } from "../remote/connection-pool.js";
import type { MetricCollector } from "../metrics/collector.js";
import type { MetricStore } from "../metrics/store.js";
import type { RemoteExecutor } from "../remote/executor.js";
import type { ExperimentBrancher } from "../experiments/branching.js";
import type { ExperimentCharter, ExperimentResult } from "./contracts.js";
import type { TeamStore } from "./team-store.js";
import { buildResultDecision } from "./decision-engine.js";

export interface SimulationLaunchResult {
  simulationId: string;
  taskId: string;
  branchName?: string;
  logPath?: string;
}

export class SimulationRunner {
  constructor(
    private executor: RemoteExecutor,
    private connectionPool: ConnectionPool,
    private metricStore: MetricStore,
    private metricCollector: MetricCollector,
    private brancher: ExperimentBrancher,
    private teamStore: TeamStore,
    private sessionIdProvider: () => string,
    private getBudgetUsage: () => { totalCostUsd: number; lastInputTokens: number },
  ) {}

  canLaunch(charter: ExperimentCharter): { ok: boolean; reason?: string } {
    const sessionId = this.sessionIdProvider();
    if (!charter.command.trim()) {
      return { ok: false, reason: "command is required" };
    }
    if (!charter.machineId.trim()) {
      return { ok: false, reason: "machineId is required" };
    }
    if (!charter.evaluationMetric.trim()) {
      return { ok: false, reason: "evaluationMetric is required" };
    }
    if (!charter.allowedChangeUnit.trim()) {
      return { ok: false, reason: "allowedChangeUnit is required" };
    }
    if (!charter.rollbackPlan.trim()) {
      return { ok: false, reason: "rollbackPlan is required" };
    }
    if (!charter.description.trim()) {
      return { ok: false, reason: "description is required" };
    }
    if (charter.patchScope.length === 0) {
      return { ok: false, reason: "patchScope must include at least one change unit" };
    }
    if (charter.branchName && !charter.repoPath?.trim()) {
      return { ok: false, reason: "repoPath is required when branchName is provided" };
    }
    if ((charter.budget.maxWallClockMinutes ?? 0) < 0) {
      return { ok: false, reason: "maxWallClockMinutes must be >= 0" };
    }
    if ((charter.budget.maxConcurrentRuns ?? 1) <= 0) {
      return { ok: false, reason: "maxConcurrentRuns must be >= 1" };
    }
    if (sessionId && sessionId !== "pending" && charter.budget.maxConcurrentRuns !== undefined) {
      const runningCount = this.teamStore.listRunningSimulationRuns(sessionId).length;
      if (runningCount >= charter.budget.maxConcurrentRuns) {
        return { ok: false, reason: `maxConcurrentRuns reached (${runningCount}/${charter.budget.maxConcurrentRuns})` };
      }
    }
    return { ok: true };
  }

  async launch(charter: ExperimentCharter): Promise<SimulationLaunchResult> {
    const budgetCheck = this.canLaunch(charter);
    if (!budgetCheck.ok) {
      throw new Error(budgetCheck.reason);
    }

    const run = this.teamStore.createSimulationRun(
      this.sessionIdProvider(),
      charter.proposalId,
      charter,
    );

    this.teamStore.saveExperimentLineage(this.sessionIdProvider(), {
      lineageId: `${charter.proposalId}-${run.id}-baseline`,
      proposalId: charter.proposalId,
      experimentId: run.id,
      relatedExperimentId: charter.baselineTaskId,
      relationType: charter.baselineTaskId ? "baseline_of" : "derived_from",
      summary: charter.baselineTaskId
        ? `Simulation ${run.id} compares against baseline task ${charter.baselineTaskId}`
        : `Simulation ${run.id} created from proposal ${charter.proposalId}`,
      createdAt: nowTimestamp(),
    });

    try {
      let branchName = charter.branchName;
      if (!branchName && charter.repoPath) {
        branchName = await this.brancher.createBranch(
          charter.machineId,
          charter.repoPath,
          charter.description,
        ) ?? undefined;
      }

      const proc = await this.executor.execBackground(
        charter.machineId,
        charter.command,
        undefined,
        {
          metricNames: charter.metricNames,
          metricPatterns: charter.metricPatterns,
        },
      );

      const taskId = `${proc.machineId}:${proc.pid}`;
      this.teamStore.updateSimulationRun(run.id, {
        taskKey: taskId,
        status: "running",
      });

      return {
        simulationId: run.id,
        taskId,
        branchName,
        logPath: proc.logPath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result: ExperimentResult = {
        experimentId: run.id,
        proposalId: charter.proposalId,
        outcomeStatus: "crash",
        beforeMetrics: {},
        afterMetrics: {},
        resourceDelta: {},
        surprisingFindings: [message],
        notes: `Launch failed: ${message}`,
      };
      this.teamStore.updateSimulationRun(run.id, {
        status: "launch_failed",
        result,
      });
      throw error;
    }
  }

  finalize(simulationId: string, result: ExperimentResult): ExperimentResult {
    this.teamStore.updateSimulationRun(simulationId, {
      status: result.outcomeStatus,
      result,
    });
    return result;
  }

  summarizeTask(taskId: string): Record<string, number> {
    const summary = this.metricStore.getTaskSummary(taskId);
    const latest: Record<string, number> = {};
    for (const [metric, info] of Object.entries(summary)) {
      latest[metric] = info.latest;
    }
    return latest;
  }

  async enforceBudgets(): Promise<ExperimentResult[]> {
    const sessionId = this.sessionIdProvider();
    if (!sessionId || sessionId === "pending") return [];

    const usage = this.getBudgetUsage();
    const runs = this.teamStore.listRunningSimulationRuns(sessionId);
    const exceeded: ExperimentResult[] = [];

    for (const run of runs) {
      const reasons = this.getBudgetReasons(run, usage);
      if (reasons.length === 0) continue;

      const taskId = run.taskKey;
      if (taskId) {
        const [machineId, pidText] = taskId.split(":");
        const pid = Number.parseInt(pidText, 10);
        if (!Number.isNaN(pid)) {
          const running = await this.executor.isRunning(machineId, pid).catch(() => false);
          if (running) {
            await this.connectionPool.exec(machineId, `kill -TERM ${pid}`);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          await this.metricCollector.collectAll().catch(() => {});
          this.metricCollector.removeSource(taskId);
          this.executor.removeBackgroundProcess(taskId);
        }
      }

      const result: ExperimentResult = {
        experimentId: run.id,
        proposalId: run.proposalId,
        taskId: run.taskKey,
        branchName: run.charter.branchName,
        outcomeStatus: "budget_exceeded",
        beforeMetrics: run.charter.baselineTaskId
          ? this.summarizeTask(run.charter.baselineTaskId)
          : {},
        afterMetrics: run.taskKey ? this.summarizeTask(run.taskKey) : {},
        resourceDelta: {},
        surprisingFindings: reasons,
        notes: `Budget exceeded: ${reasons.join("; ")}`,
      };

      this.teamStore.updateSimulationRun(run.id, {
        status: "budget_exceeded",
        result,
      });
      const proposal = this.teamStore.listProposalBriefs(sessionId).find((item) => item.proposalId === run.proposalId);
      const latestDecision = this.teamStore.getLatestDecisionRecord(sessionId, run.proposalId);
      const decision = buildResultDecision(result, {
        proposalTitle: proposal?.title,
        createdBy: "system:budget-enforcer",
        evidenceLinks: proposal?.claimIds,
        supersedesDecisionId: latestDecision?.decisionId,
      });
      this.teamStore.saveDecisionRecord(sessionId, decision);
      if (proposal) {
        const triggerCondition = proposal.reconsiderConditions[0] ?? "Retry when budget pressure is reduced or a cheaper baseline appears";
        this.teamStore.saveReconsiderationTrigger(sessionId, {
          triggerId: `${decision.decisionId}-budget`,
          decisionId: decision.decisionId,
          triggerType: "cost_reduced",
          triggerCondition,
          status: "open",
        });
      }
      exceeded.push(result);
    }

    return exceeded;
  }

  private getBudgetReasons(
    run: ReturnType<TeamStore["listRunningSimulationRuns"]>[number],
    usage: { totalCostUsd: number; lastInputTokens: number },
  ): string[] {
    const reasons: string[] = [];
    const budget = run.budget ?? run.charter.budget;

    if (budget.maxWallClockMinutes !== undefined) {
      const elapsedMinutes = (Date.now() - run.createdAt) / 60_000;
      if (elapsedMinutes >= budget.maxWallClockMinutes) {
        reasons.push(`wall clock ${elapsedMinutes.toFixed(1)}m >= ${budget.maxWallClockMinutes}m`);
      }
    }

    if (budget.maxCostUsd !== undefined && usage.totalCostUsd >= budget.maxCostUsd) {
      reasons.push(`cost $${usage.totalCostUsd.toFixed(4)} >= $${budget.maxCostUsd.toFixed(4)}`);
    }

    if (budget.maxInputTokens !== undefined && usage.lastInputTokens >= budget.maxInputTokens) {
      reasons.push(`input tokens ${usage.lastInputTokens} >= ${budget.maxInputTokens}`);
    }

    if (budget.maxIterations !== undefined && run.taskKey) {
      const summary = this.metricStore.getTaskSummary(run.taskKey);
      const maxSamples = Object.values(summary).reduce(
        (max, metric) => Math.max(max, metric.count),
        0,
      );
      if (maxSamples >= budget.maxIterations) {
        reasons.push(`iterations ${maxSamples} >= ${budget.maxIterations}`);
      }
    }

    return reasons;
  }
}

function nowTimestamp(): number {
  return Date.now();
}
