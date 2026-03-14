import type { ConnectionPool } from "../remote/connection-pool.js";
import type { MetricCollector } from "../metrics/collector.js";
import type { MetricStore } from "../metrics/store.js";
import type { RemoteExecutor } from "../remote/executor.js";
import type { ExperimentBrancher } from "../experiments/branching.js";
import type { ExperimentCharter, ExperimentResult } from "./contracts.js";
import type { TeamStore } from "./team-store.js";
import { buildResultDecision } from "./decision-engine.js";
import { nanoid } from "nanoid";

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
    const parentRun = this.teamStore.listRecentTeamRuns(sessionId, 50).find((candidate) => {
      const output = candidate.latestOutput as { proposalId?: string } | undefined;
      return output?.proposalId === charter.proposalId;
    });
    const proposal = this.teamStore.listProposalBriefs(sessionId).find((item) => item.proposalId === charter.proposalId);
    const autonomyPolicy = parentRun?.automationPolicy.mode === "fully-autonomous"
      ? parentRun.automationPolicy.autonomyPolicy
      : undefined;
    if (parentRun?.automationPolicy.mode === "fully-autonomous" && !autonomyPolicy) {
      return { ok: false, reason: "fully autonomous run is missing an autonomy policy" };
    }
    if (autonomyPolicy?.requireRollbackPlan && !charter.rollbackPlan.trim()) {
      return { ok: false, reason: "fully autonomous experiments require a rollback plan" };
    }
    if (
      autonomyPolicy?.allowedMachineIds?.length
      && !autonomyPolicy.allowedMachineIds.includes(charter.machineId)
    ) {
      return { ok: false, reason: `machine ${charter.machineId} is outside the autonomous machine policy` };
    }
    if (
      autonomyPolicy?.allowedToolFamilies?.length
      && !autonomyPolicy.allowedToolFamilies.includes(inferCommandToolFamily(charter.command))
    ) {
      return { ok: false, reason: "experiment command violates the autonomous tool-family policy" };
    }
    if (
      autonomyPolicy?.maxWallClockMinutes !== undefined
      && charter.budget.maxWallClockMinutes !== undefined
      && charter.budget.maxWallClockMinutes > autonomyPolicy.maxWallClockMinutes
    ) {
      return { ok: false, reason: "experiment wall clock budget exceeds autonomous policy" };
    }
    if (
      autonomyPolicy?.maxCostUsd !== undefined
      && charter.budget.maxCostUsd !== undefined
      && charter.budget.maxCostUsd > autonomyPolicy.maxCostUsd
    ) {
      return { ok: false, reason: "experiment cost budget exceeds autonomous policy" };
    }
    if (
      autonomyPolicy
      && proposal
      && compareRiskTier(inferProposalRiskTier(proposal), autonomyPolicy.maxRiskTier) > 0
    ) {
      return { ok: false, reason: "proposal risk tier exceeds the autonomous risk policy" };
    }
    if (
      parentRun
      && parentRun.automationPolicy.mode === "fully-autonomous"
      && parentRun.automationPolicy.maxAutoExperiments > 0
      && this.teamStore.listRecentSimulationRuns(sessionId, 100)
        .filter((simulation) => simulation.proposalId === charter.proposalId).length >= parentRun.automationPolicy.maxAutoExperiments
    ) {
      return { ok: false, reason: "autonomous experiment cap reached for this proposal" };
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
    const sessionId = this.sessionIdProvider();
    this.teamStore.saveActionJournal({
      actionId: nanoid(),
      sessionId,
      runId: run.id,
      actionType: "simulation_launch",
      state: "issued",
      dedupeKey: `simulation_launch:${run.id}`,
      summary: `launching simulation ${run.id}`,
      payload: {
        proposalId: charter.proposalId,
        machineId: charter.machineId,
        command: charter.command,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      heartbeatAt: Date.now(),
    });

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
        {
          actorRole: "agent",
          machineId: charter.machineId,
          runId: run.id,
          toolName: "simulation_start",
          toolFamily: "research-orchestration",
          networkAccess: charter.machineId !== "local",
        },
      );

      const taskId = `${proc.machineId}:${proc.pid}`;
      this.teamStore.updateSimulationRun(run.id, {
        taskKey: taskId,
        logPath: proc.logPath,
        status: "running",
      });
      this.teamStore.saveActionJournal({
        actionId: nanoid(),
        sessionId,
        runId: run.id,
        actionType: "simulation_launch",
        state: "running",
        dedupeKey: `simulation_launch:${run.id}`,
        summary: `simulation ${run.id} is running`,
        result: {
          taskId,
          logPath: proc.logPath,
          machineId: charter.machineId,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        heartbeatAt: Date.now(),
      });

      return {
        simulationId: run.id,
        taskId,
        branchName,
        logPath: proc.logPath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.teamStore.saveActionJournal({
        actionId: nanoid(),
        sessionId,
        runId: run.id,
        actionType: "simulation_launch",
        state: "needs_recovery",
        dedupeKey: `simulation_launch:${run.id}`,
        summary: `simulation ${run.id} failed to launch`,
        error: message,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        heartbeatAt: Date.now(),
      });
      this.teamStore.saveIncident({
        incidentId: `incident-simulation-launch-${run.id}`,
        sessionId,
        runId: run.id,
        proposalId: charter.proposalId,
        experimentId: run.id,
        type: "simulation_crash",
        severity: "critical",
        summary: "Simulation launch failed",
        details: message,
        status: "open",
        actionRequired: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
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
      const parentRun = this.teamStore
        .listRecentTeamRuns(this.sessionIdProvider(), 50)
        .find((candidate) => {
          const output = candidate.latestOutput as { proposalId?: string } | undefined;
          return output?.proposalId === charter.proposalId;
        });
      if (parentRun) {
        this.teamStore.recordAutomationCheckpoint(parentRun.id, "launch_failed", {
          reason: message,
          proposalId: charter.proposalId,
          simulationId: run.id,
        });
      }
      throw error;
    }
  }

  finalize(simulationId: string, result: ExperimentResult): ExperimentResult {
    const simulation = this.teamStore.getSimulationRun(simulationId);
    this.teamStore.updateSimulationRun(simulationId, {
      status: result.outcomeStatus,
      result,
    });
    if (simulation) {
      this.teamStore.saveActionJournal({
        actionId: nanoid(),
        sessionId: simulation.sessionId,
        runId: simulationId,
        actionType: "simulation_finalize",
        state: "committed",
        dedupeKey: `simulation_finalize:${simulationId}`,
        summary: `simulation ${simulationId} finalized`,
        result: {
          proposalId: result.proposalId,
          outcomeStatus: result.outcomeStatus,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      if (result.outcomeStatus === "crash" || result.outcomeStatus === "budget_exceeded") {
        this.teamStore.saveIncident({
          incidentId: `incident-finalize-${simulationId}-${result.outcomeStatus}`,
          sessionId: simulation.sessionId,
          runId: simulationId,
          proposalId: result.proposalId,
          experimentId: simulationId,
          type: result.outcomeStatus === "budget_exceeded" ? "budget_exceeded" : "simulation_crash",
          severity: result.outcomeStatus === "budget_exceeded" ? "warning" : "critical",
          summary: `Simulation finalized with ${result.outcomeStatus}`,
          details: result.notes,
          status: "open",
          actionRequired: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
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
            await this.connectionPool.exec(
              machineId,
              `kill -TERM ${pid}`,
              undefined,
              {
                actorRole: "system",
                machineId,
                runId: run.id,
                toolName: "budget_enforcer",
                toolFamily: "research-orchestration",
                networkAccess: machineId !== "local",
                destructive: true,
              },
            );
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
      this.teamStore.saveActionJournal({
        actionId: nanoid(),
        sessionId,
        runId: run.id,
        actionType: "simulation_budget_enforcement",
        state: "committed",
        dedupeKey: `simulation_budget_enforcement:${run.id}`,
        summary: `budget enforcement completed for ${run.id}`,
        result: {
          proposalId: run.proposalId,
          reasons,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      this.teamStore.saveIncident({
        incidentId: `incident-budget-${run.id}`,
        sessionId,
        runId: run.id,
        proposalId: run.proposalId,
        experimentId: run.id,
        type: "budget_exceeded",
        severity: "warning",
        summary: "Simulation budget exceeded",
        details: reasons.join("; "),
        status: "open",
        actionRequired: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
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

function inferCommandToolFamily(command: string): string {
  const token = command.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (token.startsWith("python")) return "python";
  if (token === "node") return "node";
  if (token === "npm") return "npm";
  if (token === "pnpm") return "pnpm";
  if (token === "yarn") return "yarn";
  if (token === "bash") return "bash";
  if (token === "sh") return "sh";
  if (token === "uv") return "uv";
  return token;
}

function inferProposalRiskTier(
  proposal: ReturnType<TeamStore["listProposalBriefs"]>[number],
): "safe" | "moderate" | "high" {
  const scoreRisk = proposal.scorecard?.risk;
  if (scoreRisk !== undefined) {
    if (scoreRisk >= 0.66) return "high";
    if (scoreRisk >= 0.36) return "moderate";
    return "safe";
  }
  const lowerRisk = proposal.expectedRisk.toLowerCase();
  if (/(high|severe|major)/.test(lowerRisk)) return "high";
  if (/(moderate|medium)/.test(lowerRisk)) return "moderate";
  return "safe";
}

function compareRiskTier(left: "safe" | "moderate" | "high", right: "safe" | "moderate" | "high"): number {
  const order = { safe: 0, moderate: 1, high: 2 };
  return order[left] - order[right];
}
