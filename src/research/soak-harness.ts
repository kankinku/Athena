import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ATHENA_DIR } from "../paths.js";

export type SoakScenarioLabel = "local_only" | "single_remote" | "multi_host";
export type SoakScenarioStatus = "pass" | "fail" | "blocked";

export interface SoakScenario {
  id: string;
  label: SoakScenarioLabel;
  inducedFailures: string[];
  completed: number;
  recovered: number;
  rolledBack: number;
  unrecoverable: number;
  requiredRemoteMachines?: number;
  blockedReason?: string;
  notes?: string[];
}

export interface SoakChecklistResult {
  scenarioId: string;
  status: SoakScenarioStatus;
  pass: boolean;
  completionRate: number;
  recoveryRate: number;
  rollbackRate: number;
  notes: string[];
}

export interface SoakArtifact {
  generatedAt: number;
  machineIds: string[];
  remoteMachineIds: string[];
  results: SoakChecklistResult[];
}

const SOAK_ARTIFACT_PATH = join(ATHENA_DIR, "supervised-production-soak.json");

export function evaluateSoakScenario(scenario: SoakScenario): SoakChecklistResult {
  if (scenario.blockedReason) {
    return {
      scenarioId: scenario.id,
      status: "blocked",
      pass: false,
      completionRate: 0,
      recoveryRate: 0,
      rollbackRate: 0,
      notes: [...(scenario.notes ?? []), scenario.blockedReason],
    };
  }

  const totalAttempts = Math.max(1, scenario.completed + scenario.unrecoverable);
  const inducedFailureCount = scenario.inducedFailures.length;
  const completionRate = Number((scenario.completed / totalAttempts).toFixed(2));
  const recoveryRate = Number(((inducedFailureCount === 0 ? 1 : scenario.recovered / inducedFailureCount)).toFixed(2));
  const rollbackRate = Number(((inducedFailureCount === 0 ? 1 : scenario.rolledBack / inducedFailureCount)).toFixed(2));
  const notes = [
    ...(scenario.notes ?? []),
    ...(scenario.unrecoverable > 0 ? [`unrecoverable=${scenario.unrecoverable}`] : []),
    ...(scenario.recovered < inducedFailureCount ? ["recovery_gap"] : []),
    ...(scenario.rolledBack === 0 && inducedFailureCount > 0 ? ["rollback_not_exercised"] : []),
  ];
  const pass = scenario.unrecoverable === 0 && completionRate >= 0.9 && recoveryRate >= 0.8;

  return {
    scenarioId: scenario.id,
    status: pass ? "pass" : "fail",
    pass,
    completionRate,
    recoveryRate,
    rollbackRate,
    notes,
  };
}

export function buildSupervisedProductionChecklist(results: SoakChecklistResult[]): string {
  const overall = results.every((result) => result.status === "pass")
    ? "green"
    : results.some((result) => result.status === "fail")
      ? "red"
      : "blocked";
  const lines = [
    "# Athena Supervised Production Checklist",
    "",
    `overall=${overall}`,
    ...results.map((result) =>
      `- ${result.scenarioId}: status=${result.status} pass=${result.pass} completion=${result.completionRate} recovery=${result.recoveryRate} rollback=${result.rollbackRate} notes=${result.notes.join("|") || "n/a"}`,
    ),
  ];
  return lines.join("\n");
}

export function buildEnvironmentAwareScenarios(
  remoteMachineIds: string[],
  options: { localSmokePassed?: boolean } = {},
): SoakScenario[] {
  const remoteCount = remoteMachineIds.length;
  return [
    options.localSmokePassed
      ? {
          id: "local_only",
          label: "local_only",
          inducedFailures: [],
          completed: 1,
          recovered: 0,
          rolledBack: 0,
          unrecoverable: 0,
          notes: ["local_smoke_only"],
        }
      : {
          id: "local_only",
          label: "local_only",
          inducedFailures: [],
          completed: 0,
          recovered: 0,
          rolledBack: 0,
          unrecoverable: 0,
          blockedReason: "local_soak_not_recorded",
        },
    {
      id: "single_remote",
      label: "single_remote",
      inducedFailures: ["disconnect", "remote_restart"],
      completed: 0,
      recovered: 0,
      rolledBack: 0,
      unrecoverable: 0,
      requiredRemoteMachines: 1,
      blockedReason: remoteCount < 1
        ? `requires_remote_machines=1 configured=${remoteCount}`
        : "single_remote_soak_not_recorded",
    },
    {
      id: "multi_host",
      label: "multi_host",
      inducedFailures: ["network_split", "host_loss", "partial_result"],
      completed: 0,
      recovered: 0,
      rolledBack: 0,
      unrecoverable: 0,
      requiredRemoteMachines: 2,
      blockedReason: remoteCount < 2
        ? `requires_remote_machines=2 configured=${remoteCount}`
        : "multi_host_soak_not_recorded",
    },
  ];
}

export function createSoakArtifact(
  machineIds: string[],
  scenarios: SoakScenario[],
): SoakArtifact {
  const remoteMachineIds = machineIds.filter((machineId) => machineId !== "local");
  return {
    generatedAt: Date.now(),
    machineIds,
    remoteMachineIds,
    results: scenarios.map((scenario) => evaluateSoakScenario(scenario)),
  };
}

export function getSoakArtifactPath(): string {
  return SOAK_ARTIFACT_PATH;
}

export function saveSoakArtifact(artifact: SoakArtifact, targetPath = SOAK_ARTIFACT_PATH): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
}

export function loadSoakArtifact(targetPath = SOAK_ARTIFACT_PATH): SoakArtifact | null {
  if (!existsSync(targetPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(targetPath, "utf8")) as SoakArtifact;
  } catch {
    return null;
  }
}
