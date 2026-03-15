/**
 * path-enforcer.ts
 *
 * 실행 시점에 에이전트의 파일 수정을 모듈 범위 내로 강제한다.
 * ExecutionGate의 gate check와 달리, 이 모듈은 실제 write 시점에 개입한다.
 *
 * spec §10: path-scoped write permission, destructive tool approval,
 * protected path 차단, audit log 저장.
 */

import type { PathEnforcementResult } from "../research/contracts.js";
import type { ModuleGraph, ModuleDefinition } from "../impact/graph-builder.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PathEnforcerConfig {
  /** enforce 모드: 위반 시 차단. audit 모드: 위반 시 기록만. */
  mode: "enforce" | "audit";
  /** 모든 에이전트가 절대 접근 불가한 경로 패턴 */
  protectedPaths: string[];
  /** 이 경로들은 operator만 수정 가능 */
  operatorOnlyPaths: string[];
}

const DEFAULT_PROTECTED_PATHS = [
  ".env",
  ".env.*",
  "**/.ssh/**",
  "**/credentials*",
  "**/secrets*",
  "**/*.key",
  "**/*.pem",
];

const DEFAULT_OPERATOR_ONLY_PATHS = [
  "config/module-registry.yaml",
  ".github/CODEOWNERS",
  "package.json",
  "tsconfig.json",
  ".github/workflows/**",
];

// ─── PathEnforcer ─────────────────────────────────────────────────────────────

export class PathEnforcer {
  private config: PathEnforcerConfig;
  private graph: ModuleGraph;
  private auditLog: PathEnforcementResult[] = [];

  constructor(graph: ModuleGraph, config?: Partial<PathEnforcerConfig>) {
    this.graph = graph;
    this.config = {
      mode: config?.mode ?? "enforce",
      protectedPaths: config?.protectedPaths ?? DEFAULT_PROTECTED_PATHS,
      operatorOnlyPaths: config?.operatorOnlyPaths ?? DEFAULT_OPERATOR_ONLY_PATHS,
    };
  }

  /**
   * 에이전트가 특정 경로에 쓰기를 시도할 때 호출한다.
   * 위반 시 enforce 모드이면 차단, audit 모드이면 기록만.
   */
  checkWrite(
    agentId: string,
    moduleId: string,
    targetPaths: string[],
    isOperator: boolean = false,
  ): PathEnforcementResult {
    const violations: string[] = [];
    const normalizedTargets = targetPaths.map((p) => p.replace(/\\/g, "/"));

    // 1. 절대 보호 경로 확인
    for (const target of normalizedTargets) {
      if (this.matchesAnyPattern(target, this.config.protectedPaths)) {
        violations.push(`PROTECTED: ${target}`);
      }
    }

    // 2. operator 전용 경로 확인
    if (!isOperator) {
      for (const target of normalizedTargets) {
        if (this.matchesAnyPattern(target, this.config.operatorOnlyPaths)) {
          violations.push(`OPERATOR_ONLY: ${target}`);
        }
      }
    }

    // 3. 모듈 범위 확인
    if (!isOperator) {
      const mod = this.graph.modules.get(moduleId);
      if (mod) {
        for (const target of normalizedTargets) {
          const inScope = mod.paths.some((pattern) =>
            this.isPathInScope(target, pattern.replace(/\\/g, "/")),
          );
          if (!inScope) {
            violations.push(`OUT_OF_SCOPE: ${target} (module: ${moduleId})`);
          }
        }
      } else {
        // 알 수 없는 모듈
        for (const target of normalizedTargets) {
          violations.push(`UNKNOWN_MODULE: ${target} (module: ${moduleId})`);
        }
      }
    }

    const allowed = violations.length === 0;
    const action = allowed ? "allow" : (this.config.mode === "enforce" ? "block" : "audit");
    const mod = this.graph.modules.get(moduleId);

    const result: PathEnforcementResult = {
      allowed: this.config.mode === "audit" ? true : allowed, // audit 모드에서는 항상 허용
      agentId,
      moduleId,
      attemptedPaths: normalizedTargets,
      allowedPatterns: mod?.paths ?? [],
      violations,
      enforcedAt: Date.now(),
      action,
    };

    this.auditLog.push(result);
    return result;
  }

  /**
   * 감사 로그를 반환한다.
   */
  getAuditLog(): PathEnforcementResult[] {
    return [...this.auditLog];
  }

  /**
   * 위반 감사 로그만 반환한다.
   */
  getViolations(): PathEnforcementResult[] {
    return this.auditLog.filter((r) => r.violations.length > 0);
  }

  /**
   * 감사 로그를 초기화한다.
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private matchesAnyPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => this.isPathInScope(filePath, pattern));
  }

  private isPathInScope(filePath: string, pattern: string): boolean {
    // 정확한 매칭
    if (filePath === pattern) return true;

    // ** 패턴
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return filePath.startsWith(prefix + "/") || filePath === prefix;
    }

    // 글로벌 ** 접두사 패턴 (예: **/.ssh/**)
    if (pattern.startsWith("**/")) {
      const suffix = pattern.slice(3);
      if (suffix.endsWith("/**")) {
        const seg = suffix.slice(0, -3);
        return filePath.includes("/" + seg + "/") || filePath.includes(seg + "/") || filePath.endsWith("/" + seg);
      }
      // **/filename 패턴
      return filePath.endsWith("/" + suffix) || filePath === suffix || filePath.includes(suffix);
    }

    // *.ext 패턴
    if (pattern.startsWith("*.")) {
      return filePath.endsWith(pattern.slice(1));
    }
    if (pattern.startsWith("**/") && pattern.includes("*.")) {
      const ext = pattern.split("*.").pop();
      return ext ? filePath.endsWith("." + ext) : false;
    }

    // 접두사 매칭
    if (!pattern.includes("*")) {
      return filePath.startsWith(pattern + "/") || filePath === pattern;
    }

    return false;
  }
}
