import { ConnectionPool } from "./connection-pool.js";
import type { ExecResult, BackgroundProcess } from "./types.js";
import type { SecurityExecutionContext } from "../security/policy.js";

/**
 * High-level remote execution interface.
 * Wraps ConnectionPool with task tracking and convenience methods.
 */
export class RemoteExecutor {
  private backgroundProcesses = new Map<string, BackgroundProcess>();

  constructor(private pool: ConnectionPool) {}

  async exec(
    machineId: string,
    command: string,
    timeoutMs?: number,
    securityContext?: SecurityExecutionContext,
  ): Promise<ExecResult> {
    if (timeoutMs && machineId !== "local") {
      const wrappedCmd = `timeout ${Math.ceil(timeoutMs / 1000)} ${command}`;
      return this.pool.exec(machineId, wrappedCmd, undefined, securityContext);
    }
    return this.pool.exec(machineId, command, timeoutMs, securityContext);
  }

  async execBackground(
    machineId: string,
    command: string,
    logPath?: string,
    opts?: { metricNames?: string[]; metricPatterns?: Record<string, string> },
    securityContext?: SecurityExecutionContext,
  ): Promise<BackgroundProcess> {
    const result = await this.pool.execBackground(
      machineId,
      command,
      logPath,
      securityContext,
    );

    const proc: BackgroundProcess = {
      pid: result.pid,
      machineId,
      command,
      logPath: result.logPath,
      startedAt: Date.now(),
      metricNames: opts?.metricNames,
      metricPatterns: opts?.metricPatterns,
    };

    const key = `${machineId}:${result.pid}`;
    this.backgroundProcesses.set(key, proc);
    return proc;
  }

  async isRunning(machineId: string, pid: number): Promise<boolean> {
    return this.pool.isProcessRunning(machineId, pid);
  }

  async tail(
    machineId: string,
    path: string,
    lines = 50,
    securityContext?: SecurityExecutionContext,
  ): Promise<string> {
    return this.pool.tailFile(machineId, path, lines, securityContext);
  }

  async readExitCode(
    machineId: string,
    logPath: string,
    securityContext?: SecurityExecutionContext,
  ): Promise<number | null> {
    return this.pool.readBackgroundExitCode(machineId, logPath, securityContext);
  }

  async gpuStatus(machineId: string, securityContext?: SecurityExecutionContext): Promise<string> {
    const result = await this.pool.exec(
      machineId,
      "nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader",
      undefined,
      {
        ...securityContext,
        machineId,
        toolName: securityContext?.toolName ?? "gpu_status",
        toolFamily: securityContext?.toolFamily ?? "shell",
        networkAccess: securityContext?.networkAccess ?? machineId !== "local",
      },
    );
    return result.stdout;
  }

  getBackgroundProcesses(): BackgroundProcess[] {
    return Array.from(this.backgroundProcesses.values());
  }

  getBackgroundProcess(
    machineId: string,
    pid: number,
  ): BackgroundProcess | undefined {
    return this.backgroundProcesses.get(`${machineId}:${pid}`);
  }

  removeBackgroundProcess(key: string): void {
    this.backgroundProcesses.delete(key);
  }
}
