/**
 * conflict-detector.ts
 *
 * @experimental
 * 이 모듈은 코어 루프와 직접 통합되지 않은 legacy change-management 서브시스템이다.
 * meeting-orchestrator와 change-pipeline에서만 참조된다.
 *
 * 5종 충돌을 자동으로 감지한다:
 *   1. 인터페이스 충돌 — 동일 InterfaceContract를 서로 다른 방식으로 변경
 *   2. 데이터 구조 충돌 — DB 스키마 변경이 다른 모듈의 쿼리에 영향
 *   3. 테스트 범위 충돌 — 동일 테스트가 여러 TaskAssignment에서 영향
 *   4. 배포 순서 충돌 — 모듈 의존성 방향과 변경 순서 불일치
 *   5. 보안/운영 정책 충돌 — 경로 보호 정책과 수정 계획의 충돌
 *
 * MeetingOrchestrator의 라운드-3 진입 시 또는 독립 호출로 사용한다.
 */

import { nanoid } from "nanoid";
import type {
  ConflictPoint,
  ConflictType,
  TaskAssignment,
  ExecutionPlanRecord,
  InterfaceContract,
} from "./contracts.js";
import type { ModuleDefinition } from "../impact/graph-builder.js";
import { getModuleGraph } from "../impact/graph-builder.js";
import { InterfaceContractStore } from "./interface-contract-store.js";

export interface ConflictDetectorDeps {
  interfaceContractStore?: InterfaceContractStore;
}

export class ConflictDetector {
  private contractStore: InterfaceContractStore;

  constructor(deps?: ConflictDetectorDeps) {
    this.contractStore = deps?.interfaceContractStore ?? new InterfaceContractStore();
  }

  /**
   * 주어진 실행 계획에서 모든 종류의 충돌을 감지한다.
   */
  detectAll(
    plan: ExecutionPlanRecord,
    changedPaths: string[],
  ): ConflictPoint[] {
    const conflicts: ConflictPoint[] = [];

    conflicts.push(...this.detectInterfaceConflicts(plan));
    conflicts.push(...this.detectDataStructureConflicts(changedPaths, plan));
    conflicts.push(...this.detectTestScopeConflicts(plan));
    conflicts.push(...this.detectDeployOrderConflicts(plan));
    conflicts.push(...this.detectPolicyConflicts(changedPaths, plan));

    return conflicts;
  }

  /**
   * 1. 인터페이스 충돌: 서로 다른 에이전트가 동일 인터페이스를 변경하려는 경우.
   */
  detectInterfaceConflicts(plan: ExecutionPlanRecord): ConflictPoint[] {
    const conflicts: ConflictPoint[] = [];

    // 각 에이전트의 모듈이 소유/의존하는 인터페이스를 수집
    const moduleContracts = new Map<string, InterfaceContract[]>();
    for (const task of plan.taskAssignments) {
      const owned = this.contractStore.listByModule(task.moduleId);
      const deps = this.contractStore.listDependenciesOf(task.moduleId);
      moduleContracts.set(task.moduleId, [...owned, ...deps]);
    }

    // 동일 contractId를 여러 모듈에서 접근하는 경우 충돌 후보
    const contractAccess = new Map<string, string[]>(); // contractId → moduleIds
    for (const [moduleId, contracts] of moduleContracts) {
      for (const c of contracts) {
        const accessors = contractAccess.get(c.contractId) ?? [];
        if (!accessors.includes(moduleId)) {
          accessors.push(moduleId);
        }
        contractAccess.set(c.contractId, accessors);
      }
    }

    for (const [contractId, modules] of contractAccess) {
      if (modules.length < 2) continue;

      // 두 개 이상의 모듈이 동일 인터페이스를 참조하면서 둘 다 수정 대상인 경우
      const modifyingModules = modules.filter((m) =>
        plan.taskAssignments.some((t) => t.moduleId === m && t.tasks.length > 0),
      );

      if (modifyingModules.length >= 2) {
        const contract = this.contractStore.get(contractId);
        const agents = modifyingModules
          .map((m) => plan.taskAssignments.find((t) => t.moduleId === m)?.agentId)
          .filter((a): a is string => !!a);

        conflicts.push({
          conflictId: `cf_${nanoid(6)}`,
          conflictType: "interface-conflict",
          description: `Interface "${contract?.interfaceName ?? contractId}" is being modified by multiple modules: ${modifyingModules.join(", ")}`,
          involvedAgents: agents,
          proposedResolutions: [
            "Coordinate interface changes through a single owner module",
            "Define version compatibility contract before modification",
          ],
        });
      }
    }

    return conflicts;
  }

  /**
   * 2. 데이터 구조 충돌: DB 스키마/마이그레이션 파일 변경이 다른 모듈에 영향.
   */
  detectDataStructureConflicts(
    changedPaths: string[],
    plan: ExecutionPlanRecord,
  ): ConflictPoint[] {
    const conflicts: ConflictPoint[] = [];

    const schemaFiles = changedPaths.filter(
      (p) =>
        p.includes("migration") ||
        p.includes("schema") ||
        p.endsWith(".sql") ||
        p.includes("store/database"),
    );

    if (schemaFiles.length === 0) return conflicts;

    // 스키마를 변경하는 모듈과 store에 의존하는 다른 모듈 식별
    const graph = getModuleGraph();
    const storeModule = graph?.modules.get("store");
    if (!storeModule) return conflicts;

    const dependentModules: string[] = [];
    for (const [id, mod] of graph!.modules) {
      if (mod.dependsOn.includes("store") && id !== "store") {
        dependentModules.push(id);
      }
    }

    const affectedTaskModules = plan.taskAssignments
      .filter((t) => dependentModules.includes(t.moduleId))
      .map((t) => t.agentId);

    if (affectedTaskModules.length > 0) {
      conflicts.push({
        conflictId: `cf_${nanoid(6)}`,
        conflictType: "interface-conflict",
        description: `DB schema changes in ${schemaFiles.join(", ")} may affect modules: ${dependentModules.join(", ")}`,
        involvedAgents: affectedTaskModules,
        proposedResolutions: [
          "Add backward-compatible migration with rollback plan",
          "Verify all dependent module queries against new schema",
          "Stage schema migration before module code changes",
        ],
      });
    }

    return conflicts;
  }

  /**
   * 3. 테스트 범위 충돌: 동일 테스트 파일이 여러 TaskAssignment에서 참조.
   */
  detectTestScopeConflicts(plan: ExecutionPlanRecord): ConflictPoint[] {
    const conflicts: ConflictPoint[] = [];

    // 필수 테스트를 모듈별로 연관 — 다수 assignment가 동일 테스트를 필요로 하면 충돌
    const testOwners = new Map<string, string[]>(); // test → agentIds
    const graph = getModuleGraph();

    for (const task of plan.taskAssignments) {
      const mod = graph?.modules.get(task.moduleId);
      const moduleTests = mod?.affectedTests ?? [];

      for (const test of moduleTests) {
        const owners = testOwners.get(test) ?? [];
        if (!owners.includes(task.agentId)) {
          owners.push(task.agentId);
        }
        testOwners.set(test, owners);
      }
    }

    for (const [test, agents] of testOwners) {
      if (agents.length >= 2) {
        conflicts.push({
          conflictId: `cf_${nanoid(6)}`,
          conflictType: "test-risk",
          description: `Test "${test}" is affected by multiple agents: ${agents.join(", ")}. Concurrent modifications may cause flaky results.`,
          involvedAgents: agents,
          proposedResolutions: [
            "Sequence test execution to avoid race conditions",
            "Run test after all related module changes are complete",
          ],
        });
      }
    }

    return conflicts;
  }

  /**
   * 4. 배포 순서 충돌: 모듈 의존성 방향과 task 할당 순서 불일치.
   */
  detectDeployOrderConflicts(plan: ExecutionPlanRecord): ConflictPoint[] {
    const conflicts: ConflictPoint[] = [];
    const graph = getModuleGraph();
    if (!graph) return conflicts;

    const taskModules = plan.taskAssignments.map((t) => t.moduleId);

    for (const task of plan.taskAssignments) {
      const mod = graph.modules.get(task.moduleId);
      if (!mod) continue;

      // 이 모듈이 의존하는 모듈도 변경 대상인데, 그 모듈에 대한 task가
      // 현재 모듈보다 뒤에 있으면 배포 순서 충돌
      for (const dep of mod.dependsOn) {
        if (!taskModules.includes(dep)) continue;

        const depTaskIdx = plan.taskAssignments.findIndex((t) => t.moduleId === dep);
        const currentIdx = plan.taskAssignments.findIndex((t) => t.moduleId === task.moduleId);

        if (depTaskIdx > currentIdx) {
          const depAgent = plan.taskAssignments[depTaskIdx]?.agentId;
          conflicts.push({
            conflictId: `cf_${nanoid(6)}`,
            conflictType: "schedule-conflict",
            description: `Module "${task.moduleId}" depends on "${dep}", but "${dep}" is scheduled after it in the execution plan`,
            involvedAgents: [task.agentId, ...(depAgent ? [depAgent] : [])],
            proposedResolutions: [
              `Reorder tasks: execute "${dep}" before "${task.moduleId}"`,
              `Add explicit dependsOnAgents for proper sequencing`,
            ],
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 5. 보안/운영 정책 충돌: 보호 경로에 대한 수정이 task에 포함된 경우.
   */
  detectPolicyConflicts(
    changedPaths: string[],
    plan: ExecutionPlanRecord,
  ): ConflictPoint[] {
    const conflicts: ConflictPoint[] = [];

    const sensitivePatterns = [
      /\.env/,
      /credentials/,
      /\.ssh/,
      /secret/i,
      /security\//,
      /auth/,
      /token/i,
      /password/i,
      /\.pem$/,
      /\.key$/,
    ];

    const sensitiveFiles = changedPaths.filter((p) =>
      sensitivePatterns.some((pat) => pat.test(p)),
    );

    if (sensitiveFiles.length > 0) {
      const allAgents = plan.taskAssignments.map((t) => t.agentId);
      conflicts.push({
        conflictId: `cf_${nanoid(6)}`,
        conflictType: "security-priority",
        description: `Sensitive files being modified: ${sensitiveFiles.join(", ")}. Security review required before execution.`,
        involvedAgents: allAgents,
        proposedResolutions: [
          "Require operator approval for sensitive file changes",
          "Run security audit before proceeding",
          "Isolate sensitive changes into a separate proposal",
        ],
      });
    }

    return conflicts;
  }
}
