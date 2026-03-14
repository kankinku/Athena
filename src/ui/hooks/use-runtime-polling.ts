import { useEffect, useState } from "react";
import type { AthenaRuntime } from "../../init.js";
import { pollRuntimeTaskActivity } from "../../core/task-poller.js";
import type { MachineResources } from "../../metrics/resources.js";
import type { IngestionSourceRecord, TeamRunRecord } from "../../research/contracts.js";
import type { TaskInfo } from "../types.js";

interface RuntimePollingState {
  activeResearchRun: TeamRunRecord | null;
  latestIngestionSource: IngestionSourceRecord | null;
  openIncidentCount: number;
  reviewQueueCount: number;
  metricData: Map<string, number[]>;
  resourceData: Map<string, MachineResources>;
  tasks: TaskInfo[];
}

export function useRuntimePolling(runtime: AthenaRuntime): RuntimePollingState {
  const {
    connectionPool,
    executor,
    experimentTracker,
    metricCollector,
    metricStore,
    notifier,
    orchestrator,
    resourceCollector,
    teamStore,
  } = runtime;

  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [metricData, setMetricData] = useState<Map<string, number[]>>(new Map());
  const [resourceData, setResourceData] = useState<Map<string, MachineResources>>(new Map());
  const [activeResearchRun, setActiveResearchRun] = useState<TeamRunRecord | null>(null);
  const [latestIngestionSource, setLatestIngestionSource] = useState<IngestionSourceRecord | null>(null);
  const [openIncidentCount, setOpenIncidentCount] = useState(0);
  const [reviewQueueCount, setReviewQueueCount] = useState(0);

  useEffect(() => {
    const poll = async () => {
      if (executor && connectionPool) {
        const { statuses } = await pollRuntimeTaskActivity({
          executor,
          connectionPool,
          metricCollector,
          metricStore,
          experimentTracker,
          notifier,
        });
        const updated: TaskInfo[] = statuses.map(({ proc, running }) => {
          const shortCmd = proc.command.length > 40
            ? proc.command.slice(0, 40) + "..."
            : proc.command;
          return {
            id: `${proc.machineId}:${proc.pid}`,
            name: shortCmd,
            status: running ? "running" as const : "completed" as const,
            machineId: proc.machineId,
            pid: proc.pid,
            startedAt: proc.startedAt,
          };
        });
        setTasks(updated);
      }

      if (metricCollector && metricStore) {
        setMetricData(metricStore.getAllSeries(50));
      }

      if (resourceCollector) {
        const resources = await resourceCollector.collectAll().catch(() => new Map());
        setResourceData(resources as Map<string, MachineResources>);
      }

      const sessionId = orchestrator.currentSession?.id;
      if (sessionId) {
        setActiveResearchRun(teamStore.listRecentTeamRuns(sessionId, 1)[0] ?? null);
        setLatestIngestionSource(teamStore.listIngestionSources(sessionId)[0] ?? null);
        setOpenIncidentCount(teamStore.listOpenIncidents(sessionId).length);
        setReviewQueueCount(teamStore.listReviewQueue(sessionId).length);
      } else {
        setActiveResearchRun(null);
        setLatestIngestionSource(null);
        setOpenIncidentCount(0);
        setReviewQueueCount(0);
      }
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const loop = async () => {
      await poll();
      if (!stopped) {
        timer = setTimeout(loop, 5000);
      }
    };

    loop();
    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    connectionPool,
    executor,
    experimentTracker,
    metricCollector,
    metricStore,
    notifier,
    orchestrator,
    resourceCollector,
    teamStore,
  ]);

  return {
    activeResearchRun,
    latestIngestionSource,
    openIncidentCount,
    reviewQueueCount,
    metricData,
    resourceData,
    tasks,
  };
}
