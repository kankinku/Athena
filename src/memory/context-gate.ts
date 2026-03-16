import { getCheckpointThreshold } from "./token-estimator.js";
import type { MemoryStore } from "./memory-store.js";
import type { RemoteExecutor } from "../remote/executor.js";
import type { MetricStore } from "../metrics/store.js";
import type { GraphMemory } from "./graph-memory.js";
import type { TeamStore } from "../research/team-store.js";

export interface ContextGateConfig {
  /** Override checkpoint threshold (for testing). */
  thresholdOverride?: number;
}

/**
 * ContextGate monitors token usage and triggers checkpoints when
 * the context window is filling up.
 *
 * Uses actual input_tokens from the API response (reported in DoneEvent.usage)
 * rather than re-estimating from history text.
 *
 * On checkpoint:
 * 1. Save active tasks + latest metrics to memory
 * 2. Build a briefing from the memory tree
 * 3. Orchestrator resets provider history with the briefing
 */
export class ContextGate {
  private memory: MemoryStore;
  private executor: RemoteExecutor | null = null;
  private metricStore: MetricStore | null = null;
  private graphMemory: GraphMemory | null = null;
  private teamStore: TeamStore | null = null;
  private config: ContextGateConfig;

  constructor(memory: MemoryStore, config: ContextGateConfig = {}) {
    this.memory = memory;
    this.config = config;
  }

  /** Update the memory store's session ID when a new session starts. */
  onSessionStart(sessionId: string): void {
    this.memory.setSession(sessionId);
  }

  setExecutor(executor: RemoteExecutor): void {
    this.executor = executor;
  }

  setMetricStore(store: MetricStore): void {
    this.metricStore = store;
  }

  setGraphMemory(graphMemory: GraphMemory): void {
    this.graphMemory = graphMemory;
  }

  setTeamStore(teamStore: TeamStore): void {
    this.teamStore = teamStore;
  }

  /**
   * Check if actual input token count exceeds checkpoint threshold.
   * Called by Orchestrator after each send() completes.
   */
  checkThreshold(model: string, inputTokens: number): boolean {
    if (inputTokens === 0) return false;
    const threshold =
      this.config.thresholdOverride ?? getCheckpointThreshold(model);
    return inputTokens >= threshold;
  }

  /**
   * Perform a checkpoint with a model-generated gist.
   * Saves active state + gist to memory, returns the briefing.
   */
  performCheckpointWithGist(gist: string): string {
    // Save the model's gist
    this.memory.write(
      "/context/gist",
      "Model-generated summary of conversation before checkpoint",
      gist,
    );

    // Save active tasks to /context/active-tasks
    this.saveActiveTasks();
    this.saveTeamHandoffs();

    return this.buildBriefing(gist);
  }

  /**
   * Perform a checkpoint without a gist (fallback).
   */
  performCheckpointFromOrchestrator(): string {
    this.saveActiveTasks();
    this.saveTeamHandoffs();
    return this.buildBriefing(null);
  }

  private saveActiveTasks(): void {
    if (!this.executor) return;

    const tasks = this.executor.getBackgroundProcesses();
    if (tasks.length === 0) return;

    const taskLines = tasks.map((t) => {
      const latestMetrics = this.getLatestMetrics(t.machineId, t.pid);
      return [
        `${t.machineId}:${t.pid} — ${t.command.slice(0, 80)}`,
        latestMetrics ? `  metrics: ${latestMetrics}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    });

    this.memory.write(
      "/context/active-tasks",
      `${tasks.length} running task(s)`,
      taskLines.join("\n\n"),
    );

  }

  /** Build a checkpoint briefing string from the memory tree + optional gist. */
  buildBriefing(gist: string | null): string {
    const tree = this.memory.formatTree("/");
    const handoff = this.buildTeamHandoffSection();
    const graphContext = this.buildGraphContextSection();

    const parts = [
      "=== CONTEXT CHECKPOINT ===",
      "You are Athena, continuing an autonomous research loop session.",
      "Your previous conversation has been archived.",
    ];

    if (gist) {
      parts.push(
        "\n## Your gist (written by you before the checkpoint):\n",
        gist,
      );
    }

    parts.push(
      "\n## Team handoff state:\n",
      handoff,
      "\n## Graph context:\n",
      graphContext,
      "\n## Memory tree:\n",
      tree,
      "\nUse memory_read(path) for details on any item above.",
      "Use memory_write to store new findings as you work.",
      "Check /sources/ for prior work you've built on — cite these in any writeups.",
      "Continue working toward your goal.",
    );

    return parts.join("\n");
  }

  private saveTeamHandoffs(): void {
    if (!this.teamStore) return;
    const sessionId = this.memory.getSessionId();
    const runs = this.teamStore.listRecentTeamRuns(sessionId, 5);
    const proposals = this.teamStore.listProposalBriefs(sessionId).slice(0, 5);
    const simulations = this.teamStore.listRecentSimulationRuns(sessionId, 5);

    if (runs.length > 0) {
      this.memory.write(
        "/context/team-runs",
        `${runs.length} tracked team run(s)`,
        runs
          .map(
            (run) =>
              `${run.id}: stage=${run.currentStage} status=${run.status} goal=${run.goal}`,
          )
          .join("\n"),
      );
    }

    if (proposals.length > 0) {
      this.memory.write(
        "/context/proposals",
        `${proposals.length} tracked proposal(s)`,
        proposals
          .map(
            (proposal) =>
              `${proposal.proposalId}: ${proposal.title} [${proposal.status}] -> ${proposal.expectedGain}`,
          )
          .join("\n"),
      );
    }

    if (simulations.length > 0) {
      this.memory.write(
        "/context/simulations",
        `${simulations.length} tracked simulation run(s)`,
        simulations
          .map(
            (simulation) =>
              `${simulation.id}: proposal=${simulation.proposalId} status=${simulation.status} task=${simulation.taskKey ?? "n/a"}`,
          )
          .join("\n"),
      );
    }
  }

  private buildTeamHandoffSection(): string {
    if (!this.teamStore) return "(team orchestration not configured)";
    const sessionId = this.memory.getSessionId();
    const runs = this.teamStore.listRecentTeamRuns(sessionId, 3);
    const proposals = this.teamStore.listProposalBriefs(sessionId).slice(0, 3);
    const simulations = this.teamStore.listRecentSimulationRuns(sessionId, 3);

    const lines: string[] = [];
    if (runs.length > 0) {
      lines.push("Runs:");
      lines.push(
        ...runs.map(
          (run) => `- ${run.id}: ${run.currentStage} / ${run.status} / ${run.goal}`,
        ),
      );
    }
    if (proposals.length > 0) {
      lines.push("Proposals:");
      lines.push(
        ...proposals.map(
          (proposal) =>
            `- ${proposal.proposalId}: ${proposal.title} [${proposal.status}] score=${proposal.scorecard?.decisionScore ?? "n/a"}`,
        ),
      );
    }
    if (simulations.length > 0) {
      lines.push("Simulations:");
      lines.push(
        ...simulations.map(
          (simulation) =>
            `- ${simulation.id}: proposal=${simulation.proposalId} status=${simulation.status} task=${simulation.taskKey ?? "n/a"}`,
        ),
      );
    }

    return lines.length > 0 ? lines.join("\n") : "(no team handoff records yet)";
  }

  private buildGraphContextSection(): string {
    if (!this.graphMemory || !this.teamStore) return "(graph retrieval not configured)";
    const sessionId = this.memory.getSessionId();
    const rootIds: string[] = [];
    const queryTerms: string[] = [];

    for (const run of this.teamStore.listRecentTeamRuns(sessionId, 2)) {
      rootIds.push(`/research/runs/${run.id}`);
      queryTerms.push(run.goal);
    }
    for (const proposal of this.teamStore.listProposalBriefs(sessionId).slice(0, 2)) {
      rootIds.push(`/research/proposals/${proposal.proposalId}`);
      queryTerms.push(proposal.title, proposal.expectedGain);
    }

    if (rootIds.length === 0) return "(no graph roots yet)";
    const subgraph = this.graphMemory.buildRankedSubgraph(rootIds, {
      query: queryTerms.join(" "),
      depth: 1,
      maxNodes: 12,
    });
    if (subgraph.nodes.length === 0) return "(no graph roots yet)";
    const nodeLines = subgraph.nodes.map((node) => `- ${node.id} [${node.kind}] ${node.gist ?? node.label}`);
    const edgeLines = subgraph.edges.map((edge) => `- ${edge.sourceId} --${edge.relationship}--> ${edge.targetId}`);
    return ["Nodes:", ...nodeLines, edgeLines.length > 0 ? "Edges:" : null, ...edgeLines]
      .filter(Boolean)
      .join("\n");
  }

  private getLatestMetrics(machineId: string, pid: number): string | null {
    if (!this.metricStore) return null;

    const taskId = `${machineId}:${pid}`;
    const names = this.metricStore.getMetricNames(taskId);
    if (names.length === 0) return null;

    const parts: string[] = [];
    for (const name of names.slice(0, 5)) {
      const series = this.metricStore.getSeries(taskId, name, 1);
      if (series.length > 0) {
        parts.push(`${name}=${series[0].value}`);
      }
    }

    return parts.length > 0 ? parts.join(", ") : null;
  }
}
