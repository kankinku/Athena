import type { AgentEvent, Attachment, Session } from "../providers/types.js";
import type { Orchestrator } from "../core/orchestrator.js";
import type { TeamRunRecord } from "./contracts.js";
import type { ResearchAutomationManager } from "./automation-manager.js";
import type { ResearchSessionBootstrapper } from "./session-bootstrap.js";
import type { TeamStore } from "./team-store.js";
import {
  buildAutonomousContinuationPrompt,
  shouldContinueAutonomously,
  type AutonomousContinuationContext,
} from "./autonomous-loop.js";

export interface AutonomousContinuationDecision {
  label: string;
  prompt: string;
  run: TeamRunRecord;
}

export interface AutomationTickResult {
  activeRun: TeamRunRecord | null;
  updates: TeamRunRecord[];
}

export class ResearchLoopController {
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly bootstrapper: ResearchSessionBootstrapper,
    private readonly teamStore: TeamStore,
    private readonly automationManager?: ResearchAutomationManager,
  ) {}

  async ensureRunForPrompt(prompt: string): Promise<{ run: TeamRunRecord; session: Session }> {
    const session = await this.orchestrator.ensureSession();
    const provider = this.orchestrator.currentProvider;
    if (!provider) {
      throw new Error("No active provider for loop control");
    }

    const run = this.bootstrapper.ensurePromptRun({
      sessionId: session.id,
      prompt,
      provider: provider.name,
      model: provider.currentModel,
    });

    return { run, session };
  }

  async *sendUserPrompt(prompt: string, attachments?: Attachment[]): AsyncGenerator<AgentEvent> {
    await this.ensureRunForPrompt(prompt);
    yield* this.orchestrator.send(prompt, attachments);
  }

  async *sendSyntheticPrompt(prompt: string): AsyncGenerator<AgentEvent> {
    yield* this.orchestrator.send(prompt);
  }

  getActiveRunForSession(sessionId: string): TeamRunRecord | null {
    const recentRuns = this.teamStore.listRecentTeamRuns(sessionId, 10);
    return recentRuns.find((item) => item.status === "active") ?? recentRuns[0] ?? null;
  }

  buildAutonomousContinuation(
    run: TeamRunRecord | null,
    context: AutonomousContinuationContext,
  ): AutonomousContinuationDecision | null {
    if (!shouldContinueAutonomously(run, context) || !run) {
      return null;
    }

    return {
      run,
      prompt: buildAutonomousContinuationPrompt(run),
      label: `Autonomous loop continuing (${run.currentStage}/${run.workflowState})...`,
    };
  }

  getAutonomousContinuationForSession(
    sessionId: string,
    context: AutonomousContinuationContext,
  ): AutonomousContinuationDecision | null {
    return this.buildAutonomousContinuation(this.getActiveRunForSession(sessionId), context);
  }

  async tickAutomation(sessionId: string): Promise<AutomationTickResult> {
    const updates = this.automationManager
      ? await this.automationManager.tickSession(sessionId)
      : [];

    return {
      updates,
      activeRun: this.getActiveRunForSession(sessionId),
    };
  }
}
