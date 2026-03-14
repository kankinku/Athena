import type { ToolDefinition } from "../providers/types.js";
import type { ConnectionPool } from "../remote/connection-pool.js";
import type { SecurityManager } from "../security/policy.js";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { shellQuote } from "../ui/format.js";

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

async function findWorkspacePathCandidates(filename: string, root = process.cwd(), limit = 5): Promise<string[]> {
  const results: string[] = [];
  const ignored = new Set([".git", ".omx", "node_modules", "dist"]);

  async function walk(dir: string): Promise<void> {
    if (results.length >= limit) {
      return;
    }

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }

      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          await walk(join(dir, entry.name));
        }
        continue;
      }

      if (entry.isFile() && entry.name === filename) {
        results.push(join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return results;
}

async function tryResolveSnapshotPath(path: string): Promise<string | null> {
  if (!/^[a-zA-Z]:\\snapshot\\/i.test(path) && !/^\/snapshot\//i.test(path)) {
    return null;
  }

  const candidates = await findWorkspacePathCandidates(basename(path), process.cwd(), 2);
  if (candidates.length === 1) {
    return candidates[0];
  }

  return null;
}

export function createReadFileTool(pool: ConnectionPool, securityManager?: SecurityManager): ToolDefinition {
  return {
    name: "read_file",
    description:
      "Read a file's contents. Use this to inspect training scripts, configs, logs, or any text file.",
    parameters: {
      type: "object",
      properties: {
        machine_id: {
          type: "string",
          description: 'Machine to read from (use "local" for this machine)',
        },
        path: {
          type: "string",
          description: "Absolute path to the file",
        },
        offset: {
          type: "number",
          description: "Line number to start from (1-indexed, default: 1)",
        },
        limit: {
          type: "number",
          description: "Max lines to return (default: 200)",
        },
      },
      required: ["machine_id", "path"],
    },
    execute: async (args) => {
      const machineId = args.machine_id as string;
      const path = args.path as string;
      const securityContext = {
        actorRole: "agent" as const,
        machineId,
        toolName: "read_file",
        toolFamily: "filesystem" as const,
        networkAccess: machineId !== "local",
      };
      securityManager?.assertPathAllowed(path, "read", securityContext);
      const offset = (args.offset as number) ?? 1;
      const limit = (args.limit as number) ?? 200;
      if (machineId === "local") {
        try {
          const resolvedPath = (await tryResolveSnapshotPath(path)) ?? path;
          const content = await readFile(resolvedPath, "utf-8");
          const lines = splitLines(content);
          const fromIndex = Math.max(0, offset - 1);
          const selected = lines.slice(fromIndex, fromIndex + limit).join("\n");
          return JSON.stringify({
            content: selected,
            resolvedFrom: resolvedPath !== path ? path : undefined,
            resolvedPath,
            lines: {
              from: Math.min(offset, lines.length === 0 ? 0 : lines.length),
              to: Math.min(offset + limit - 1, lines.length),
              total: lines.length,
            },
          });
        } catch (error) {
          const suggestions = await findWorkspacePathCandidates(basename(path)).catch(() => []);
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            suggestions: suggestions.length > 0 ? suggestions : undefined,
          });
        }
      }

      const end = offset + limit - 1;
      const result = await pool.exec(
        machineId,
        `sed -n '${offset},${end}p' ${shellQuote(path)}`,
        undefined,
        securityContext,
      );

      if (result.exitCode !== 0) {
        return JSON.stringify({ error: result.stderr.trim() || `exit code ${result.exitCode}` });
      }

      // Count total lines for context
      const wcResult = await pool.exec(machineId, `wc -l < ${shellQuote(path)}`, undefined, securityContext);
      const totalLines = parseInt(wcResult.stdout.trim(), 10) || 0;

      return JSON.stringify({
        content: result.stdout,
        lines: { from: offset, to: Math.min(end, totalLines), total: totalLines },
      });
    },
  };
}

export function createWriteFileTool(pool: ConnectionPool, securityManager?: SecurityManager): ToolDefinition {
  return {
    name: "write_file",
    description:
      "Create or overwrite a file. Use this to write training scripts, configs, or data files.",
    parameters: {
      type: "object",
      properties: {
        machine_id: {
          type: "string",
          description: 'Machine to write to (use "local" for this machine)',
        },
        path: {
          type: "string",
          description: "Absolute path for the file",
        },
        content: {
          type: "string",
          description: "Full file content to write",
        },
        append: {
          type: "boolean",
          description: "Append instead of overwrite (default: false)",
        },
      },
      required: ["machine_id", "path", "content"],
    },
    execute: async (args) => {
      const machineId = args.machine_id as string;
      const path = args.path as string;
      const securityContext = {
        actorRole: "agent" as const,
        machineId,
        toolName: "write_file",
        toolFamily: "filesystem" as const,
        networkAccess: machineId !== "local",
        destructive: true,
      };
      securityManager?.assertPathAllowed(path, "write", securityContext);
      const content = args.content as string;
      const append = (args.append as boolean) ?? false;
      if (machineId === "local") {
        try {
          await mkdir(dirname(path), { recursive: true });
          if (append) {
            await appendFile(path, content, "utf-8");
          } else {
            await writeFile(path, content, "utf-8");
          }
          const lines = splitLines(await readFile(path, "utf-8"));
          return JSON.stringify({ written: path, lines: lines.length });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Ensure parent directory exists
      const dir = path.replace(/\/[^/]+$/, "");
      if (dir && dir !== path) {
        await pool.exec(machineId, `mkdir -p ${shellQuote(dir)}`, undefined, securityContext);
      }

      const op = append ? ">>" : ">";
      // Use heredoc to handle multi-line content safely
      // Heredoc implicitly adds a trailing newline, so strip one from content to avoid doubling
      const body = content.endsWith("\n") ? content.slice(0, -1) : content;
      const heredocTag = "_ATHENA_EOF_" + Math.random().toString(36).slice(2, 8);
      const result = await pool.exec(
        machineId,
        `cat ${op} ${shellQuote(path)} <<'${heredocTag}'\n${body}\n${heredocTag}`,
        undefined,
        securityContext,
      );

      if (result.exitCode !== 0) {
        return JSON.stringify({ error: result.stderr.trim() || `exit code ${result.exitCode}` });
      }

      const wcResult = await pool.exec(machineId, `wc -l < ${shellQuote(path)}`, undefined, securityContext);
      const totalLines = parseInt(wcResult.stdout.trim(), 10) || 0;

      return JSON.stringify({ written: path, lines: totalLines });
    },
  };
}

export function createPatchFileTool(pool: ConnectionPool, securityManager?: SecurityManager): ToolDefinition {
  return {
    name: "patch_file",
    description:
      "Edit a file by replacing a specific string with new content. Read the file first to see the exact text to match.",
    parameters: {
      type: "object",
      properties: {
        machine_id: {
          type: "string",
          description: 'Machine where the file lives (use "local" for this machine)',
        },
        path: {
          type: "string",
          description: "Absolute path to the file",
        },
        old_string: {
          type: "string",
          description: "Exact text to find and replace (must appear exactly once in the file)",
        },
        new_string: {
          type: "string",
          description: "Replacement text",
        },
      },
      required: ["machine_id", "path", "old_string", "new_string"],
    },
    execute: async (args) => {
      const machineId = args.machine_id as string;
      const path = args.path as string;
      const securityContext = {
        actorRole: "agent" as const,
        machineId,
        toolName: "patch_file",
        toolFamily: "filesystem" as const,
        networkAccess: machineId !== "local",
        destructive: true,
      };
      securityManager?.assertPathAllowed(path, "write", securityContext);
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      if (machineId === "local") {
        try {
          const content = await readFile(path, "utf-8");
          const count = countOccurrences(content, oldStr);
          if (count === 0) {
            return JSON.stringify({ error: "old_string not found in file" });
          }
          if (count > 1) {
            return JSON.stringify({ error: `old_string found ${count} times — must be unique. Include more surrounding context.` });
          }
          await writeFile(path, content.replace(oldStr, newStr), "utf-8");
          return JSON.stringify({ patched: path });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Read current file
      const readResult = await pool.exec(machineId, `cat ${shellQuote(path)}`, undefined, securityContext);
      if (readResult.exitCode !== 0) {
        return JSON.stringify({ error: readResult.stderr.trim() || "Failed to read file" });
      }

      const content = readResult.stdout;
      const count = content.split(oldStr).length - 1;

      if (count === 0) {
        return JSON.stringify({ error: "old_string not found in file" });
      }
      if (count > 1) {
        return JSON.stringify({ error: `old_string found ${count} times — must be unique. Include more surrounding context.` });
      }

      const patched = content.replace(oldStr, newStr);

      // Write back using heredoc
      // Strip trailing newline since heredoc adds one implicitly
      const body = patched.endsWith("\n") ? patched.slice(0, -1) : patched;
      const heredocTag = "_ATHENA_EOF_" + Math.random().toString(36).slice(2, 8);
      const writeResult = await pool.exec(
        machineId,
        `cat > ${shellQuote(path)} <<'${heredocTag}'\n${body}\n${heredocTag}`,
        undefined,
        securityContext,
      );

      if (writeResult.exitCode !== 0) {
        return JSON.stringify({ error: writeResult.stderr.trim() || "Failed to write file" });
      }

      return JSON.stringify({ patched: path });
    },
  };
}

