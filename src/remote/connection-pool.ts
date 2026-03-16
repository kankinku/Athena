import { Client } from "ssh2";
import { exec as cpExec, spawn } from "node:child_process";
import { readFileSync, openSync, closeSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { shellQuote, formatError } from "../ui/format.js";
import {
  buildBackgroundExitCommand,
  createManagedLocalLogPath,
  createManagedRemoteLogPath,
  getExitFilePath,
  getLocalShell,
  getLocalShellCommand,
} from "./local-runtime.js";
import { execDocker, isDockerAvailable, type DockerRuntimeConfig } from "./docker-runtime.js";
import type { SecurityExecutionContext, SecurityManager } from "../security/policy.js";
import type {
  RemoteMachine,
  ExecResult,
  ConnectionStatus,
} from "./types.js";

export const LOCAL_MACHINE: RemoteMachine = {
  id: "local",
  host: "localhost",
  port: 0,
  username: process.env.USER ?? "local",
  authMethod: "local" as any,
  labels: ["local"],
};

interface PooledConnection {
  client: Client | null; // null for local
  machine: RemoteMachine;
  connected: boolean;
  lastUsedAt: number;
  reconnectAttempts: number;
  lastError?: string;
}

function decodeLocalShellOutput(value: string | Buffer | null | undefined, platform = process.platform): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (platform !== "win32") {
    return value.toString("utf8");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(value);
    } catch {
      return value.toString("utf8");
    }
  }
}

export class ConnectionPool {
  private connections = new Map<string, PooledConnection>();
  private machines = new Map<string, RemoteMachine>();
  private dockerConfig?: DockerRuntimeConfig;
  private dockerAvailable?: boolean;

  constructor(private securityManager?: SecurityManager) {
    // Always register the local machine
    this.machines.set("local", LOCAL_MACHINE);
    this.connections.set("local", {
      client: null,
      machine: LOCAL_MACHINE,
      connected: true,
      lastUsedAt: Date.now(),
      reconnectAttempts: 0,
    });
  }

  /**
   * Enable Docker-based execution for local commands.
   * When enabled, `exec("local", ...)` uses a disposable Docker container
   * instead of the host shell — eliminating platform-specific issues on Windows.
   */
  async enableDocker(config: DockerRuntimeConfig = {}): Promise<boolean> {
    this.dockerAvailable = await isDockerAvailable();
    if (this.dockerAvailable) {
      this.dockerConfig = config;
    }
    return this.dockerAvailable;
  }

  addMachine(machine: RemoteMachine): void {
    this.machines.set(machine.id, machine);
  }

  removeMachine(id: string): void {
    if (id === "local") return; // Can't remove local
    this.disconnect(id);
    this.machines.delete(id);
  }

  async connect(machineId: string): Promise<void> {
    if (machineId === "local") return; // Always connected

    const machine = this.machines.get(machineId);
    if (!machine) throw new Error(`Unknown machine: ${machineId}`);

    const existing = this.connections.get(machineId);
    if (existing?.connected) return;

    // Clean up any previous failed client before creating a new one
    if (existing?.client) {
      try { existing.client.end(); } catch { /* best effort */ }
    }

    const client = new Client();

    return new Promise((resolve, reject) => {
      client.on("ready", () => {
        this.connections.set(machineId, {
          client,
          machine,
          connected: true,
          lastUsedAt: Date.now(),
          reconnectAttempts: 0,
        });
        resolve();
      });

      client.on("error", (err) => {
        const errMsg = formatError(err);
        const conn = this.connections.get(machineId);
        if (conn) {
          conn.connected = false;
          conn.lastError = errMsg;
        } else {
          this.connections.set(machineId, {
            client,
            machine,
            connected: false,
            lastUsedAt: Date.now(),
            reconnectAttempts: 0,
            lastError: errMsg,
          });
        }
        reject(err);
      });

      client.on("close", () => {
        const conn = this.connections.get(machineId);
        if (conn) conn.connected = false;
      });

      const connectConfig: Record<string, unknown> = {
        host: machine.host,
        port: machine.port,
        username: machine.username,
        keepaliveInterval: 30_000,
        keepaliveCountMax: 3,
        readyTimeout: 30_000,
      };

      if (machine.authMethod === "key" && machine.keyPath) {
        try {
          connectConfig.privateKey = readFileSync(machine.keyPath);
        } catch (err) {
          return reject(new Error(`Cannot read SSH key at ${machine.keyPath}: ${formatError(err)}`));
        }
      } else if (machine.authMethod === "agent") {
        const sock = process.env.SSH_AUTH_SOCK;
        if (!sock) {
          return reject(new Error("SSH_AUTH_SOCK not set — cannot use agent auth. Start ssh-agent or use key auth."));
        }
        connectConfig.agent = sock;
      } else if (machine.authMethod === "password" && machine.password) {
        connectConfig.password = machine.password;
      }

      client.connect(connectConfig);
    });
  }

  async exec(
    machineId: string,
    command: string,
    timeoutMs?: number,
    securityContext: SecurityExecutionContext = {},
  ): Promise<ExecResult> {
    this.securityManager?.assertCommandAllowed(command, { ...securityContext, machineId });

    if (machineId === "local") {
      if (this.dockerAvailable && this.dockerConfig) {
        return execDocker(command, this.dockerConfig, timeoutMs);
      }
      return this.execLocal(command, timeoutMs);
    }
    return this.execRemoteUnchecked(machineId, command);
  }

  private execLocal(command: string, timeoutMs = 300_000): Promise<ExecResult> {
    return new Promise((resolve) => {
      const normalizedCommand =
        process.platform === "win32"
          ? `chcp 65001>nul & ${command}`
          : command;
      cpExec(
        normalizedCommand,
        {
          encoding: "buffer",
          maxBuffer: 10 * 1024 * 1024,
          timeout: timeoutMs,
          shell: getLocalShell(),
          windowsHide: true,
        },
        (err, stdout, stderr) => {
        let exitCode = 0;
        if (err) {
          // err.code can be number (exit code), string (error code like ETIMEDOUT), or null (signal kill)
          if (typeof err.code === "number") {
            exitCode = err.code;
          } else if (err.signal) {
            // Process killed by signal — report as non-zero
            exitCode = 128 + (({ SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15, SIGKILL: 9 } as Record<string, number>)[err.signal] ?? 1);
          } else {
            exitCode = 1;
          }
        }
        resolve({
          stdout: decodeLocalShellOutput(stdout),
          stderr: decodeLocalShellOutput(stderr),
          exitCode,
        });
        },
      );
    });
  }

  async execBackground(
    machineId: string,
    command: string,
    logPath?: string,
    securityContext: SecurityExecutionContext = {},
  ): Promise<{ pid: number; logPath: string }> {
    this.securityManager?.assertCommandAllowed(command, { ...securityContext, machineId });

    const log = machineId === "local"
      ? createManagedLocalLogPath(logPath)
      : createManagedRemoteLogPath(logPath);
    const exitPath = getExitFilePath(log);
    const pathContext: SecurityExecutionContext = {
      ...securityContext,
      machineId,
      toolName: securityContext.toolName ?? "remote_exec_background",
      toolFamily: "filesystem",
      networkAccess: securityContext.networkAccess ?? machineId !== "local",
    };
    this.securityManager?.assertPathAllowed(log, "write", pathContext);
    this.securityManager?.assertPathAllowed(exitPath, "write", pathContext);

    if (machineId === "local") {
      return this.execBackgroundLocal(command, log);
    }

    // Remote: use nohup + & over SSH (SSH channels close cleanly)
    // PYTHONUNBUFFERED ensures Python flushes stdout immediately for live metric capture
    // Write exit code to .exit file so we can retrieve it later (can't use `wait` from a different shell)
    const wrappedCmd = [
      `mkdir -p ${shellQuote(posix.dirname(log))}`,
      `PYTHONUNBUFFERED=1 nohup sh -c ${shellQuote(buildBackgroundExitCommand(command, log, "linux"))} > ${shellQuote(log)} 2>&1 & echo $!`,
    ].join(" && ");
    const result = await this.execRemoteUnchecked(machineId, wrappedCmd);
    const pid = parseInt(result.stdout.trim().split("\n").pop() ?? "", 10);
    if (isNaN(pid)) {
      throw new Error(
        `Failed to get PID. stdout: ${result.stdout}, stderr: ${result.stderr}`,
      );
    }
    return { pid, logPath: log };
  }

  private execBackgroundLocal(
    command: string,
    logPath: string,
  ): Promise<{ pid: number; logPath: string }> {
    return new Promise((resolve, reject) => {
      let logFd: number | null = null;
      try {
        mkdirSync(dirname(logPath), { recursive: true });

        // Open the log file for writing
        logFd = openSync(logPath, "w");

        // Spawn detached with stdio redirected to log file
        // PYTHONUNBUFFERED ensures Python flushes stdout immediately for live metric capture
        const shell = getLocalShellCommand();
        const exitPath = getExitFilePath(logPath);
        const child = spawn(shell.command, [...shell.args, command], {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
          windowsHide: true,
        });

        const pid = child.pid;
        if (pid === undefined) {
          closeSync(logFd);
          reject(new Error("Failed to spawn background process"));
          return;
        }

        // Write .pid marker for recovery — if parent dies, recovery can check PID liveness
        const pidPath = exitPath.replace(/\.exit$/, ".pid");
        try {
          writeFileSync(pidPath, String(pid), "utf8");
        } catch {
          // best effort
        }

        child.once("exit", (code, signal) => {
          const exitCode = typeof code === "number"
            ? code
            : signal
              ? 1
              : 0;
          try {
            writeFileSync(exitPath, String(exitCode), "utf8");
          } catch {
            // best effort
          }
          // Clean up .pid marker now that .exit is written
          try {
            unlinkSync(pidPath);
          } catch {
            // best effort — .pid may already be gone
          }
        });

        // Fully detach — don't let Node wait for this child
        child.unref();
        closeSync(logFd);

        resolve({ pid, logPath });
      } catch (err) {
        if (logFd !== null) {
          try { closeSync(logFd); } catch { /* best effort */ }
        }
        reject(err);
      }
    });
  }

  async isProcessRunning(
    machineId: string,
    pid: number,
  ): Promise<boolean> {
    if (machineId === "local") {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }
    const result = await this.exec(
      machineId,
      `kill -0 ${pid} 2>/dev/null && echo "running" || echo "stopped"`,
    );
    return result.stdout.trim() === "running";
  }

  async tailFile(
    machineId: string,
    path: string,
    lines = 50,
    securityContext: SecurityExecutionContext = {},
  ): Promise<string> {
    const context = {
      ...securityContext,
      machineId,
      toolName: securityContext.toolName ?? "tail_file",
      toolFamily: securityContext.toolFamily ?? "filesystem",
      networkAccess: securityContext.networkAccess ?? machineId !== "local",
    };
    this.securityManager?.assertPathAllowed(path, "read", context);

    if (machineId === "local") {
      const content = await readFile(path, "utf8");
      return content.split(/\r?\n/).slice(-lines).join("\n");
    }
    const result = await this.exec(machineId, `tail -n ${lines} ${shellQuote(path)}`, undefined, context);
    return result.stdout;
  }

  async readBackgroundExitCode(
    machineId: string,
    logPath: string,
    securityContext: SecurityExecutionContext = {},
  ): Promise<number | null> {
    const exitPath = getExitFilePath(logPath);
    const context = {
      ...securityContext,
      machineId,
      toolName: securityContext.toolName ?? "read_background_exit_code",
      toolFamily: securityContext.toolFamily ?? "filesystem",
      networkAccess: securityContext.networkAccess ?? machineId !== "local",
    };
    this.securityManager?.assertPathAllowed(exitPath, "read", context);

    if (machineId === "local") {
      try {
        const value = await readFile(exitPath, "utf8");
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isNaN(parsed) ? null : parsed;
      } catch {
        // .exit 파일이 없으면 .pid 파일로 프로세스 liveness 확인
        const pidPath = exitPath.replace(/\.exit$/, ".pid");
        try {
          const pidValue = await readFile(pidPath, "utf8");
          const pid = Number.parseInt(pidValue.trim(), 10);
          if (!Number.isNaN(pid)) {
            try {
              process.kill(pid, 0); // liveness check — 프로세스가 아직 살아있음
              return null;          // 아직 실행 중이므로 exit code 없음
            } catch {
              // 프로세스는 죽었지만 .exit를 남기지 못한 경우 (parent crash)
              // crash 상태를 기록하고 exit code 1을 합성
              try {
                writeFileSync(exitPath, "1", "utf8");
                unlinkSync(pidPath);
              } catch { /* best effort */ }
              return 1;
            }
          }
        } catch {
          // .pid도 없음 — 완전히 정보 없음
        }
        return null;
      }
    }

    const pidPath = exitPath.replace(/\.exit$/, ".pid");
    const exitResult = await this.exec(
      machineId,
      `[ -f ${shellQuote(exitPath)} ] && cat ${shellQuote(exitPath)} || echo "__NO_EXIT__"`,
      undefined,
      context,
    );
    const exitValue = exitResult.stdout.trim();
    const parsedExit = Number.parseInt(exitValue, 10);
    if (!Number.isNaN(parsedExit)) {
      return parsedExit;
    }

    if (exitValue !== "" && exitValue !== "__NO_EXIT__") {
      return null;
    }

    const pidResult = await this.exec(
      machineId,
      `[ -f ${shellQuote(pidPath)} ] && cat ${shellQuote(pidPath)} || echo "__NO_PID__"`,
      undefined,
      context,
    );
    const pidValue = pidResult.stdout.trim();
    const pid = Number.parseInt(pidValue, 10);
    if (Number.isNaN(pid)) {
      return null;
    }

    const liveness = await this.exec(
      machineId,
      `kill -0 ${pid} 2>/dev/null && echo "ALIVE" || echo "DEAD"`,
      undefined,
      context,
    );
    if (liveness.stdout.trim() === "ALIVE") {
      return null;
    }

    try {
      await this.exec(
        machineId,
        `printf '1' > ${shellQuote(exitPath)}; rm -f ${shellQuote(pidPath)}`,
        undefined,
        context,
      );
    } catch {
      // best effort
    }
    return 1;
  }

  getStatus(machineId: string): ConnectionStatus {
    const conn = this.connections.get(machineId);
    return {
      machineId,
      connected: conn?.connected ?? false,
      lastConnectedAt: conn?.lastUsedAt,
      error: conn?.lastError,
    };
  }

  getAllStatuses(): ConnectionStatus[] {
    return Array.from(this.machines.keys()).map((id) =>
      this.getStatus(id),
    );
  }

  getMachineIds(): string[] {
    return Array.from(this.machines.keys());
  }

  disconnect(machineId: string): void {
    if (machineId === "local") return;
    const conn = this.connections.get(machineId);
    if (conn) {
      conn.client?.end();
      this.connections.delete(machineId);
    }
  }

  disconnectAll(): void {
    for (const [id] of this.connections) {
      if (id !== "local") this.disconnect(id);
    }
  }

  private async getConnection(
    machineId: string,
  ): Promise<PooledConnection> {
    let conn = this.connections.get(machineId);
    if (!conn?.connected) {
      await this.connect(machineId);
      conn = this.connections.get(machineId);
    }
    if (!conn?.connected) {
      throw new Error(`Cannot connect to ${machineId}`);
    }
    return conn;
  }

  private async execRemoteUnchecked(machineId: string, command: string): Promise<ExecResult> {
    const conn = await this.getConnection(machineId);
    conn.lastUsedAt = Date.now();

    return new Promise((resolve, reject) => {
      conn.client!.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = "";
        let stderr = "";

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on("error", (streamErr: Error) => {
          reject(streamErr);
        });
        stream.on("close", (code: number) => {
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        });
      });
    });
  }
}
