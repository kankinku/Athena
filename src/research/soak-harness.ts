import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ATHENA_DIR } from "../paths.js";

export type SoakScenarioLabel = "local_only" | "single_remote" | "multi_host";
export type SoakScenarioStatus = "pass" | "fail" | "blocked" | "synthetic";

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
  /** true = 결과가 실제 실행이 아닌 합성 데이터 */
  synthetic?: boolean;
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
  /** true = artifact 전체가 합성 데이터 기반이며 릴리즈 게이트로 사용 불가 */
  synthetic: boolean;
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

  // 합성 시나리오는 절대 pass로 판정하지 않는다
  if (scenario.synthetic) {
    return {
      scenarioId: scenario.id,
      status: "synthetic",
      pass: false,
      completionRate: 0,
      recoveryRate: 0,
      rollbackRate: 0,
      notes: [...(scenario.notes ?? []), "synthetic_data_not_real_soak"],
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
  const hasSynthetic = results.some((result) => result.status === "synthetic");
  const hasRealPass = results.some((result) => result.status === "pass");
  const overall = hasSynthetic && !hasRealPass
    ? "synthetic_only"
    : results.every((result) => result.status === "pass")
      ? "green"
      : results.some((result) => result.status === "fail")
        ? "red"
        : "blocked";
  const lines = [
    "# Athena Supervised Production Checklist",
    "",
    `overall=${overall}`,
    ...(hasSynthetic ? ["WARNING: synthetic results present — not valid for release gate signoff"] : []),
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
          synthetic: true,
          notes: ["local_smoke_only", "synthetic_echo_test_not_real_soak"],
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
  const isSynthetic = scenarios.every((s) => s.synthetic || !!s.blockedReason);
  return {
    generatedAt: Date.now(),
    machineIds,
    remoteMachineIds,
    synthetic: isSynthetic,
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
