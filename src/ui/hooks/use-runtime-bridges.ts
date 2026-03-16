import { useEffect } from "react";
import type { AthenaRuntime } from "../../init.js";
import { createMonitorTickHandler, createWakePromptHandler } from "../../core/task-poller.js";
import type { TeamRunRecord } from "../../research/contracts.js";

interface RuntimeBridgesOptions {
  activeResearchRun: TeamRunRecord | null;
  addMessage: (role: "system", content: string) => number;
  handleSubmit: (input: string) => Promise<void>;
  handleSyntheticSubmit: (input: string, label?: string) => Promise<void>;
  isStreaming: boolean;
  runtime: AthenaRuntime;
}

export function useRuntimeBridges({
  activeResearchRun,
  addMessage,
  handleSubmit,
  handleSyntheticSubmit,
  isStreaming,
  runtime,
}: RuntimeBridgesOptions): void {
  useEffect(() => {
    runtime.openaiOAuth.onAuthUrl = (url) => {
      addMessage("system", url);
    };
    return () => {
      runtime.openaiOAuth.onAuthUrl = null;
    };
  }, [addMessage, runtime.openaiOAuth]);

  useEffect(() => {
    const onTick = createMonitorTickHandler({
      executor: runtime.executor,
      metricStore: runtime.metricStore,
      isBusy: () => isStreaming,
      onPrompt: (message) => {
        void handleSubmit(message);
      },
    });
    runtime.monitorManager.on("tick", onTick);
    return () => {
      runtime.monitorManager.removeListener("tick", onTick);
    };
  }, [handleSubmit, isStreaming, runtime]);

  useEffect(() => {
    const onWake = createWakePromptHandler({
      executor: runtime.executor,
      metricStore: runtime.metricStore,
      isBusy: () => isStreaming,
      onPrompt: (message) => {
        void handleSubmit(message);
      },
      onSystemMessage: (message) => {
        addMessage("system", message);
      },
    });
    runtime.sleepManager.on("wake", onWake);
    return () => {
      runtime.sleepManager.removeListener("wake", onWake);
    };
  }, [addMessage, handleSubmit, isStreaming, runtime]);

  useEffect(() => {
    const sessionId = runtime.orchestrator.currentSession?.id;
    if (!sessionId) {
      return;
    }

    const continuation = runtime.loopController.getAutonomousContinuationForSession(sessionId, {
      isStreaming,
      isSleeping: runtime.sleepManager.isSleeping,
      monitorActive: runtime.monitorManager.isActive,
    });
    if (!continuation) {
      return;
    }

    const timer = setTimeout(() => {
      const nextContinuation = runtime.loopController.getAutonomousContinuationForSession(sessionId, {
        isStreaming,
        isSleeping: runtime.sleepManager.isSleeping,
        monitorActive: runtime.monitorManager.isActive,
      });
      if (!nextContinuation) {
        return;
      }
      void handleSyntheticSubmit(
        nextContinuation.prompt,
        nextContinuation.label,
      );
    }, 1500);

    return () => {
      clearTimeout(timer);
    };
  }, [activeResearchRun, handleSyntheticSubmit, isStreaming, runtime]);
}
