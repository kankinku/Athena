/**
 * codeowners-sync.ts
 *
 * config/module-registry.yaml ↔ .github/CODEOWNERS 동기화 유틸리티.
 *
 * module-registry.yaml의 paths를 CODEOWNERS 형식으로 변환하고,
 * 역으로 CODEOWNERS에서 모듈 매핑을 검증한다.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { ModuleGraph, ModuleDefinition } from "./graph-builder.js";
import { getModuleGraph } from "./graph-builder.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CodeownersEntry {
  pattern: string;
  owners: string[];
  moduleId?: string;
  comment?: string;
}

export interface SyncResult {
  inSync: boolean;
  missingInCodeowners: Array<{ moduleId: string; paths: string[] }>;
  extraInCodeowners: string[];
  generated: string;
}

// ─── CodeownersSync ───────────────────────────────────────────────────────────

export class CodeownersSync {
  private graph: ModuleGraph;
  private codeownersPath: string;
  private defaultOwner: string;

  constructor(options?: {
    graph?: ModuleGraph;
    projectRoot?: string;
    defaultOwner?: string;
  }) {
    this.graph = options?.graph ?? getModuleGraph();
    const root = options?.projectRoot ?? process.cwd();
    this.codeownersPath = join(root, ".github", "CODEOWNERS");
    this.defaultOwner = options?.defaultOwner ?? "@snoglobe";
  }

  /**
   * module-registry.yaml로부터 CODEOWNERS 파일 내용을 생성한다.
   */
  generate(): string {
    const lines: string[] = [
      "# Athena CODEOWNERS",
      "# Auto-generated from config/module-registry.yaml",
      `# Generated at: ${new Date().toISOString()}`,
      "#",
      "# sync source: config/module-registry.yaml",
      "# sync tool:   src/impact/codeowners-sync.ts",
      "",
    ];

    // 모듈을 risk level 순서로 정렬 (critical → high → medium → low)
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sortedModules = Array.from(this.graph.modules.values())
      .sort((a, b) => (riskOrder[a.riskLevel] ?? 4) - (riskOrder[b.riskLevel] ?? 4));

    for (const mod of sortedModules) {
      lines.push(`# module_id: ${mod.moduleId} | owner_agent: ${mod.ownerAgent} | risk: ${mod.riskLevel}`);

      for (const pathPattern of mod.paths) {
        const codeownersPattern = this.toCodeownersPattern(pathPattern);
        lines.push(`${codeownersPattern.padEnd(45)} ${this.defaultOwner}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 현재 CODEOWNERS 파일과 registry의 동기 상태를 확인한다.
   */
  check(): SyncResult {
    const generated = this.generate();
    const missingInCodeowners: Array<{ moduleId: string; paths: string[] }> = [];
    const extraInCodeowners: string[] = [];

    // 현재 CODEOWNERS 파싱
    const currentEntries = this.parseCodeowners();
    const currentPatterns = new Set(currentEntries.map((e) => e.pattern));

    // registry에 있지만 CODEOWNERS에 없는 경로
    for (const [modId, mod] of this.graph.modules) {
      const missingPaths: string[] = [];
      for (const pathPattern of mod.paths) {
        const coPattern = this.toCodeownersPattern(pathPattern);
        if (!currentPatterns.has(coPattern)) {
          missingPaths.push(coPattern);
        }
      }
      if (missingPaths.length > 0) {
        missingInCodeowners.push({ moduleId: modId, paths: missingPaths });
      }
    }

    // CODEOWNERS에 있지만 registry에 매칭 안 되는 패턴 (주석/빈줄 제외)
    const registryPatterns = new Set<string>();
    for (const mod of this.graph.modules.values()) {
      for (const p of mod.paths) {
        registryPatterns.add(this.toCodeownersPattern(p));
      }
    }
    for (const entry of currentEntries) {
      if (!registryPatterns.has(entry.pattern)) {
        extraInCodeowners.push(entry.pattern);
      }
    }

    return {
      inSync: missingInCodeowners.length === 0 && extraInCodeowners.length === 0,
      missingInCodeowners,
      extraInCodeowners,
      generated,
    };
  }

  /**
   * CODEOWNERS 파일을 registry 기반으로 업데이트한다.
   */
  sync(): SyncResult {
    const result = this.check();
    if (!result.inSync) {
      writeFileSync(this.codeownersPath, result.generated, "utf-8");
    }
    return result;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * glob 패턴을 CODEOWNERS 형식으로 변환한다.
   * src/store/** → /src/store/
   */
  private toCodeownersPattern(globPattern: string): string {
    let pattern = globPattern.replace(/\\/g, "/");

    // ** 제거 → 디렉터리 패턴
    if (pattern.endsWith("/**")) {
      pattern = pattern.slice(0, -2); // "src/store/**" → "src/store/"
    } else if (pattern.endsWith("/**/*")) {
      pattern = pattern.slice(0, -4); // "src/store/**/*" → "src/store/"
    }

    // 선두 / 보장
    if (!pattern.startsWith("/")) {
      pattern = "/" + pattern;
    }

    // 끝에 / 보장 (디렉터리 패턴)
    if (!pattern.endsWith("/") && !pattern.includes(".")) {
      pattern += "/";
    }

    return pattern;
  }

  /**
   * 현재 CODEOWNERS 파일을 파싱한다.
   */
  private parseCodeowners(): CodeownersEntry[] {
    if (!existsSync(this.codeownersPath)) return [];

    const content = readFileSync(this.codeownersPath, "utf-8");
    const entries: CodeownersEntry[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        entries.push({
          pattern: parts[0],
          owners: parts.slice(1),
        });
      }
    }

    return entries;
  }
}

/**
 * CLI에서 직접 실행 시 동기화 상태를 출력한다.
 */
export function printSyncStatus(): void {
  try {
    const sync = new CodeownersSync();
    const result = sync.check();

    if (result.inSync) {
      console.log("CODEOWNERS is in sync with module-registry.yaml");
    } else {
      console.log("CODEOWNERS is OUT OF SYNC:");
      for (const m of result.missingInCodeowners) {
        console.log(`  Missing (${m.moduleId}): ${m.paths.join(", ")}`);
      }
      for (const e of result.extraInCodeowners) {
        console.log(`  Extra: ${e}`);
      }
      console.log("\nRun 'athena codeowners sync' to update.");
    }
  } catch (e) {
    console.error("Sync check failed:", (e as Error).message);
  }
}
