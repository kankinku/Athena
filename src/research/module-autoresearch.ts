/**
 * module-autoresearch.ts
 *
 * 모듈 오너 에이전트가 자신의 범위 내에서 자율적으로 개선을 수행하는
 * bounded autoresearch 루프 런타임.
 *
 * 각 루프 반복:
 * 1. 변경 생성 (에이전트가 수정 제안)
 * 2. 범위 검사 (module paths 내인지)
 * 3. 테스트 실행 (affected_tests)
 * 4. 결과 비교 (개선/유지/악화)
 * 5. 채택/폐기
 */

import { execSync } from "child_process";
import type { ModuleDefinition } from "../impact/graph-builder.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutoresearchBudget {
  maxWallClockMinutes: number;
  maxIterations: number;
  maxFilesChanged: number;
  maxCostUsd: number;
}

export interface AutoresearchResult {
  moduleId: string;
  agentId: string;
  iterations: number;
  changesAdopted: number;
  changesDiscarded: number;
  testPassRate: number;
  budgetExhausted: boolean;
  interfaceChangeDetected: boolean;
  errors: string[];
  durationMs: number;
}

export interface IterationResult {
  iteration: number;
  changedFiles: string[];
  testsPassed: boolean;
  adopted: boolean;
  reason: string;
}

export type AutoresearchStopReason =
  | "budget-exhausted"
  | "goal-achieved"
  | "interface-change-needed"
  | "max-failures"
  | "operator-stop";

// ─── Budget Defaults ──────────────────────────────────────────────────────────

const DEFAULT_BUDGETS: Record<string, AutoresearchBudget> = {
  store:     { maxWallClockMinutes: 30, maxIterations: 5, maxFilesChanged: 3, maxCostUsd: 0.50 },
  research:  { maxWallClockMinutes: 60, maxIterations: 10, maxFilesChanged: 5, maxCostUsd: 1.00 },
  cli:       { maxWallClockMinutes: 30, maxIterations: 5, maxFilesChanged: 3, maxCostUsd: 0.50 },
  ui:        { maxWallClockMinutes: 20, maxIterations: 5, maxFilesChanged: 3, maxCostUsd: 0.30 },
  remote:    { maxWallClockMinutes: 45, maxIterations: 5, maxFilesChanged: 3, maxCostUsd: 0.50 },
  security:  { maxWallClockMinutes: 15, maxIterations: 3, maxFilesChanged: 2, maxCostUsd: 0.30 },
  impact:    { maxWallClockMinutes: 20, maxIterations: 5, maxFilesChanged: 3, maxCostUsd: 0.30 },
  tools:     { maxWallClockMinutes: 30, maxIterations: 5, maxFilesChanged: 3, maxCostUsd: 0.50 },
  providers: { maxWallClockMinutes: 30, maxIterations: 5, maxFilesChanged: 3, maxCostUsd: 0.50 },
};

// ─── ModuleAutoresearchRunner ─────────────────────────────────────────────────

export class ModuleAutoresearchRunner {
  /**
   * 주어진 모듈의 autoresearch 루프에 사용할 예산을 반환한다.
   */
  getBudget(moduleId: string, override?: Partial<AutoresearchBudget>): AutoresearchBudget {
    const base = DEFAULT_BUDGETS[moduleId] ?? DEFAULT_BUDGETS.research;
    return {
      maxWallClockMinutes: override?.maxWallClockMinutes ?? base.maxWallClockMinutes,
      maxIterations: override?.maxIterations ?? base.maxIterations,
      maxFilesChanged: override?.maxFilesChanged ?? base.maxFilesChanged,
      maxCostUsd: override?.maxCostUsd ?? base.maxCostUsd,
    };
  }

  /**
   * 변경된 파일이 모듈 범위 내에 있는지 검사한다.
   */
  verifyScope(mod: ModuleDefinition, changedFiles: string[]): { allowed: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const file of changedFiles) {
      const normalized = file.replace(/\\/g, "/");
      const inScope = mod.paths.some((pattern) => {
        const normalizedPattern = pattern.replace(/\\/g, "/");
        if (normalizedPattern.endsWith("/**")) {
          const prefix = normalizedPattern.slice(0, -3);
          return normalized.startsWith(prefix + "/") || normalized === prefix;
        }
        return normalized === normalizedPattern || normalized.startsWith(normalizedPattern + "/");
      });

      if (!inScope) violations.push(file);
    }

    return { allowed: violations.length === 0, violations };
  }

  /**
   * 모듈의 affected_tests를 실행하고 결과를 반환한다.
   */
  runModuleTests(mod: ModuleDefinition, timeoutMs: number = 120_000): {
    passed: boolean;
    results: Array<{ test: string; passed: boolean; error?: string }>;
    durationMs: number;
  } {
    const results: Array<{ test: string; passed: boolean; error?: string }> = [];
    const start = Date.now();

    for (const testFile of mod.affectedTests) {
      const cmd = `node --import tsx --test ${testFile}`;
      try {
        execSync(cmd, {
          timeout: timeoutMs,
          stdio: "pipe",
          cwd: process.cwd(),
          encoding: "utf-8",
        });
        results.push({ test: testFile, passed: true });
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        results.push({
          test: testFile,
          passed: false,
          error: e.stderr?.slice(0, 500) ?? e.message?.slice(0, 500) ?? "Unknown error",
        });
      }
    }

    return {
      passed: results.every((r) => r.passed),
      results,
      durationMs: Date.now() - start,
    };
  }

  /**
   * 변경된 파일이 공용 인터페이스 파일인지 감지한다.
   * 감지 시 autoresearch 루프를 중단하고 change proposal 생성을 권고한다.
   */
  detectInterfaceChange(changedFiles: string[]): boolean {
    const interfacePatterns = [
      "contracts.ts", "contracts.js",
      "index.ts", "index.js",
      "types.ts", "public.ts",
    ];
    return changedFiles.some((f) => {
      const basename = f.split(/[/\\]/).pop() ?? "";
      return interfacePatterns.includes(basename);
    });
  }

  /**
   * 예산이 소진되었는지 확인한다.
   */
  isBudgetExhausted(
    budget: AutoresearchBudget,
    elapsed: { iterations: number; wallClockMs: number; filesChanged: number },
  ): boolean {
    if (elapsed.iterations >= budget.maxIterations) return true;
    if (elapsed.wallClockMs >= budget.maxWallClockMinutes * 60_000) return true;
    if (elapsed.filesChanged >= budget.maxFilesChanged) return true;
    return false;
  }
}
