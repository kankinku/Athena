import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

const SNAPSHOT_PATH_PATTERN = /[A-Za-z]:\\snapshot\\[^\s"'`]+|\/snapshot\/[^\s"'`]+/g;
const IGNORED_DIRS = new Set([".git", ".omx", "node_modules", "dist"]);

function findWorkspacePathCandidatesSync(filename: string, root: string, limit = 2): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    if (results.length >= limit) {
      return;
    }

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(join(dir, entry.name));
        }
        continue;
      }

      if (entry.isFile() && entry.name === filename) {
        results.push(join(dir, entry.name));
      }
    }
  }

  walk(root);
  return results;
}

export function normalizeSnapshotPath(path: string, root = process.env.ATHENA_APP_ROOT ?? process.cwd()): string {
  if (!/^[A-Za-z]:\\snapshot\\/i.test(path) && !/^\/snapshot\//i.test(path)) {
    return path;
  }

  const candidates = findWorkspacePathCandidatesSync(basename(path), root, 2);
  return candidates.length === 1 ? candidates[0] : path;
}

export function normalizeDisplayValue<T>(value: T, root = process.env.ATHENA_APP_ROOT ?? process.cwd()): T {
  if (typeof value === "string") {
    return value.replace(SNAPSHOT_PATH_PATTERN, (match) => normalizeSnapshotPath(match, root)) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDisplayValue(item, root)) as T;
  }

  if (value && typeof value === "object") {
    const normalizedEntries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      normalizeDisplayValue(item, root),
    ]);
    return Object.fromEntries(normalizedEntries) as T;
  }

  return value;
}

export function normalizeToolResultForDisplay(result: string, root = process.env.ATHENA_APP_ROOT ?? process.cwd()): string {
  try {
    const parsed = JSON.parse(result) as unknown;
    return JSON.stringify(normalizeDisplayValue(parsed, root));
  } catch {
    return normalizeDisplayValue(result, root);
  }
}
