import { execFile as execFileCb } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { shellQuote } from "../ui/format.js";

const execFileAsync = promisify(execFileCb);

export interface LocalShellCommand {
  command: string;
  args: string[];
}

export function getLocalShell(platform = process.platform): string {
  if (platform === "win32") {
    return process.env.ComSpec ?? "cmd.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}

export function getLocalShellCommand(platform = process.platform): LocalShellCommand {
  if (platform === "win32") {
    return {
      command: getLocalShell(platform),
      args: ["/d", "/c"],
    };
  }

  return {
    command: getLocalShell(platform),
    args: ["-c"],
  };
}

export function getNullDevice(platform = process.platform): string {
  return platform === "win32" ? "NUL" : "/dev/null";
}

export function createTempLogPath(prefix = "athena", platform = process.platform): string {
  const suffix = randomBytes(4).toString("hex");
  return join(tmpdir(), `${prefix}-${Date.now()}-${suffix}.log`);
}

function sanitizeManagedLogLabel(requestedPath?: string): string {
  if (!requestedPath) return "athena";
  const leaf = requestedPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() ?? requestedPath;
  const stem = leaf.replace(/\.[^.]+$/u, "");
  const sanitized = stem
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return sanitized.length > 0 ? sanitized : "athena";
}

export function createManagedLocalLogPath(requestedPath?: string): string {
  const suffix = randomBytes(4).toString("hex");
  const label = sanitizeManagedLogLabel(requestedPath);
  return join(tmpdir(), "athena-logs", `${label}-${Date.now()}-${suffix}.log`);
}

export function createManagedRemoteLogPath(requestedPath?: string): string {
  const suffix = randomBytes(4).toString("hex");
  const label = sanitizeManagedLogLabel(requestedPath);
  return `/tmp/athena-logs/${label}-${Date.now()}-${suffix}.log`;
}

export function getExitFilePath(logPath: string): string {
  return `${logPath}.exit`;
}

export function buildBackgroundExitCommand(
  command: string,
  logPath: string,
  platform = process.platform,
): string {
  const exitPath = getExitFilePath(logPath);
  if (platform === "win32") {
    const escapedExitPath = exitPath.replace(/"/g, '""');
    return `(${command}) & echo %errorlevel% > "${escapedExitPath}"`;
  }
  return `${command}; printf '%s' "$?" > ${shellQuote(exitPath)}`;
}

export async function commandExists(
  command: string,
  platform = process.platform,
): Promise<boolean> {
  const lookup = platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(lookup, [command], { windowsHide: true });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
