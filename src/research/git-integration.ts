import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import type { AuditEvent } from "./contracts.js";

const execFileAsync = promisify(execFile);

export interface GitDiffResult {
  changedFiles: string[];
  additions: number;
  deletions: number;
  raw: string;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitStatusResult {
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  isClean: boolean;
}

export interface PRRequest {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  proposalId: string;
  changedPaths: string[];
}

export interface PRResult {
  success: boolean;
  branchCreated: boolean;
  commitHash?: string;
  message: string;
}

export interface GitHookConfig {
  events: ("post-commit" | "pre-push")[];
  autoCreateProposal: boolean;
  ignorePaths: string[];
}

export class GitIntegration {
  private repoPath: string;

  constructor(repoPath?: string) {
    this.repoPath = repoPath ?? process.cwd();
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.exec(["rev-parse", "--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await this.exec(["symbolic-ref", "--quiet", "--short", "HEAD"]);
      const branch = stdout.trim();
      if (branch) return branch;
    } catch {
      // Fall back for detached HEADs and older git setups.
    }

    const { stdout } = await this.exec(["rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  }

  async getStatus(): Promise<GitStatusResult> {
    const branch = await this.getCurrentBranch();
    const { stdout } = await this.exec(["status", "--porcelain"]);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of stdout.split("\n").filter(Boolean)) {
      const x = line[0];
      const y = line[1];
      const file = line.slice(3);

      if (x === "?" && y === "?") {
        untracked.push(file);
      } else if (x !== " " && x !== "?") {
        staged.push(file);
      }
      if (y !== " " && y !== "?") {
        modified.push(file);
      }
    }

    return {
      branch,
      staged,
      modified,
      untracked,
      isClean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
    };
  }

  async getDiff(base?: string, head?: string): Promise<GitDiffResult> {
    const diffRange = base && head ? [`${base}..${head}`] : base ? [base] : [];

    const { stdout: nameOnly } = await this.exec(["diff", "--name-only", ...diffRange]);
    const { stdout: statOutput } = await this.exec(["diff", "--shortstat", ...diffRange]);

    const changedFiles = nameOnly.trim().split("\n").filter(Boolean);

    let additions = 0;
    let deletions = 0;
    const addMatch = statOutput.match(/(\d+) insertion/);
    const delMatch = statOutput.match(/(\d+) deletion/);
    if (addMatch) additions = parseInt(addMatch[1], 10);
    if (delMatch) deletions = parseInt(delMatch[1], 10);

    return { changedFiles, additions, deletions, raw: nameOnly };
  }

  async getRecentCommits(count: number = 10): Promise<GitCommitInfo[]> {
    const { stdout } = await this.exec([
      "log",
      `--max-count=${count}`,
      "--format=%H|%h|%an|%ai|%s",
    ]);

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, author, date, ...msgParts] = line.split("|");
        return {
          hash,
          shortHash,
          author,
          date,
          message: msgParts.join("|"),
        };
      });
  }

  async getLastCommitFiles(): Promise<string[]> {
    const { stdout } = await this.exec(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    return stdout.trim().split("\n").filter(Boolean);
  }

  async createProposalBranch(proposalId: string): Promise<string> {
    const sanitized = proposalId.replace(/[^a-z0-9_-]/gi, "-");
    const branchName = `athena/proposal-${sanitized}`;
    await this.exec(["checkout", "-b", branchName]);
    return branchName;
  }

  async commitChanges(message: string, paths?: string[]): Promise<string> {
    if (paths && paths.length > 0) {
      await this.exec(["add", ...paths]);
    } else {
      await this.exec(["add", "-A"]);
    }
    const { stdout } = await this.exec(["commit", "-m", message]);
    const hashMatch = stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    return hashMatch ? hashMatch[1] : "";
  }

  async checkoutBranch(branch: string): Promise<void> {
    await this.exec(["checkout", branch]);
  }

  async preparePR(request: PRRequest): Promise<PRResult> {
    let originalBranch: string | undefined;
    let branchCreated = false;

    try {
      originalBranch = await this.getCurrentBranch();
      const prBranch = await this.createProposalBranch(request.proposalId);
      branchCreated = true;
      const commitHash = await this.commitChanges(
        `[Athena] ${request.title}\n\nProposal: ${request.proposalId}\n${request.body}`,
        request.changedPaths,
      );

      await this.checkoutBranch(originalBranch);

      return {
        success: true,
        branchCreated: true,
        commitHash,
        message: `PR branch '${prBranch}' created with commit ${commitHash}. Push and create PR on your platform.`,
      };
    } catch (err) {
      let restoreMessage = "";
      if (branchCreated && originalBranch) {
        try {
          await this.checkoutBranch(originalBranch);
          restoreMessage = ` Original branch '${originalBranch}' restored.`;
        } catch (restoreErr) {
          restoreMessage = ` Failed to restore original branch '${originalBranch}': ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}.`;
        }
      }

      return {
        success: false,
        branchCreated,
        message: `PR preparation failed: ${err instanceof Error ? err.message : String(err)}.${restoreMessage}`,
      };
    }
  }

  async installHooks(config: GitHookConfig): Promise<{ installed: string[]; errors: string[] }> {
    const installed: string[] = [];
    const errors: string[] = [];
    const hooksDir = path.join(this.repoPath, ".git", "hooks");

    if (!fs.existsSync(hooksDir)) {
      errors.push(".git/hooks directory not found");
      return { installed, errors };
    }

    for (const event of config.events) {
      const hookPath = path.join(hooksDir, event);
      const hookScript = this.buildHookScript(event, config);

      try {
        if (fs.existsSync(hookPath)) {
          const existing = fs.readFileSync(hookPath, "utf-8");
          if (!existing.includes("# ATHENA-HOOK")) {
            fs.writeFileSync(`${hookPath}.athena-backup`, existing);
          }
        }
        fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
        installed.push(event);
      } catch (err) {
        errors.push(`${event}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { installed, errors };
  }

  async uninstallHooks(): Promise<string[]> {
    const removed: string[] = [];
    const hooksDir = path.join(this.repoPath, ".git", "hooks");
    const hookNames = ["post-commit", "pre-push"];

    for (const name of hookNames) {
      const hookPath = path.join(hooksDir, name);
      if (!fs.existsSync(hookPath)) continue;

      const content = fs.readFileSync(hookPath, "utf-8");
      if (content.includes("# ATHENA-HOOK")) {
        const backupPath = `${hookPath}.athena-backup`;
        if (fs.existsSync(backupPath)) {
          fs.renameSync(backupPath, hookPath);
        } else {
          fs.unlinkSync(hookPath);
        }
        removed.push(name);
      }
    }

    return removed;
  }

  async detectPostCommitChanges(ignorePaths: string[] = []): Promise<{
    changedFiles: string[];
    commitInfo: GitCommitInfo;
    auditEvent: AuditEvent;
  } | null> {
    const commits = await this.getRecentCommits(1);
    if (commits.length === 0) return null;

    const commitInfo = commits[0];
    const files = await this.getLastCommitFiles();

    const changedFiles = files.filter((file) =>
      !ignorePaths.some((pattern) => {
        if (pattern.endsWith("/**")) {
          return file.startsWith(pattern.slice(0, -3));
        }
        return file === pattern;
      }),
    );

    if (changedFiles.length === 0) return null;

    return {
      changedFiles,
      commitInfo,
      auditEvent: {
        eventId: `aud_git_${Date.now()}`,
        eventType: "git_commit_detected",
        details: {
          commitHash: commitInfo.hash,
          author: commitInfo.author,
          message: commitInfo.message,
          fileCount: changedFiles.length,
          files: changedFiles.slice(0, 20),
        },
        severity: "info",
        timestamp: Date.now(),
      },
    };
  }

  private async exec(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, {
      cwd: this.repoPath,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 10,
    });
  }

  private buildHookScript(event: string, config: GitHookConfig): string {
    const ignoreJson = JSON.stringify(config.ignorePaths);
    return [
      "#!/bin/sh",
      "# ATHENA-HOOK ??auto-generated, do not edit manually",
      `# Event: ${event}`,
      `# Installed: ${new Date().toISOString()}`,
      "",
      "# Notify Athena of git changes",
      "if command -v athena >/dev/null 2>&1; then",
      `  athena research git-notify --event ${event} --ignore '${ignoreJson}' &`,
      "fi",
      "",
    ].join("\n");
  }
}
