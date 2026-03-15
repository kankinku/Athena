/**
 * verification-pipeline.ts
 *
 * change proposal 실행 후 검증 파이프라인.
 * 4단계: module unit → contract → integration → e2e.
 * 실패 시 재협의 자동 트리거.
 */

import { execSync } from "child_process";
import { nanoid } from "nanoid";
import type {
  ExecutionPlanRecord,
  TestResult,
  VerificationOutcome,
  VerificationResult,
  AffectedModuleRecord,
} from "./contracts.js";
import type { ModuleDefinition, ModuleGraph } from "../impact/graph-builder.js";
import { getModuleGraph } from "../impact/graph-builder.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerificationStageType = "module-unit" | "contract" | "integration" | "e2e";

export interface VerificationStage {
  stageId: string;
  stageType: VerificationStageType;
  stageName: string;
  testCommands: string[];
  ownerModule: string;
  failureAction: "block" | "warn" | "remeeting";
  timeoutMs: number;
}

export interface VerificationPipelineConfig {
  stages: VerificationStage[];
  failurePolicy: "stop-on-first" | "run-all-report";
  totalTimeoutMs: number;
}

export interface StageResult {
  stage: VerificationStage;
  testResults: TestResult[];
  passed: boolean;
  durationMs: number;
}

// ─── VerificationPipeline ─────────────────────────────────────────────────────

export class VerificationPipeline {
  private graph: ModuleGraph;

  constructor(graph?: ModuleGraph) {
    this.graph = graph ?? getModuleGraph();
  }

  /**
   * 실행 계획과 영향 모듈 목록으로부터 검증 파이프라인을 구성한다.
   */
  buildPipeline(
    plan: ExecutionPlanRecord,
    affectedModules: AffectedModuleRecord[],
  ): VerificationPipelineConfig {
    const stages: VerificationStage[] = [];

    // Stage 1: 모듈 단위 테스트 (직접 영향 모듈만)
    const directModules = affectedModules.filter((m) => m.impactLevel === "direct");
    for (const affected of directModules) {
      const mod = this.graph.modules.get(affected.moduleId);
      if (!mod || mod.affectedTests.length === 0) continue;

      stages.push({
        stageId: `unit_${affected.moduleId}`,
        stageType: "module-unit",
        stageName: `${affected.moduleId} 단위 테스트`,
        testCommands: mod.affectedTests.map((t) => `node --import tsx --test ${t}`),
        ownerModule: affected.moduleId,
        failureAction: "block",
        timeoutMs: 120_000, // 2분
      });
    }

    // Stage 2: 계약 테스트 (TypeScript 타입 체크)
    stages.push({
      stageId: "contract_typecheck",
      stageType: "contract",
      stageName: "TypeScript 타입 호환성",
      testCommands: ["npx tsc --noEmit --skipLibCheck"],
      ownerModule: "global",
      failureAction: "remeeting",
      timeoutMs: 60_000, // 1분
    });

    // Stage 3: 통합 테스트 (간접 영향 모듈 포함)
    const indirectModules = affectedModules.filter((m) => m.impactLevel === "indirect");
    const integrationTests = new Set<string>();

    for (const affected of [...directModules, ...indirectModules]) {
      const mod = this.graph.modules.get(affected.moduleId);
      if (!mod) continue;
      for (const test of mod.affectedTests) {
        if (test.includes("e2e/") || test.includes("integration")) {
          integrationTests.add(test);
        }
      }
    }

    if (integrationTests.size > 0) {
      stages.push({
        stageId: "integration",
        stageType: "integration",
        stageName: "통합 테스트",
        testCommands: Array.from(integrationTests).map((t) => `node --import tsx --test ${t}`),
        ownerModule: "global",
        failureAction: "remeeting",
        timeoutMs: 300_000, // 5분
      });
    }

    // Stage 4: E2E 테스트 (명시된 경우)
    const e2eTests = plan.requiredTests.filter((t) => t.includes("e2e/"));
    if (e2eTests.length > 0) {
      stages.push({
        stageId: "e2e",
        stageType: "e2e",
        stageName: "E2E 테스트",
        testCommands: e2eTests.map((t) => `node --import tsx --test ${t}`),
        ownerModule: "global",
        failureAction: "remeeting",
        timeoutMs: 600_000, // 10분
      });
    }

    return {
      stages,
      failurePolicy: "stop-on-first",
      totalTimeoutMs: 900_000, // 15분
    };
  }

  /**
   * 검증 파이프라인을 실행하고 결과를 반환한다.
   */
  execute(
    proposalId: string,
    executionPlanId: string,
    config: VerificationPipelineConfig,
  ): VerificationResult {
    const allResults: TestResult[] = [];
    const stageResults: StageResult[] = [];
    let overallPassed = true;
    let remeetingRequired = false;
    let remeetingReason: string | undefined;

    const pipelineStart = Date.now();

    for (const stage of config.stages) {
      // 전체 타임아웃 확인
      if (Date.now() - pipelineStart > config.totalTimeoutMs) {
        overallPassed = false;
        remeetingRequired = true;
        remeetingReason = "검증 파이프라인 전체 타임아웃";
        break;
      }

      const stageResult = this.executeStage(stage);
      stageResults.push(stageResult);
      allResults.push(...stageResult.testResults);

      if (!stageResult.passed) {
        overallPassed = false;

        if (stage.failureAction === "block" && config.failurePolicy === "stop-on-first") {
          // 블록 + stop-on-first: 즉시 중단
          break;
        }

        if (stage.failureAction === "remeeting") {
          remeetingRequired = true;
          const failedTests = stageResult.testResults
            .filter((t) => t.outcome === "failed" || t.outcome === "error")
            .map((t) => t.testId);
          remeetingReason = `${stage.stageName} 실패: ${failedTests.join(", ")}`;

          if (config.failurePolicy === "stop-on-first") break;
        }
      }
    }

    // 단위 테스트만 실패한 경우 재협의 불필요 (해당 모듈 오너만 수정)
    if (!overallPassed && !remeetingRequired) {
      const failedStages = stageResults.filter((s) => !s.passed);
      const onlyUnitFailed = failedStages.every((s) => s.stage.stageType === "module-unit");
      if (onlyUnitFailed) {
        remeetingRequired = false;
        remeetingReason = undefined;
      }
    }

    const outcome: VerificationOutcome = overallPassed
      ? "passed"
      : remeetingRequired
        ? "failed"
        : "partial";

    return {
      verificationId: `ver_${nanoid(10)}`,
      proposalId,
      executionPlanId,
      testResults: allResults,
      overallOutcome: outcome,
      remeetingRequired,
      remeetingReason,
      verifiedAt: Date.now(),
      createdAt: Date.now(),
    };
  }

  /**
   * 단일 검증 스테이지를 실행한다.
   */
  private executeStage(stage: VerificationStage): StageResult {
    const results: TestResult[] = [];
    const stageStart = Date.now();

    for (const cmd of stage.testCommands) {
      const testId = `${stage.stageId}:${cmd.split("/").pop() ?? cmd}`;
      const testStart = Date.now();

      try {
        execSync(cmd, {
          timeout: stage.timeoutMs,
          stdio: "pipe",
          cwd: process.cwd(),
          encoding: "utf-8",
        });

        results.push({
          testId,
          testCommand: cmd,
          outcome: "passed",
          ownerModule: stage.ownerModule,
          durationMs: Date.now() - testStart,
        });
      } catch (error: unknown) {
        const err = error as { status?: number; stderr?: string; message?: string };
        const isTimeout = err.message?.includes("TIMEOUT") || err.message?.includes("timed out");

        results.push({
          testId,
          testCommand: cmd,
          outcome: isTimeout ? "error" : "failed",
          failureMessage: err.stderr?.slice(0, 1000) ?? err.message?.slice(0, 1000) ?? "Unknown error",
          ownerModule: stage.ownerModule,
          durationMs: Date.now() - testStart,
        });
      }
    }

    const allPassed = results.every((r) => r.outcome === "passed");

    return {
      stage,
      testResults: results,
      passed: allPassed,
      durationMs: Date.now() - stageStart,
    };
  }
}

// ─── Convenience ──────────────────────────────────────────────────────────────

/**
 * 빠른 검증: tsc + 영향 모듈 단위 테스트만 실행.
 */
export function quickVerify(
  proposalId: string,
  executionPlanId: string,
  affectedModules: AffectedModuleRecord[],
): VerificationResult {
  const pipeline = new VerificationPipeline();
  const plan: ExecutionPlanRecord = {
    executionPlanId,
    proposalId,
    meetingId: "",
    taskAssignments: [],
    requiredTests: [],
    rollbackPlan: "",
    featureFlags: [],
    mergeGates: {},
    status: "in-progress",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const config = pipeline.buildPipeline(plan, affectedModules);
  // 빠른 검증: e2e 제외
  config.stages = config.stages.filter((s) => s.stageType !== "e2e");
  config.totalTimeoutMs = 300_000; // 5분

  return pipeline.execute(proposalId, executionPlanId, config);
}
