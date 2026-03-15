import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { commandExists } from "./local-runtime.js";
import type { ExecResult } from "./types.js";

const execFileAsync = promisify(execFileCb);

export interface DockerRuntimeConfig {
  /** Docker image to use (default: "ubuntu:22.04") */
  image?: string;
  /** Container name prefix (default: "athena-exec") */
  containerPrefix?: string;
  /** Additional volumes to mount: host:container */
  volumes?: string[];
  /** Working directory inside container */
  workdir?: string;
  /** Environment variables to inject */
  env?: Record<string, string>;
}

const DEFAULT_IMAGE = "ubuntu:22.04";
const DEFAULT_PREFIX = "athena-exec";

/**
 * Check whether Docker CLI is available and the daemon is responsive.
 */
export async function isDockerAvailable(): Promise<boolean> {
  if (!(await commandExists("docker"))) return false;
  try {
    const { stdout } = await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Execute a shell command inside a disposable Docker container.
 * The container is removed after execution (--rm).
 */
export async function execDocker(
  command: string,
  config: DockerRuntimeConfig = {},
  timeoutMs = 300_000,
): Promise<ExecResult> {
  const image = config.image ?? DEFAULT_IMAGE;
  const args = ["run", "--rm"];

  // Apply resource limits for safety
  args.push("--memory=512m", "--cpus=1", "--network=none");

  if (config.workdir) {
    args.push("-w", config.workdir);
  }

  if (config.volumes) {
    for (const vol of config.volumes) {
      args.push("-v", vol);
    }
  }

  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push(image, "/bin/sh", "-c", command);

  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number; signal?: string };
    const exitCode = typeof error.code === "number" ? error.code : 1;
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode,
    };
  }
}

/**
 * Execute a long-running command in a named background Docker container.
 * Returns the container name (used as a pseudo-PID identifier).
 */
export async function execDockerBackground(
  command: string,
  logPath: string,
  config: DockerRuntimeConfig = {},
): Promise<{ containerId: string; logPath: string }> {
  const image = config.image ?? DEFAULT_IMAGE;
  const name = `${config.containerPrefix ?? DEFAULT_PREFIX}-${Date.now()}`;
  const args = ["run", "-d", "--name", name];

  args.push("--memory=512m", "--cpus=1");

  if (config.workdir) {
    args.push("-w", config.workdir);
  }

  if (config.volumes) {
    for (const vol of config.volumes) {
      args.push("-v", vol);
    }
  }

  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push(image, "/bin/sh", "-c", command);

  const { stdout } = await execFileAsync("docker", args, {
    timeout: 30_000,
    windowsHide: true,
  });
  const containerId = stdout.trim().slice(0, 12);

  return { containerId, logPath };
}

/**
 * Read logs from a named Docker container.
 */
export async function dockerLogs(
  containerId: string,
  tailLines = 50,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["logs", "--tail", String(tailLines), containerId],
      { timeout: 10_000, windowsHide: true },
    );
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Check if a Docker container is still running.
 */
export async function isDockerContainerRunning(containerId: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", containerId],
      { timeout: 10_000, windowsHide: true },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
