/**
 * execution-gate.ts
 *
 * 회의 합의 결과 → 실행 계획 변환, 자동 실행 가능 여부 판단,
 * 실행 전 검증 단계(scope, tests, conflicts, rollback), 경로 범위 검사.
 */

import { nanoid } from "nanoid";
import type {
  AutomationPolicy,
  ChangeWorkflowState,
  ConsensusType,
  ExecutionPlanRecord,
  MeetingSessionRecord,
  TaskAssignment,
} from "./contracts.js";
import type { ModuleGraph, ModuleDefinition } from "../impact/graph-builder.js";
import { getModuleGraph } from "../impact/graph-builder.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GateCheckResult {
  passed: boolean;
  checks: GateCheck[];
  blockers: string[];
  warnings: string[];
}

export interface GateCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface AutoExecuteResult {
  canAutoExecute: boolean;
  reason: string;
  requiredApprovals: string[];
}

export interface PathScopeResult {
  allowed: boolean;
  violations: PathViolation[];
}

export interface PathViolation {
  agentId: string;
  moduleId: string;
  attemptedPath: string;
  allowedPatterns: string[];
}

// ─── ExecutionGate ────────────────────────────────────────────────────────────

export class ExecutionGate {
  private graph: ModuleGraph;

  constructor(graph?: ModuleGraph) {
    this.graph = graph ?? getModuleGraph();
  }

  /**
   * 회의 합의 결과를 실행 계획으로 변환한다.
   */
  createExecutionPlan(
    meeting: MeetingSessionRecord,
    proposalChangedPaths: string[],
    rollbackPlan: string,
  ): ExecutionPlanRecord {
    const planId = `plan_${nanoid(10)}`;
    const now = Date.now();

    // 직접 영향 모듈별로 작업 분배
    const assignments = this.buildTaskAssignments(meeting, proposalChangedPaths);

    // 영향받는 모듈의 테스트 수집
    const requiredTests = this.collectRequiredTests(meeting);

    return {
      executionPlanId: planId,
      proposalId: meeting.proposalId,
      meetingId: meeting.meetingId,
      taskAssignments: assignments,
      requiredTests,
      rollbackPlan,
      featureFlags: [],
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 실행 전 게이트 검사를 수행한다.
   * scope, tests, conflicts, rollback 4단계 검증.
   */
  runGateChecks(
    plan: ExecutionPlanRecord,
    currentWorkflowState: ChangeWorkflowState,
  ): GateCheckResult {
    const checks: GateCheck[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    // Check 1: 워크플로 상태 확인
    const stateOk = currentWorkflowState === "agreed";
    checks.push({
      name: "workflow-state",
      passed: stateOk,
      message: stateOk
        ? "워크플로 상태 OK: agreed"
        : `워크플로 상태 불일치: ${currentWorkflowState} (expected: agreed)`,
    });
    if (!stateOk) blockers.push(`워크플로 상태가 'agreed'가 아님: ${currentWorkflowState}`);

    // Check 2: 경로 범위 확인
    const scopeResult = this.verifyPathScope(plan.taskAssignments);
    checks.push({
      name: "path-scope",
      passed: scopeResult.allowed,
      message: scopeResult.allowed
        ? "모든 에이전트 경로 범위 확인됨"
        : `경로 위반 ${scopeResult.violations.length}건`,
    });
    if (!scopeResult.allowed) {
      for (const v of scopeResult.violations) {
        blockers.push(`${v.agentId}: 범위 외 파일 ${v.attemptedPath}`);
      }
    }

    // Check 3: 테스트 계획 확인
    const hasTests = plan.requiredTests.length > 0;
    checks.push({
      name: "test-plan",
      passed: hasTests,
      message: hasTests
        ? `필수 테스트 ${plan.requiredTests.length}개 확인`
        : "필수 테스트가 지정되지 않음",
    });
    if (!hasTests) warnings.push("필수 테스트가 없음 — 검증 단계에서 기본 테스트만 실행됩니다");

    // Check 4: 롤백 계획 확인
    const hasRollback = plan.rollbackPlan.length > 0;
    checks.push({
      name: "rollback-plan",
      passed: hasRollback,
      message: hasRollback
        ? "롤백 계획 존재"
        : "롤백 계획 없음",
    });
    if (!hasRollback) blockers.push("롤백 계획이 없음");

    // Check 5: 작업 배정 확인
    const hasAssignments = plan.taskAssignments.length > 0;
    checks.push({
      name: "task-assignments",
      passed: hasAssignments,
      message: hasAssignments
        ? `에이전트 ${plan.taskAssignments.length}개에 작업 배정됨`
        : "작업 배정 없음",
    });
    if (!hasAssignments) blockers.push("작업 배정이 없음");

    return {
      passed: blockers.length === 0,
      checks,
      blockers,
      warnings,
    };
  }

  /**
   * 자동 실행 가능 여부를 판단한다.
   * docs/execution-gate.md 9.2절 조건.
   */
  checkAutoExecute(
    plan: ExecutionPlanRecord,
    consensusType: ConsensusType,
    policy: AutomationPolicy,
    affectedModuleIds: string[],
  ): AutoExecuteResult {
    const requiredApprovals: string[] = [];

    // 자동화 정책 수준 확인
    if (policy.mode === "manual" || policy.mode === "assisted") {
      return {
        canAutoExecute: false,
        reason: `자동화 정책 '${policy.mode}'에서는 자동 실행 불가`,
        requiredApprovals: ["operator"],
      };
    }

    // 합의 유형 확인
    if (consensusType !== "approved") {
      return {
        canAutoExecute: false,
        reason: `합의 유형 '${consensusType}'에서는 자동 실행 불가 (approved만 가능)`,
        requiredApprovals: ["operator"],
      };
    }

    // 위험도 확인
    for (const modId of affectedModuleIds) {
      const mod = this.graph.modules.get(modId);
      if (!mod) continue;

      if (mod.riskLevel === "critical") {
        requiredApprovals.push("operator", mod.ownerAgent);
        return {
          canAutoExecute: false,
          reason: `critical 위험도 모듈 '${modId}' 포함`,
          requiredApprovals: [...new Set(requiredApprovals)],
        };
      }

      if (mod.riskLevel === "high") {
        requiredApprovals.push(mod.ownerAgent);
      }
    }

    if (requiredApprovals.length > 0) {
      return {
        canAutoExecute: false,
        reason: `high 위험도 모듈 포함`,
        requiredApprovals: [...new Set(requiredApprovals)],
      };
    }

    // 롤백 계획 확인
    if (!plan.rollbackPlan || plan.rollbackPlan.length === 0) {
      return {
        canAutoExecute: false,
        reason: "롤백 계획 없음",
        requiredApprovals: ["operator"],
      };
    }

    return {
      canAutoExecute: true,
      reason: "모든 자동 실행 조건 충족",
      requiredApprovals: [],
    };
  }

  /**
   * 에이전트별 작업의 경로 범위를 검증한다.
   * 각 에이전트가 자신의 모듈 paths 범위 내에서만 작업하는지 확인.
   */
  verifyPathScope(assignments: TaskAssignment[]): PathScopeResult {
    const violations: PathViolation[] = [];

    for (const assignment of assignments) {
      const mod = this.graph.modules.get(assignment.moduleId);
      if (!mod) {
        violations.push({
          agentId: assignment.agentId,
          moduleId: assignment.moduleId,
          attemptedPath: "(unknown module)",
          allowedPatterns: [],
        });
        continue;
      }

      // tasks 문자열에서 파일 경로 패턴 추출 (간단한 휴리스틱)
      for (const task of assignment.tasks) {
        const pathMatches = task.match(/(?:src\/|config\/|docs\/)[^\s,)]+/g);
        if (!pathMatches) continue;

        for (const attemptedPath of pathMatches) {
          const inScope = mod.paths.some((pattern) =>
            this.isPathInScope(attemptedPath, pattern),
          );
          if (!inScope) {
            violations.push({
              agentId: assignment.agentId,
              moduleId: assignment.moduleId,
              attemptedPath,
              allowedPatterns: mod.paths,
            });
          }
        }
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private buildTaskAssignments(
    meeting: MeetingSessionRecord,
    changedPaths: string[],
  ): TaskAssignment[] {
    const assignments: TaskAssignment[] = [];
    const assignedModules = new Set<string>();

    // mandatory 에이전트에게 직접 영향 모듈 작업 배정
    for (const agentId of meeting.mandatoryAgents) {
      const moduleId = this.findModuleByAgent(agentId);
      if (!moduleId || assignedModules.has(moduleId)) continue;
      assignedModules.add(moduleId);

      const mod = this.graph.modules.get(moduleId);
      if (!mod) continue;

      // 이 모듈에 속하는 변경 파일 식별
      const modulePaths = changedPaths.filter((p) =>
        mod.paths.some((pattern) => this.isPathInScope(p, pattern)),
      );

      assignments.push({
        agentId,
        moduleId,
        tasks: modulePaths.length > 0
          ? modulePaths.map((p) => `변경 적용: ${p}`)
          : [`${moduleId} 모듈 영향 대응`],
        dependsOnAgents: [],
        estimatedMinutes: 15,
      });
    }

    // 의존 관계 설정
    for (const assignment of assignments) {
      const mod = this.graph.modules.get(assignment.moduleId);
      if (!mod) continue;

      assignment.dependsOnAgents = mod.dependsOn
        .filter((dep) => assignedModules.has(dep))
        .map((dep) => {
          const depMod = this.graph.modules.get(dep);
          return depMod?.ownerAgent ?? dep;
        });
    }

    return assignments;
  }

  private collectRequiredTests(meeting: MeetingSessionRecord): string[] {
    const tests = new Set<string>();
    const allAgents = [
      ...meeting.mandatoryAgents,
      ...meeting.conditionalAgents,
    ];

    for (const agentId of allAgents) {
      const moduleId = this.findModuleByAgent(agentId);
      if (!moduleId) continue;

      const mod = this.graph.modules.get(moduleId);
      if (!mod) continue;

      for (const test of mod.affectedTests) {
        tests.add(test);
      }
    }

    return Array.from(tests);
  }

  private findModuleByAgent(agentId: string): string | undefined {
    for (const [modId, mod] of this.graph.modules) {
      if (mod.ownerAgent === agentId) return modId;
    }
    return undefined;
  }

  private isPathInScope(filePath: string, pattern: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // 정확한 매칭
    if (normalizedPath === normalizedPattern) return true;

    // ** 패턴
    if (normalizedPattern.endsWith("/**")) {
      const prefix = normalizedPattern.slice(0, -3);
      if (normalizedPath.startsWith(prefix + "/") || normalizedPath === prefix) return true;
    }

    // 접두사 매칭
    if (!normalizedPattern.includes("*") && normalizedPath.startsWith(normalizedPattern + "/")) return true;

    return false;
  }
}
