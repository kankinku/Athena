import { useEffect } from "react";
import type { AthenaRuntime } from "../../init.js";
import { createMonitorTickHandler, createWakePromptHandler } from "../../core/task-poller.js";

interface RuntimeBridgesOptions {
  addMessage: (role: "system", content: string) => number;
  handleSubmit: (input: string) => Promise<void>;
  isStreaming: boolean;
  runtime: AthenaRuntime;
}

export function useRuntimeBridges({
  addMessage,
  handleSubmit,
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
}
