import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

const SNAPSHOT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".md", ".txt", ".json", ".yaml", ".yml"]);
const MAX_FILES = 20;
const MAX_BYTES_PER_FILE = 8192;

interface RepoSnapshotOptions {
  assertReadablePath?: (path: string) => void;
}

export async function resolveRepoSnapshotInput(
  root: string,
  explicitTitle?: string,
  options: RepoSnapshotOptions = {},
): Promise<{ title: string; text: string; notes?: string }> {
  options.assertReadablePath?.(root);
  const files = await collectSnapshotFiles(root, options);
  const sections: string[] = [];

  for (const file of files) {
    options.assertReadablePath?.(file);
    const content = await readFile(file, "utf8").catch(() => "");
    if (!content.trim()) continue;
    sections.push(`FILE ${relative(root, file)}\n${content.slice(0, MAX_BYTES_PER_FILE)}`);
  }

  return {
    title: explicitTitle ?? basename(root),
    text: sections.join("\n\n"),
    notes: `repo snapshot (${files.length} files)`,
  };
}

async function collectSnapshotFiles(root: string, options: RepoSnapshotOptions): Promise<string[]> {
  const results: string[] = [];
  await walk(root, results, options);
  return results.slice(0, MAX_FILES);
}

async function walk(dir: string, results: string[], options: RepoSnapshotOptions): Promise<void> {
  if (results.length >= MAX_FILES) return;
  options.assertReadablePath?.(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= MAX_FILES) return;
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, results, options);
      continue;
    }
    if (!SNAPSHOT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const info = await stat(fullPath).catch(() => null);
    if (!info || info.size > MAX_BYTES_PER_FILE * 4) continue;
    results.push(fullPath);
  }
}
