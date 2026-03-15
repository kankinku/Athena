/**
 * git-integration.ts
 *
 * Git 통합 모듈:
 *  1. 로컬 Git 작업 래퍼 (diff, commit, branch, status)
 *  2. Git hook 기반 자동 변경 감시 → ChangeProposal 자동 생성
 *  3. PR(Pull Request) 생성 지원
 *
 * spec §5.2: Git diff 기반 자동 proposal 생성
 *       §5.3: Git hook 기반 변경 감시
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import type { AuditEvent } from "./contracts.js";

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

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
  /** hook이 감시할 이벤트: post-commit, pre-push */
  events: ("post-commit" | "pre-push")[];
  /** proposal 자동 생성 여부 */
  autoCreateProposal: boolean;
  /** 무시할 경로 패턴 */
  ignorePaths: string[];
}

// ─── GitIntegration ───────────────────────────────────────────────────────────

export class GitIntegration {
  private repoPath: string;

  constructor(repoPath?: string) {
    this.repoPath = repoPath ?? process.cwd();
  }

  // ─── 기본 Git 작업 ──────────────────────────────────────────────────────────

  /**
   * Git repo 여부 확인
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.exec(["rev-parse", "--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 현재 브랜치 이름
   */
  async getCurrentBranch(): Promise<string> {
    const { stdout } = await this.exec(["rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  }

  /**
   * Git status (staged, modified, untracked)
   */
  async getStatus(): Promise<GitStatusResult> {
    const branch = await this.getCurrentBranch();
    const { stdout } = await this.exec(["status", "--porcelain"]);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of stdout.split("\n").filter(Boolean)) {
      const x = line[0]; // index status
      const y = line[1]; // worktree status
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

  /**
   * Git diff (HEAD와의 차이, 또는 두 커밋 간 차이)
   */
  async getDiff(base?: string, head?: string): Promise<GitDiffResult> {
    const args = ["diff", "--stat", "--name-only"];
    if (base && head) {
      args.push(`${base}..${head}`);
    } else if (base) {
      args.push(base);
    }

    const { stdout: nameOnly } = await this.exec([
      "diff", "--name-only", ...(base && head ? [`${base}..${head}`] : base ? [base] : []),
    ]);

    const { stdout: statOutput } = await this.exec([
      "diff", "--shortstat", ...(base && head ? [`${base}..${head}`] : base ? [base] : []),
    ]);

    const changedFiles = nameOnly.trim().split("\n").filter(Boolean);

    // Parse additions/deletions from --shortstat
    let additions = 0;
    let deletions = 0;
    const addMatch = statOutput.match(/(\d+) insertion/);
    const delMatch = statOutput.match(/(\d+) deletion/);
    if (addMatch) additions = parseInt(addMatch[1], 10);
    if (delMatch) deletions = parseInt(delMatch[1], 10);

    return { changedFiles, additions, deletions, raw: nameOnly };
  }

  /**
   * 최근 커밋 목록
   */
  async getRecentCommits(count: number = 10): Promise<GitCommitInfo[]> {
    const { stdout } = await this.exec([
      "log", `--max-count=${count}`,
      "--format=%H|%h|%an|%ai|%s",
    ]);

    return stdout.trim().split("\n").filter(Boolean).map((line) => {
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

  /**
   * HEAD 커밋의 변경 파일 목록
   */
  async getLastCommitFiles(): Promise<string[]> {
    const { stdout } = await this.exec(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    return stdout.trim().split("\n").filter(Boolean);
  }

  // ─── 브랜치 관리 ────────────────────────────────────────────────────────────

  /**
   * proposal용 브랜치 생성
   */
  async createProposalBranch(proposalId: string): Promise<string> {
    const sanitized = proposalId.replace(/[^a-z0-9_-]/gi, "-");
    const branchName = `athena/proposal-${sanitized}`;
    await this.exec(["checkout", "-b", branchName]);
    return branchName;
  }

  /**
   * 변경사항 커밋
   */
  async commitChanges(message: string, paths?: string[]): Promise<string> {
    if (paths && paths.length > 0) {
      await this.exec(["add", ...paths]);
    } else {
      await this.exec(["add", "-A"]);
    }
    const { stdout } = await this.exec(["commit", "-m", message]);
    // Extract commit hash
    const hashMatch = stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    return hashMatch ? hashMatch[1] : "";
  }

  /**
   * 원래 브랜치로 복귀
   */
  async checkoutBranch(branch: string): Promise<void> {
    await this.exec(["checkout", branch]);
  }

  // ─── PR 생성 ────────────────────────────────────────────────────────────────

  /**
   * PR용 브랜치 생성 + 커밋 + 메타데이터 준비.
   * 실제 PR 생성은 외부 플랫폼 API(GitHub/GitLab)에 위임.
   */
  async preparePR(request: PRRequest): Promise<PRResult> {
    try {
      // 1. 현재 브랜치 저장
      const originalBranch = await this.getCurrentBranch();

      // 2. PR 브랜치 생성
      const prBranch = await this.createProposalBranch(request.proposalId);

      // 3. 변경사항 커밋
      const commitHash = await this.commitChanges(
        `[Athena] ${request.title}\n\nProposal: ${request.proposalId}\n${request.body}`,
        request.changedPaths,
      );

      // 4. 원래 브랜치 복귀
      await this.checkoutBranch(originalBranch);

      return {
        success: true,
        branchCreated: true,
        commitHash,
        message: `PR branch '${prBranch}' created with commit ${commitHash}. Push and create PR on your platform.`,
      };
    } catch (err) {
      return {
        success: false,
        branchCreated: false,
        message: `PR preparation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ─── Git Hook 관리 ──────────────────────────────────────────────────────────

  /**
   * Athena Git hook을 설치한다.
   * hook 스크립트: 커밋 후 athena에 변경 알림.
   */
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
        // 기존 hook이 있으면 백업
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

  /**
   * 설치된 Athena hook을 제거한다.
   */
  async uninstallHooks(): Promise<string[]> {
    const removed: string[] = [];
    const hooksDir = path.join(this.repoPath, ".git", "hooks");
    const hookNames = ["post-commit", "pre-push"];

    for (const name of hookNames) {
      const hookPath = path.join(hooksDir, name);
      if (!fs.existsSync(hookPath)) continue;

      const content = fs.readFileSync(hookPath, "utf-8");
      if (content.includes("# ATHENA-HOOK")) {
        // 백업이 있으면 복구
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

  /**
   * post-commit hook에서 호출: 마지막 커밋의 변경 감지 결과를 반환.
   * ChangeDetector.fromGitDiff()와 연동하여 자동 proposal 생성에 사용.
   */
  async detectPostCommitChanges(ignorePaths: string[] = []): Promise<{
    changedFiles: string[];
    commitInfo: GitCommitInfo;
    auditEvent: AuditEvent;
  } | null> {
    const commits = await this.getRecentCommits(1);
    if (commits.length === 0) return null;

    const commitInfo = commits[0];
    const files = await this.getLastCommitFiles();

    // 무시 경로 필터링
    const changedFiles = files.filter((f) =>
      !ignorePaths.some((pattern) => {
        if (pattern.endsWith("/**")) {
          return f.startsWith(pattern.slice(0, -3));
        }
        return f === pattern;
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

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async exec(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, {
      cwd: this.repoPath,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 10, // 10MB
    });
  }

  private buildHookScript(event: string, config: GitHookConfig): string {
    const ignoreJson = JSON.stringify(config.ignorePaths);
    return [
      "#!/bin/sh",
      "# ATHENA-HOOK — auto-generated, do not edit manually",
      `# Event: ${event}`,
      `# Installed: ${new Date().toISOString()}`,
      "",
      '# Notify Athena of git changes',
      'if command -v athena >/dev/null 2>&1; then',
      `  athena research git-notify --event ${event} --ignore '${ignoreJson}' &`,
      'fi',
      "",
    ].join("\n");
  }
}
