import { truncate } from "../ui/format.js";
import type { IngestionSourceRecord, TeamRunRecord } from "./contracts.js";
import type { TeamStore } from "./team-store.js";
import type { TeamOrchestrator } from "./team-orchestrator.js";

interface BootstrapContext {
  sessionId: string;
  prompt: string;
  provider: string;
  model?: string | null;
}

export class ResearchSessionBootstrapper {
  constructor(
    private teamStore: TeamStore,
    private teamOrchestrator: TeamOrchestrator,
  ) {}

  ensurePromptRun(context: BootstrapContext): TeamRunRecord {
    const existing = this.teamStore.listRecentTeamRuns(context.sessionId, 1)[0];
    if (existing) {
      return existing;
    }

    const run = this.teamOrchestrator.startRunForSession(context.sessionId, context.prompt);
    const promptPreview = truncate(context.prompt, 120, true);

    const latestOutput = {
      ...(run.latestOutput ?? {}),
      source: "initial_prompt",
      provider: context.provider,
      model: context.model ?? "default",
      promptPreview,
      bootstrappedAt: Date.now(),
    };

    const updated = this.teamStore.updateTeamRun(run.id, {
      latestOutput,
    }) ?? run;

    this.teamOrchestrator.checkpointRun(updated.id, "initial prompt accepted", {
      provider: context.provider,
      model: context.model ?? "default",
      promptPreview,
    });

    this.ensurePromptSource(context.sessionId, context.prompt, promptPreview);

    return updated;
  }

  private ensurePromptSource(sessionId: string, prompt: string, promptPreview: string): void {
    const existing = this.teamStore.listIngestionSources(sessionId).some(
      (source) => source.sourceType === "manual" && source.title === "Initial operator prompt",
    );
    if (existing) {
      return;
    }

    const now = Date.now();
    const record: IngestionSourceRecord = {
      sourceId: `manual-${now}`,
      sourceType: "manual",
      title: "Initial operator prompt",
      status: "pending",
      notes: `${promptPreview}\n\n${prompt}`,
      createdAt: now,
      updatedAt: now,
    };
    this.teamStore.saveIngestionSource(sessionId, record);
  }
}
