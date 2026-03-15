/**
 * interface-tracker.ts
 *
 * 모듈의 공용 인터페이스(export) 변경을 감지한다.
 * TypeScript 소스에서 export 문을 파싱하고,
 * 변경된 파일에 export 추가/삭제/수정이 있는지 판단한다.
 *
 * 이 정보는 ImpactAnalyzer가 "공용 인터페이스 변경 → 회의 필수" 판단에 사용한다.
 */

import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportEntry {
  name: string;
  kind: "type" | "interface" | "function" | "class" | "const" | "enum" | "variable" | "unknown";
  isDefault: boolean;
  isReExport: boolean;
  sourceFile: string;
}

export interface InterfaceChangeReport {
  file: string;
  added: ExportEntry[];
  removed: ExportEntry[];
  isPublicInterfaceFile: boolean;
  hasBreakingChange: boolean;
}

// ─── PUBLIC_INTERFACE_PATTERNS ────────────────────────────────────────────────

/** 공용 인터페이스 파일로 간주하는 파일 이름 패턴 */
const PUBLIC_INTERFACE_FILES = [
  "contracts.ts",
  "contracts.js",
  "index.ts",
  "index.js",
  "public.ts",
  "types.ts",
];

// ─── Export Parser ────────────────────────────────────────────────────────────

/**
 * TypeScript/JavaScript 소스에서 export 문을 파싱한다.
 * AST 파서를 쓰지 않고 정규식 기반으로 주요 패턴을 캡처한다.
 */
export function parseExports(source: string, sourceFile: string): ExportEntry[] {
  const entries: ExportEntry[] = [];
  const lines = source.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // 주석 건너뛰기
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // export type X = ...
    const typeMatch = trimmed.match(/^export\s+type\s+(\w+)\s*[=<]/);
    if (typeMatch) {
      entries.push({ name: typeMatch[1], kind: "type", isDefault: false, isReExport: false, sourceFile });
      continue;
    }

    // export interface X { ...
    const ifaceMatch = trimmed.match(/^export\s+interface\s+(\w+)\s*[{<]/);
    if (ifaceMatch) {
      entries.push({ name: ifaceMatch[1], kind: "interface", isDefault: false, isReExport: false, sourceFile });
      continue;
    }

    // export class X ...
    const classMatch = trimmed.match(/^export\s+class\s+(\w+)\s*/);
    if (classMatch) {
      entries.push({ name: classMatch[1], kind: "class", isDefault: false, isReExport: false, sourceFile });
      continue;
    }

    // export function X ...
    const funcMatch = trimmed.match(/^export\s+(async\s+)?function\s+(\w+)\s*/);
    if (funcMatch) {
      entries.push({ name: funcMatch[2], kind: "function", isDefault: false, isReExport: false, sourceFile });
      continue;
    }

    // export const X = ...
    const constMatch = trimmed.match(/^export\s+const\s+(\w+)\s*[=:]/);
    if (constMatch) {
      entries.push({ name: constMatch[1], kind: "const", isDefault: false, isReExport: false, sourceFile });
      continue;
    }

    // export enum X { ...
    const enumMatch = trimmed.match(/^export\s+enum\s+(\w+)\s*\{/);
    if (enumMatch) {
      entries.push({ name: enumMatch[1], kind: "enum", isDefault: false, isReExport: false, sourceFile });
      continue;
    }

    // export default ...
    if (trimmed.startsWith("export default")) {
      const defaultMatch = trimmed.match(/^export\s+default\s+(?:class|function)?\s*(\w+)?/);
      entries.push({
        name: defaultMatch?.[1] ?? "default",
        kind: "unknown",
        isDefault: true,
        isReExport: false,
        sourceFile,
      });
      continue;
    }

    // export { X, Y } from "..."  (re-export)
    const reExportMatch = trimmed.match(/^export\s*\{([^}]+)\}\s*from\s*/);
    if (reExportMatch) {
      const names = reExportMatch[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim());
      for (const name of names) {
        if (name) {
          entries.push({ name, kind: "unknown", isDefault: false, isReExport: true, sourceFile });
        }
      }
      continue;
    }

    // export type { X, Y } from "..."
    const typeReExportMatch = trimmed.match(/^export\s+type\s*\{([^}]+)\}\s*from\s*/);
    if (typeReExportMatch) {
      const names = typeReExportMatch[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim());
      for (const name of names) {
        if (name) {
          entries.push({ name, kind: "type", isDefault: false, isReExport: true, sourceFile });
        }
      }
    }
  }

  return entries;
}

/**
 * 파일이 공용 인터페이스 파일인지 판단한다.
 */
export function isPublicInterfaceFile(filePath: string): boolean {
  const basename = filePath.split(/[/\\]/).pop() ?? "";
  return PUBLIC_INTERFACE_FILES.includes(basename);
}

/**
 * 변경된 파일의 export 변경 사항을 분석한다.
 *
 * @param filePath 변경된 파일의 절대 경로
 * @param previousSource 변경 전 소스 (git diff 등에서 획득)
 * @param currentSource 변경 후 소스 (현재 파일 내용)
 */
export function analyzeExportChanges(
  filePath: string,
  previousSource: string,
  currentSource: string,
): InterfaceChangeReport {
  const prevExports = parseExports(previousSource, filePath);
  const currExports = parseExports(currentSource, filePath);

  const prevNames = new Set(prevExports.map((e) => e.name));
  const currNames = new Set(currExports.map((e) => e.name));

  const added = currExports.filter((e) => !prevNames.has(e.name));
  const removed = prevExports.filter((e) => !currNames.has(e.name));

  const isPubFile = isPublicInterfaceFile(filePath);

  // breaking change = export 삭제 or 인터페이스 파일에서 export 변경
  const hasBreakingChange = removed.length > 0 || (isPubFile && (added.length > 0 || removed.length > 0));

  return {
    file: filePath,
    added,
    removed,
    isPublicInterfaceFile: isPubFile,
    hasBreakingChange,
  };
}

/**
 * 프로젝트 루트 기준으로 파일의 현재 export 목록을 반환한다.
 */
export function getFileExports(projectRoot: string, relativePath: string): ExportEntry[] {
  const ext = extname(relativePath);
  if (ext !== ".ts" && ext !== ".tsx" && ext !== ".js" && ext !== ".jsx") {
    return [];
  }

  const fullPath = join(projectRoot, relativePath);
  if (!existsSync(fullPath)) return [];

  try {
    const source = readFileSync(fullPath, "utf-8");
    return parseExports(source, relativePath);
  } catch {
    return [];
  }
}
