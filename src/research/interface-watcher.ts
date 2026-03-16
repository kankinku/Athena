/**
 * interface-watcher.ts
 *
 * @experimental - Conditional feature
 * 코어 루프의 기본 경로가 아니다. contract 변경 감시를 코어 루프에
 * 통합하는 시점에만 Conditional에서 Core로 승격할 수 있다.
 *
 * 실행 단계에서 public interface 파일의 계약 범위 밖 변경을 감시한다.
 * 변경 감지 시:
 *  1. 해당 태스크 중단 신호 발생
 *  2. AuditEvent 기록
 *  3. remeeting 상태 전환 트리거
 *
 * spec §10 REQ-029: 실행 중 인터페이스 변경 감시
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AuditEvent, InterfaceContract } from "./contracts.js";
import { InterfaceContractStore } from "./interface-contract-store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InterfaceViolation {
  contractId: string;
  moduleId: string;
  sourceFile: string;
  detectedAt: number;
  reason: string;
}

export interface WatcherCallbacks {
  /** 계약 위반 감지 시 호출 — task 중단 등 후속 처리 */
  onViolation: (violation: InterfaceViolation) => void;
  /** AuditEvent 기록 */
  onAuditEvent?: (event: AuditEvent) => void;
  /** remeeting 트리거 */
  onRemeetingRequired?: (proposalId: string, reason: string) => void;
}

// ─── InterfaceWatcher ─────────────────────────────────────────────────────────

export class InterfaceWatcher {
  private contractStore: InterfaceContractStore;
  private watchers: fs.FSWatcher[] = [];
  private callbacks: WatcherCallbacks;
  private proposalId: string;
  private watchedFiles = new Map<string, InterfaceContract>();
  private violations: InterfaceViolation[] = [];
  private running = false;

  constructor(
    proposalId: string,
    callbacks: WatcherCallbacks,
    contractStore?: InterfaceContractStore,
  ) {
    this.proposalId = proposalId;
    this.callbacks = callbacks;
    this.contractStore = contractStore ?? new InterfaceContractStore();
  }

  /**
   * 지정된 모듈들의 public interface 파일을 감시 시작한다.
   * @param moduleIds 실행에 참여하는 모듈 ID 목록
   * @param projectRoot 프로젝트 루트 경로
   */
  start(moduleIds: string[], projectRoot: string): void {
    if (this.running) return;
    this.running = true;

    // 참여 모듈의 모든 인터페이스 계약 수집
    for (const modId of moduleIds) {
      const contracts = this.contractStore.listByModule(modId);
      for (const contract of contracts) {
        const absPath = path.resolve(projectRoot, contract.sourceFile);
        this.watchedFiles.set(absPath, contract);
      }
    }

    // 각 파일에 대해 fs.watch 설정
    for (const [absPath, contract] of this.watchedFiles) {
      if (!fs.existsSync(absPath)) continue;

      try {
        const watcher = fs.watch(absPath, (eventType) => {
          if (eventType === "change" || eventType === "rename") {
            this.handleFileChange(absPath, contract);
          }
        });
        this.watchers.push(watcher);
      } catch {
        // watch 실패 시 무시 (파일 삭제 등)
      }
    }
  }

  /**
   * 감시를 중지하고 모든 watcher를 정리한다.
   */
  stop(): void {
    this.running = false;
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    this.watchedFiles.clear();
  }

  /**
   * 현재까지 감지된 위반 목록을 반환한다.
   */
  getViolations(): InterfaceViolation[] {
    return [...this.violations];
  }

  /**
   * 감시 중인지 여부.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private handleFileChange(absPath: string, contract: InterfaceContract): void {
    const violation: InterfaceViolation = {
      contractId: contract.contractId,
      moduleId: contract.moduleId,
      sourceFile: contract.sourceFile,
      detectedAt: Date.now(),
      reason: `Public interface file '${contract.sourceFile}' (${contract.interfaceName}) was modified during execution`,
    };

    this.violations.push(violation);

    // 1. 위반 콜백 호출 (task 중단 신호)
    this.callbacks.onViolation(violation);

    // 2. AuditEvent 기록
    if (this.callbacks.onAuditEvent) {
      const auditEvent: AuditEvent = {
        eventId: `aud_iw_${Date.now()}`,
        eventType: "interface_violation_during_execution",
        proposalId: this.proposalId,
        moduleId: contract.moduleId,
        details: {
          contractId: contract.contractId,
          interfaceName: contract.interfaceName,
          sourceFile: contract.sourceFile,
          breakingChangeRisk: contract.breakingChangeRisk,
        },
        severity: contract.breakingChangeRisk === "high" ? "critical" : "warning",
        timestamp: Date.now(),
      };
      this.callbacks.onAuditEvent(auditEvent);
    }

    // 3. remeeting 트리거
    if (this.callbacks.onRemeetingRequired) {
      this.callbacks.onRemeetingRequired(
        this.proposalId,
        `Interface contract violated: ${contract.interfaceName} in ${contract.sourceFile}`,
      );
    }
  }
}
