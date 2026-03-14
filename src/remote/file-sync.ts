import { execFile as execFileCb } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";
import type { RemoteMachine } from "./types.js";
import { commandExists } from "./local-runtime.js";
import type { SecurityExecutionContext, SecurityManager } from "../security/policy.js";

const execFileAsync = promisify(execFileCb);

export async function resolveFileSyncTransport(
  platform = process.platform,
  exists: (command: string, platform?: NodeJS.Platform) => Promise<boolean> = commandExists,
): Promise<"rsync" | "scp"> {
  if (await exists("rsync", platform)) {
    return "rsync";
  }
  if (platform === "win32" && await exists("scp", platform)) {
    return "scp";
  }
  if (platform === "win32") {
    throw new Error(
      "Remote sync requires `rsync`, or `scp` via the Windows OpenSSH client when rsync is unavailable.",
    );
  }
  throw new Error("Remote sync requires `rsync` on this platform.");
}

/**
 * File sync via rsync/SCP over SSH.
 */
export class FileSync {
  private machines = new Map<string, RemoteMachine>();

  constructor(private securityManager?: SecurityManager) {}

  addMachine(machine: RemoteMachine): void {
    this.machines.set(machine.id, machine);
  }

  /**
   * Upload local files to remote machine using rsync.
   */
  async upload(
    machineId: string,
    localPath: string,
    remotePath: string,
    securityContext: SecurityExecutionContext = {},
  ): Promise<void> {
    const context = this.resolveSecurityContext(securityContext, machineId, "remote_upload");
    this.securityManager?.assertPathAllowed(localPath, "read", context);
    this.securityManager?.assertPathAllowed(remotePath, "write", context);

    const machine = this.getMachine(machineId);
    const transport = await resolveFileSyncTransport();
    this.securityManager?.assertCommandAllowed(transport, context);
    const remote = `${machine.username}@${machine.host}:${remotePath}`;

    if (transport === "rsync") {
      await execFileAsync(
        "rsync",
        ["-avz", "-e", this.buildRsyncSshCommand(machine), localPath, remote],
        { windowsHide: true },
      );
      return;
    }

    const recursive = statSync(localPath).isDirectory();
    await execFileAsync(
      "scp",
      [...this.buildScpArgs(machine), ...(recursive ? ["-r"] : []), localPath, remote],
      { windowsHide: true },
    );
  }

  /**
   * Download remote files to local machine using rsync.
   */
  async download(
    machineId: string,
    remotePath: string,
    localPath: string,
    securityContext: SecurityExecutionContext = {},
  ): Promise<void> {
    const context = this.resolveSecurityContext(securityContext, machineId, "remote_download");
    this.securityManager?.assertPathAllowed(remotePath, "read", context);
    this.securityManager?.assertPathAllowed(localPath, "write", context);

    const machine = this.getMachine(machineId);
    const transport = await resolveFileSyncTransport();
    this.securityManager?.assertCommandAllowed(transport, context);
    const remote = `${machine.username}@${machine.host}:${remotePath}`;

    if (transport === "rsync") {
      await execFileAsync(
        "rsync",
        ["-avz", "-e", this.buildRsyncSshCommand(machine), remote, localPath],
        { windowsHide: true },
      );
      return;
    }

    await execFileAsync(
      "scp",
      [...this.buildScpArgs(machine), "-r", remote, localPath],
      { windowsHide: true },
    );
  }

  private getMachine(id: string): RemoteMachine {
    const machine = this.machines.get(id);
    if (!machine) throw new Error(`Unknown machine: ${id}`);
    return machine;
  }

  private resolveSecurityContext(
    securityContext: SecurityExecutionContext,
    machineId: string,
    defaultToolName: "remote_upload" | "remote_download",
  ): SecurityExecutionContext {
    return {
      ...securityContext,
      machineId,
      toolName: securityContext.toolName ?? defaultToolName,
      toolFamily: securityContext.toolFamily ?? "remote-sync",
      networkAccess: securityContext.networkAccess ?? true,
      destructive: securityContext.destructive ?? true,
    };
  }

  private buildRsyncSshCommand(machine: RemoteMachine): string {
    const args: string[] = ["ssh", `-p ${machine.port}`];
    if (machine.authMethod === "key" && machine.keyPath) {
      args.push(`-i ${machine.keyPath}`);
    }
    return args.join(" ");
  }

  private buildScpArgs(machine: RemoteMachine): string[] {
    const args = ["-P", String(machine.port)];
    if (machine.authMethod === "key" && machine.keyPath) {
      args.push("-i", machine.keyPath);
    }
    return args;
  }
}
