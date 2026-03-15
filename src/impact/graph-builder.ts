/**
 * graph-builder.ts
 *
 * 모듈 레지스트리(config/module-registry.yaml)를 읽어서
 * 모듈 의존성 그래프를 메모리에 구성한다.
 *
 * 이 그래프는 ImpactAnalyzer가 변경 파일 목록으로부터
 * 영향받는 모듈을 계산하는 데 사용된다.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "../config/yaml-parser.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModuleDefinition {
  moduleId: string;
  displayName: string;
  description: string;
  ownerAgent: string;
  humanOwner: string;
  paths: string[];
  publicInterfaces: string[];
  dependsOn: string[];
  runtimeDependencies: string[];
  affectedTests: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  mergeGate: string;
  notes: string[];
}

export interface MergeGateDefinition {
  description: string;
  requiredApprovals: string[];
  requiredChecks: string[];
}

export interface ModuleRegistry {
  version: string;
  updatedAt: string;
  pilotPhase: boolean;
  modules: ModuleDefinition[];
  mergeGates: Record<string, MergeGateDefinition>;
}

export interface ModuleGraph {
  /** moduleId → ModuleDefinition */
  modules: Map<string, ModuleDefinition>;

  /**
   * 정방향 의존 그래프: A depends_on B → edges.get('A') includes 'B'
   * (A가 B에 의존한다)
   */
  edges: Map<string, Set<string>>;

  /**
   * 역방향 의존 그래프: A depends_on B → reverseEdges.get('B') includes 'A'
   * (B가 변경되면 A가 영향을 받는다)
   */
  reverseEdges: Map<string, Set<string>>;

  /** 경로 패턴 → moduleId 매핑 (glob matching용) */
  pathPatterns: Array<{ pattern: string; moduleId: string }>;

  mergeGates: Record<string, MergeGateDefinition>;
}

// ─── YAML Raw Types ───────────────────────────────────────────────────────────

interface RawModule {
  module_id: string;
  display_name?: string;
  description?: string;
  owner_agent: string;
  human_owner?: string;
  paths: string[];
  public_interfaces?: string[];
  depends_on?: string[];
  runtime_dependencies?: string[];
  affected_tests?: string[];
  risk_level?: string;
  merge_gate?: string;
  notes?: string[];
}

interface RawMergeGate {
  description: string;
  required_approvals?: string[];
  required_checks?: string[];
}

interface RawRegistry {
  version?: string;
  updated_at?: string;
  pilot_phase?: boolean;
  modules: RawModule[];
  merge_gates?: Record<string, RawMergeGate>;
}

// ─── GraphBuilder ─────────────────────────────────────────────────────────────

export class GraphBuilder {
  private registryPath: string;

  constructor(registryPath?: string) {
    // 기본 경로: 프로젝트 루트의 config/module-registry.yaml
    this.registryPath = registryPath ?? join(process.cwd(), "config", "module-registry.yaml");
  }

  /**
   * YAML 파일을 읽어서 ModuleGraph를 구성한다.
   * 파일을 찾을 수 없거나 파싱 오류가 발생하면 에러를 던진다.
   */
  build(): ModuleGraph {
    const rawYaml = readFileSync(this.registryPath, "utf-8");
    const raw = parseYaml(rawYaml) as RawRegistry;
    return this.buildFromRegistry(raw);
  }

  /**
   * 이미 파싱된 레지스트리 객체로부터 그래프를 구성한다.
   * 테스트에서 직접 호출 가능.
   */
  buildFromRegistry(raw: RawRegistry): ModuleGraph {
    const modules = new Map<string, ModuleDefinition>();
    const edges = new Map<string, Set<string>>();
    const reverseEdges = new Map<string, Set<string>>();
    const pathPatterns: Array<{ pattern: string; moduleId: string }> = [];
    const mergeGates: Record<string, MergeGateDefinition> = {};

    // 1. merge gates 파싱
    for (const [gateId, gate] of Object.entries(raw.merge_gates ?? {})) {
      mergeGates[gateId] = {
        description: gate.description,
        requiredApprovals: gate.required_approvals ?? [],
        requiredChecks: gate.required_checks ?? [],
      };
    }

    // 2. 모듈 파싱 및 경로 패턴 수집
    for (const rawMod of raw.modules) {
      const mod: ModuleDefinition = {
        moduleId: rawMod.module_id,
        displayName: rawMod.display_name ?? rawMod.module_id,
        description: rawMod.description ?? "",
        ownerAgent: rawMod.owner_agent,
        humanOwner: rawMod.human_owner ?? "",
        paths: rawMod.paths,
        publicInterfaces: rawMod.public_interfaces ?? [],
        dependsOn: rawMod.depends_on ?? [],
        runtimeDependencies: rawMod.runtime_dependencies ?? [],
        affectedTests: rawMod.affected_tests ?? [],
        riskLevel: (rawMod.risk_level as ModuleDefinition["riskLevel"]) ?? "medium",
        mergeGate: rawMod.merge_gate ?? "proposal_required",
        notes: rawMod.notes ?? [],
      };

      modules.set(mod.moduleId, mod);
      edges.set(mod.moduleId, new Set(mod.dependsOn));

      // reverseEdges 초기화
      if (!reverseEdges.has(mod.moduleId)) {
        reverseEdges.set(mod.moduleId, new Set());
      }

      // 경로 패턴 등록
      for (const pathPattern of mod.paths) {
        pathPatterns.push({ pattern: pathPattern, moduleId: mod.moduleId });
      }
    }

    // 3. 역방향 의존 그래프 구성
    // A depends_on [B, C] → reverseEdges[B].add(A), reverseEdges[C].add(A)
    for (const [modId, deps] of edges) {
      for (const dep of deps) {
        if (!reverseEdges.has(dep)) {
          reverseEdges.set(dep, new Set());
        }
        reverseEdges.get(dep)!.add(modId);
      }
    }

    return {
      modules,
      edges,
      reverseEdges,
      pathPatterns,
      mergeGates,
    };
  }

  /**
   * 그래프 유효성 검사:
   * - 모든 depends_on 참조가 실존하는 모듈을 가리키는지 확인
   * - 순환 의존 감지
   */
  validate(graph: ModuleGraph): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. 미정의 의존 모듈 검사
    for (const [modId, deps] of graph.edges) {
      for (const dep of deps) {
        if (!graph.modules.has(dep)) {
          errors.push(`모듈 '${modId}'이 미정의 모듈 '${dep}'에 의존합니다`);
        }
      }
    }

    // 2. 순환 의존 감지 (DFS)
    const cycles = this.detectCycles(graph);
    for (const cycle of cycles) {
      errors.push(`순환 의존 감지: ${cycle.join(" → ")}`);
    }

    // 3. merge_gate 참조 유효성 검사
    for (const [, mod] of graph.modules) {
      if (mod.mergeGate && !(mod.mergeGate in graph.mergeGates)) {
        warnings.push(`모듈 '${mod.moduleId}'의 merge_gate '${mod.mergeGate}'가 정의되지 않음`);
      }
    }

    // 4. human_owner 필수 검사
    for (const [, mod] of graph.modules) {
      if (!mod.humanOwner) {
        errors.push(`모듈 '${mod.moduleId}'에 human_owner가 정의되지 않음`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private detectCycles(graph: ModuleGraph): string[][] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (nodeId: string, path: string[]): void => {
      visited.add(nodeId);
      inStack.add(nodeId);

      const deps = graph.edges.get(nodeId) ?? new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          dfs(dep, [...path, nodeId]);
        } else if (inStack.has(dep)) {
          const cycleStart = path.indexOf(dep);
          cycles.push([...path.slice(cycleStart), nodeId, dep]);
        }
      }

      inStack.delete(nodeId);
    };

    for (const modId of graph.modules.keys()) {
      if (!visited.has(modId)) {
        dfs(modId, []);
      }
    }

    return cycles;
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _cachedGraph: ModuleGraph | null = null;
let _cacheTimestamp: number = 0;
const CACHE_TTL_MS = 30_000; // 30초

/**
 * 캐시된 그래프를 반환한다. 캐시가 없거나 만료되었으면 재빌드한다.
 */
export function getModuleGraph(registryPath?: string): ModuleGraph {
  const now = Date.now();
  if (_cachedGraph && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedGraph;
  }

  const builder = new GraphBuilder(registryPath);
  _cachedGraph = builder.build();
  _cacheTimestamp = now;
  return _cachedGraph;
}

/**
 * 캐시를 명시적으로 무효화한다 (레지스트리 변경 후 호출).
 */
export function invalidateModuleGraphCache(): void {
  _cachedGraph = null;
  _cacheTimestamp = 0;
}
