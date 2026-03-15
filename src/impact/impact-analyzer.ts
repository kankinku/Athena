/**
 * impact-analyzer.ts
 *
 * 변경된 파일 경로 목록을 받아서 ModuleGraph를 기반으로
 * 영향받는 모듈을 직접/간접/참관 3단계로 분류한다.
 *
 * 핵심 알고리즘:
 * 1. 변경 파일 → 직접 수정된 모듈 식별 (glob 매칭)
 * 2. 직접 수정 모듈의 공용 인터페이스가 변경되는지 확인
 * 3. 역방향 그래프 BFS로 간접 영향 모듈 탐색
 * 4. 참관 모듈 식별 (더 거리가 먼 의존 관계)
 */

import type { ModuleDefinition, ModuleGraph } from "./graph-builder.js";
import { getModuleGraph } from "./graph-builder.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImpactLevel = "direct" | "indirect" | "observer";

export interface ModuleImpact {
  moduleId: string;
  ownerAgent: string;
  impactLevel: ImpactLevel;
  impactReason: string;
  affectedInterfaces: string[];
  riskLevel: ModuleDefinition["riskLevel"];
  mergeGate: string;
}

export type NonCodeDependencyType = "test" | "deploy" | "config" | "contract" | "schema";

export interface NonCodeImpact {
  type: NonCodeDependencyType;
  description: string;
  affectedModules: string[];
  severity: "info" | "warning" | "critical";
}

export interface ImpactAnalysisResult {
  changedPaths: string[];
  directlyAffected: ModuleImpact[];
  indirectlyAffected: ModuleImpact[];
  observers: ModuleImpact[];
  allAffected: ModuleImpact[];
  nonCodeImpacts: NonCodeImpact[];
  meetingRequired: boolean;
  meetingRequiredReason: string;
  confidence: number;           // 0.0 ~ 1.0 — 분석 신뢰도
  analyzedAt: number;
  summaryText: string;
}

// ─── ImpactAnalyzer ───────────────────────────────────────────────────────────

export class ImpactAnalyzer {
  private graph: ModuleGraph;

  constructor(graph?: ModuleGraph) {
    this.graph = graph ?? getModuleGraph();
  }

  /**
   * 변경된 파일 경로 목록에서 영향받는 모듈을 분석한다.
   *
   * @param changedPaths - 변경된 파일 경로 목록 (절대 경로 또는 프로젝트 루트 상대 경로)
   * @param interfaceChangedPaths - 공용 인터페이스 파일 경로 목록 (선택적)
   */
  analyze(
    changedPaths: string[],
    interfaceChangedPaths?: string[],
  ): ImpactAnalysisResult {
    const normalizedPaths = changedPaths.map(normalizePath);
    const normalizedInterfacePaths = (interfaceChangedPaths ?? []).map(normalizePath);

    // 1. 직접 수정된 모듈 식별
    const directModules = this.findDirectModules(normalizedPaths);

    // 2. 변경된 공용 인터페이스 파악
    const changedInterfaces = this.findChangedInterfaces(
      directModules,
      normalizedPaths,
      normalizedInterfacePaths,
    );

    // 3. 간접 영향 모듈 탐색 (역방향 BFS)
    const { indirect, observers } = this.findIndirectModules(
      directModules,
      changedInterfaces,
    );

    // 4. ModuleImpact 객체 구성
    const directImpacts = directModules.map((modId) =>
      this.buildImpact(modId, "direct", changedInterfaces.get(modId) ?? [], normalizedPaths),
    );

    const indirectImpacts = Array.from(indirect.entries()).map(([modId, reason]) =>
      this.buildImpact(modId, "indirect", [], normalizedPaths, reason),
    );

    const observerImpacts = Array.from(observers.entries()).map(([modId, reason]) =>
      this.buildImpact(modId, "observer", [], normalizedPaths, reason),
    );

    const allAffected = [...directImpacts, ...indirectImpacts, ...observerImpacts];

    // 5. 코드 외 의존성 영향 분석
    const nonCodeImpacts = this.analyzeNonCodeDependencies(normalizedPaths, directModules);

    // 6. 회의 필요 여부 판단
    const { required: meetingRequired, reason: meetingRequiredReason } =
      this.determineMeetingRequired(directImpacts, indirectImpacts, changedInterfaces);

    const result: ImpactAnalysisResult = {
      changedPaths,
      directlyAffected: directImpacts,
      indirectlyAffected: indirectImpacts,
      observers: observerImpacts,
      allAffected,
      nonCodeImpacts,
      meetingRequired,
      meetingRequiredReason,
      confidence: this.computeConfidence(normalizedPaths, directModules, changedInterfaces),
      analyzedAt: Date.now(),
      summaryText: this.buildSummaryText(directImpacts, indirectImpacts, observerImpacts),
    };

    return result;
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  /**
   * 변경된 파일 경로 목록에서 직접 수정된 모듈 ID 목록을 반환한다.
   */
  private findDirectModules(normalizedPaths: string[]): string[] {
    const directSet = new Set<string>();

    for (const filePath of normalizedPaths) {
      for (const { pattern, moduleId } of this.graph.pathPatterns) {
        const normalizedPattern = normalizePath(pattern);
        if (matchesPattern(filePath, normalizedPattern)) {
          directSet.add(moduleId);
          break; // 첫 매칭 모듈만 사용
        }
      }
    }

    return Array.from(directSet);
  }

  /**
   * 직접 수정된 모듈에서 변경된 공용 인터페이스를 파악한다.
   * 반환값: moduleId → 변경된 인터페이스 이름 목록
   */
  private findChangedInterfaces(
    directModules: string[],
    changedPaths: string[],
    explicitInterfacePaths: string[],
  ): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const modId of directModules) {
      const mod = this.graph.modules.get(modId);
      if (!mod) continue;

      const changedInterfaces: string[] = [];

      // 공용 인터페이스가 있는 파일이 변경되었는지 확인
      // (인터페이스가 정의된 파일을 명시적으로 추적하는 대신,
      //  공용 인터페이스 파일이 변경 목록에 포함되면 해당 모듈의 모든 인터페이스가 영향받는 것으로 간주)
      const isInterfaceChanged =
        explicitInterfacePaths.some((p) =>
          mod.paths.some((pattern) => matchesPattern(p, normalizePath(pattern))),
        ) ||
        changedPaths.some((p) =>
          isLikelyPublicInterface(p, modId),
        );

      if (isInterfaceChanged) {
        changedInterfaces.push(...mod.publicInterfaces);
      }

      if (changedInterfaces.length > 0) {
        result.set(modId, changedInterfaces);
      }
    }

    return result;
  }

  /**
   * 직접 영향 모듈에서 역방향 BFS로 간접 영향 모듈을 탐색한다.
   * depth 1: indirect, depth 2+: observer
   */
  private findIndirectModules(
    directModules: string[],
    changedInterfaces: Map<string, string[]>,
  ): { indirect: Map<string, string>; observers: Map<string, string> } {
    const indirect = new Map<string, string>();
    const observers = new Map<string, string>();
    const visited = new Set<string>(directModules);

    // 공용 인터페이스가 변경된 모듈만 역방향 탐색
    const interfaceChangedModules = directModules.filter((m) =>
      changedInterfaces.has(m) && (changedInterfaces.get(m)?.length ?? 0) > 0,
    );

    // BFS 큐: [moduleId, depth, reason]
    const queue: Array<[string, number, string]> = interfaceChangedModules.map((m) => [
      m,
      0,
      `'${m}' 모듈의 공용 인터페이스 변경`,
    ]);

    while (queue.length > 0) {
      const [currentId, depth, reason] = queue.shift()!;

      const dependents = this.graph.reverseEdges.get(currentId) ?? new Set();
      for (const dependentId of dependents) {
        if (visited.has(dependentId)) continue;
        visited.add(dependentId);

        if (depth === 0) {
          // 직접 의존하는 모듈 → indirect
          indirect.set(dependentId, reason);
          queue.push([dependentId, depth + 1, `'${dependentId}'이 '${currentId}'에 의존`]);
        } else {
          // 2단계 이상 → observer
          observers.set(dependentId, `'${dependentId}'이 간접적으로 영향받음 (경유: ${currentId})`);
          queue.push([dependentId, depth + 1, `경유: ${currentId}`]);
        }
      }
    }

    return { indirect, observers };
  }

  private buildImpact(
    modId: string,
    level: ImpactLevel,
    affectedInterfaces: string[],
    _changedPaths: string[],
    reason?: string,
  ): ModuleImpact {
    const mod = this.graph.modules.get(modId)!;
    const defaultReason = level === "direct"
      ? `${mod.displayName} 모듈의 파일이 직접 수정됨`
      : reason ?? `${mod.displayName} 모듈이 영향받음`;

    return {
      moduleId: modId,
      ownerAgent: mod.ownerAgent,
      impactLevel: level,
      impactReason: defaultReason,
      affectedInterfaces,
      riskLevel: mod.riskLevel,
      mergeGate: mod.mergeGate,
    };
  }

  private determineMeetingRequired(
    direct: ModuleImpact[],
    indirect: ModuleImpact[],
    changedInterfaces: Map<string, string[]>,
  ): { required: boolean; reason: string } {
    // 1. critical/high 위험도 모듈 포함 → 항상 회의 필요 (단일 모듈이라도)
    const criticalDirect = direct.filter((m) => m.riskLevel === "critical" || m.riskLevel === "high");
    if (criticalDirect.length > 0) {
      return {
        required: true,
        reason: `위험도 ${criticalDirect[0].riskLevel} 모듈 포함: ${criticalDirect.map((m) => m.moduleId).join(", ")}`,
      };
    }

    // 2. 공용 인터페이스 변경 → 회의 필요
    if (changedInterfaces.size > 0) {
      const modules = Array.from(changedInterfaces.keys()).join(", ");
      return { required: true, reason: `공용 인터페이스 변경: ${modules}` };
    }

    // 3. 2개 이상 모듈 직접 수정 → 회의 필요
    if (direct.length >= 2) {
      return { required: true, reason: `${direct.length}개 모듈 동시 수정` };
    }

    // 4. 간접 영향 모듈이 있으면 회의 필요
    if (indirect.length > 0) {
      return { required: true, reason: `간접 영향 모듈 ${indirect.length}개` };
    }

    // 5. 단일 모듈 + low/medium 위험도 + 인터페이스 변경 없음 → 회의 불필요
    return { required: false, reason: "single-module-internal" };
  }

  /**
   * 코드 외 의존성(테스트, 배포, 설정, 계약, 스키마) 영향을 분석한다.
   */
  private analyzeNonCodeDependencies(
    changedPaths: string[],
    directModules: string[],
  ): NonCodeImpact[] {
    const impacts: NonCodeImpact[] = [];

    for (const filePath of changedPaths) {
      // DB 스키마 (마이그레이션)
      if (filePath.includes("migrations") && filePath.endsWith(".ts")) {
        impacts.push({
          type: "schema",
          description: `DB 스키마 변경: ${filePath}`,
          affectedModules: Array.from(this.graph.modules.keys()), // 모든 모듈에 잠재적 영향
          severity: "critical",
        });
      }

      // 배포 설정 (CI, GitHub Actions)
      if (filePath.includes(".github/") || filePath.includes("scripts/")) {
        impacts.push({
          type: "deploy",
          description: `배포/CI 설정 변경: ${filePath}`,
          affectedModules: Array.from(this.graph.modules.keys()),
          severity: "warning",
        });
      }

      // 패키지 의존성
      if (filePath === "package.json" || filePath === "package-lock.json") {
        impacts.push({
          type: "config",
          description: `패키지 의존성 변경: ${filePath}`,
          affectedModules: Array.from(this.graph.modules.keys()),
          severity: "warning",
        });
      }

      // TypeScript 설정
      if (filePath === "tsconfig.json") {
        impacts.push({
          type: "config",
          description: `TypeScript 설정 변경`,
          affectedModules: Array.from(this.graph.modules.keys()),
          severity: "warning",
        });
      }

      // 계약 파일 (contracts.ts)
      if (filePath.endsWith("contracts.ts") || filePath.endsWith("contracts.js")) {
        const moduleId = directModules.find((m) => {
          const mod = this.graph.modules.get(m);
          return mod?.paths.some((p) => matchesPattern(filePath, normalizePath(p)));
        });
        if (moduleId) {
          // 의존하는 모든 모듈에 계약 영향
          const dependents = this.graph.reverseEdges.get(moduleId) ?? new Set();
          impacts.push({
            type: "contract",
            description: `${moduleId} 모듈 계약(타입) 변경: ${filePath}`,
            affectedModules: [moduleId, ...dependents],
            severity: "critical",
          });
        }
      }

      // 테스트 파일 직접 변경
      if (filePath.includes(".test.") || filePath.includes(".spec.")) {
        const moduleId = directModules.find((m) => {
          const mod = this.graph.modules.get(m);
          return mod?.affectedTests.some((t) => normalizePath(t) === filePath);
        });
        impacts.push({
          type: "test",
          description: `테스트 파일 변경: ${filePath}`,
          affectedModules: moduleId ? [moduleId] : [],
          severity: "info",
        });
      }

      // 모듈 레지스트리
      if (filePath.includes("module-registry")) {
        impacts.push({
          type: "config",
          description: `모듈 레지스트리 변경 — 영향도 분석 결과가 달라질 수 있음`,
          affectedModules: Array.from(this.graph.modules.keys()),
          severity: "warning",
        });
      }
    }

    return impacts;
  }

  private buildSummaryText(
    direct: ModuleImpact[],
    indirect: ModuleImpact[],
    observers: ModuleImpact[],
  ): string {
    const parts: string[] = [];

    if (direct.length > 0) {
      parts.push(`직접 영향: ${direct.map((m) => m.moduleId).join(", ")}`);
    }
    if (indirect.length > 0) {
      parts.push(`간접 영향: ${indirect.map((m) => m.moduleId).join(", ")}`);
    }
    if (observers.length > 0) {
      parts.push(`참관: ${observers.map((m) => m.moduleId).join(", ")}`);
    }

    return parts.join(" | ") || "영향받는 모듈 없음";
  }

  /**
   * 분석 신뢰도를 0.0~1.0 범위로 계산한다.
   * - 모든 경로가 모듈에 매핑되면 높음
   * - 인터페이스 변경 감지 시 높음
   * - 매핑되지 않는 경로가 많으면 낮음
   */
  private computeConfidence(
    normalizedPaths: string[],
    directModules: string[],
    changedInterfaces: Map<string, string[]>,
  ): number {
    if (normalizedPaths.length === 0) return 0;

    // 매핑된 경로 비율 (0.0 ~ 0.6)
    const mappedPaths = normalizedPaths.filter((fp) =>
      this.graph.pathPatterns.some(({ pattern }) =>
        matchesPattern(fp, normalizePath(pattern)),
      ),
    );
    const mappingRatio = mappedPaths.length / normalizedPaths.length;
    const mappingScore = mappingRatio * 0.6;

    // 직접 모듈 탐지 여부 (0.0 ~ 0.2)
    const moduleScore = directModules.length > 0 ? 0.2 : 0;

    // 인터페이스 변경 감지 깊이 (0.0 ~ 0.2)
    const interfaceScore = changedInterfaces.size > 0 ? 0.2 : 0.1;

    return Math.min(1, Math.round((mappingScore + moduleScore + interfaceScore) * 100) / 100);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 파일 경로를 정규화한다 (Windows 경로 → Unix 경로, 상대 경로 정규화).
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * glob 패턴에 파일 경로가 매칭되는지 확인한다.
 *
 * 지원 패턴:
 * - `src/research/**` — 디렉터리 하위 모든 파일
 * - `src/research/**\/*.ts` — 특정 확장자
 * - `src/store/migrations.ts` — 정확한 파일 경로
 * - `config/*.yaml` — 단일 레벨 와일드카드
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // 정확한 파일 매칭
  if (filePath === pattern) return true;

  // src/research/** → src/research/proposal-store.ts 매칭
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    if (filePath.startsWith(prefix + "/") || filePath === prefix) return true;
  }

  // src/research/**/*.ts 매칭
  if (pattern.includes("/**/*.")) {
    const [prefix, ext] = pattern.split("/**/*.");
    if (filePath.startsWith(prefix + "/") && filePath.endsWith("." + ext)) return true;
  }

  // config/*.yaml — 단일 레벨 와일드카드
  if (pattern.includes("/*.") && !pattern.includes("**/")) {
    const [dir, extPart] = pattern.split("/*.");
    if (filePath.startsWith(dir + "/") && filePath.endsWith("." + extPart)) {
      const remaining = filePath.slice(dir.length + 1);
      if (!remaining.includes("/")) return true;
    }
  }

  // 단순 접두사 매칭 (src/research → src/research/*)
  if (!pattern.includes("*") && filePath.startsWith(pattern + "/")) return true;

  // 간단한 glob 변환: * → 단일 세그먼트 매칭
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")   // 특수문자 이스케이프
    .replace(/\*\*\//g, "(?:.+/)?")           // **/ → 0개 이상의 디렉터리
    .replace(/\*\*/g, ".+")                   // ** → 모든 문자
    .replace(/\*/g, "[^/]+");                 // * → 파일명 (/ 제외)
  try {
    return new RegExp("^" + regexStr + "$").test(filePath);
  } catch {
    return false;
  }
}

/**
 * 파일 경로가 공용 인터페이스 파일일 가능성이 높은지 판단한다.
 * 경험적 규칙: contracts.ts, *.d.ts, public_interfaces.ts 등
 */
function isLikelyPublicInterface(filePath: string, _moduleId: string): boolean {
  const basename = filePath.split("/").pop() ?? "";
  return (
    basename === "contracts.ts" ||
    basename === "contracts.js" ||
    basename.endsWith(".d.ts") ||
    basename === "index.ts" ||
    basename === "index.js" ||
    basename === "public.ts"
  );
}

// ─── Convenience function ─────────────────────────────────────────────────────

/**
 * 변경된 파일 경로를 분석하여 영향받는 모듈을 반환한다.
 * 기본 module-registry.yaml을 사용한다.
 */
export function analyzeImpact(changedPaths: string[]): ImpactAnalysisResult {
  const analyzer = new ImpactAnalyzer();
  return analyzer.analyze(changedPaths);
}
