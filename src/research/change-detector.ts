/**
 * change-detector.ts
 *
 * @experimental
 * 이 모듈은 코어 루프와 직접 통합되지 않은 legacy change-management 서브시스템이다.
 * change-pipeline.ts를 통해서만 활성화된다.
 *
 * 6종 변경 소스로부터 자동으로 ChangeProposal을 생성하는 통합 감지기:
 *   1. Git diff (commit/push 이후)
 *   2. 테스트 실패
 *   3. 성능 회귀
 *   4. 운영 경고 (에러 로그 패턴)
 *   5. 에이전트 내부 제안
 *   6. 수동 CLI (기존)
 *
 * 중복 제안 방지: 동일 changedPaths + 동일 source의 draft 제안이 이미 존재하면 스킵.
 */

import { ChangeProposalStore, type ChangeProposalRecord } from "./change-proposal-store.js";
import { AuditEventStore } from "./audit-event-store.js";
import { nanoid } from "nanoid";
import type { AuditEvent } from "./contracts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeSource =
  | "git-diff"
  | "test-failure"
  | "performance-regression"
  | "ops-alert"
  | "agent-suggestion"
  | "manual";

export interface DetectedChange {
  source: ChangeSource;
  title: string;
  summary: string;
  changedPaths: string[];
  details: Record<string, unknown>;
}

export interface ChangeDetectorDeps {
  proposalStore?: ChangeProposalStore;
  auditStore?: AuditEventStore;
}

// ─── ChangeDetector ───────────────────────────────────────────────────────────

export class ChangeDetector {
  private proposalStore: ChangeProposalStore;
  private auditStore: AuditEventStore;

  constructor(deps?: ChangeDetectorDeps) {
    this.proposalStore = deps?.proposalStore ?? new ChangeProposalStore();
    this.auditStore = deps?.auditStore ?? new AuditEventStore();
  }

  /**
   * 감지된 변경으로부터 ChangeProposal을 자동 생성한다.
   * 중복이면 null을 반환한다.
   */
  createProposalFromChange(
    sessionId: string,
    change: DetectedChange,
  ): ChangeProposalRecord | null {
    // 중복 검사: 동일 source + 동일 paths의 draft 제안이 이미 있으면 스킵
    if (this.isDuplicate(sessionId, change)) {
      return null;
    }

    const proposal = this.proposalStore.create(sessionId, {
      title: change.title,
      summary: change.summary,
      changedPaths: change.changedPaths,
      createdBy: `auto:${change.source}`,
    });

    this.auditAutoDetection(change, proposal.proposalId);
    return proposal;
  }

  /**
   * Git diff 출력으로부터 변경을 감지한다.
   * @param diffOutput `git diff --name-only` 출력
   */
  fromGitDiff(diffOutput: string): DetectedChange | null {
    const lines = diffOutput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return null;

    return {
      source: "git-diff",
      title: `Git: ${lines.length}개 파일 변경 감지`,
      summary: `Git commit으로 ${lines.length}개 파일이 변경되었습니다.`,
      changedPaths: lines,
      details: { fileCount: lines.length },
    };
  }

  /**
   * 테스트 실패 출력으로부터 변경을 감지한다.
   * @param failedTests 실패한 테스트 파일 목록
   * @param errorOutput 에러 출력 (선택)
   */
  fromTestFailure(
    failedTests: string[],
    errorOutput?: string,
  ): DetectedChange | null {
    if (failedTests.length === 0) return null;

    return {
      source: "test-failure",
      title: `테스트 실패: ${failedTests.length}개 테스트`,
      summary: `${failedTests.join(", ")} 테스트가 실패했습니다.${errorOutput ? ` 오류: ${errorOutput.slice(0, 200)}` : ""}`,
      changedPaths: failedTests,
      details: {
        testCount: failedTests.length,
        errorSnippet: errorOutput?.slice(0, 500),
      },
    };
  }

  /**
   * 성능 회귀 메트릭으로부터 변경을 감지한다.
   */
  fromPerformanceRegression(
    metric: string,
    currentValue: number,
    threshold: number,
    affectedPaths: string[],
  ): DetectedChange | null {
    if (currentValue <= threshold) return null;

    return {
      source: "performance-regression",
      title: `성능 회귀: ${metric} (${currentValue} > ${threshold})`,
      summary: `${metric} 메트릭이 임계치 ${threshold}를 초과했습니다 (현재: ${currentValue}).`,
      changedPaths: affectedPaths,
      details: { metric, currentValue, threshold },
    };
  }

  /**
   * 운영 경고(에러 로그 패턴)로부터 변경을 감지한다.
   */
  fromOpsAlert(
    alertType: string,
    message: string,
    affectedPaths: string[],
  ): DetectedChange | null {
    if (affectedPaths.length === 0) return null;

    return {
      source: "ops-alert",
      title: `운영 경고: ${alertType}`,
      summary: message.slice(0, 300),
      changedPaths: affectedPaths,
      details: { alertType },
    };
  }

  /**
   * 에이전트 내부 제안으로부터 변경을 감지한다.
   */
  fromAgentSuggestion(
    agentId: string,
    title: string,
    summary: string,
    targetPaths: string[],
  ): DetectedChange | null {
    if (targetPaths.length === 0) return null;

    return {
      source: "agent-suggestion",
      title,
      summary,
      changedPaths: targetPaths,
      details: { agentId },
    };
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private isDuplicate(sessionId: string, change: DetectedChange): boolean {
    const existing = this.proposalStore.list({ sessionId });
    return existing.some((p) => {
      if (p.status !== "draft") return false;
      if (!p.createdBy.startsWith(`auto:${change.source}`)) return false;
      // 동일 paths 세트인지 비교
      const existingPaths = new Set(p.changedPaths);
      const newPaths = new Set(change.changedPaths);
      if (existingPaths.size !== newPaths.size) return false;
      for (const path of newPaths) {
        if (!existingPaths.has(path)) return false;
      }
      return true;
    });
  }

  private auditAutoDetection(change: DetectedChange, proposalId: string): void {
    const event: AuditEvent = {
      eventId: `evt_${nanoid(8)}`,
      eventType: "auto_change_detected",
      proposalId,
      details: {
        source: change.source,
        pathCount: change.changedPaths.length,
        ...change.details,
      },
      severity: "info",
      timestamp: Date.now(),
    };

    try {
      this.auditStore.save(event);
    } catch {
      // 감사 로그 실패가 감지를 막지 않음
    }
  }
}
