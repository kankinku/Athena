/**
 * budget-enforcer.ts
 *
 * TaskAssignment의 4종 예산(시간/반복/파일 수/비용)을 런타임에서 추적하고 강제한다.
 * 예산 초과 시 task를 policy_blocked 상태로 전환하고 AuditEvent를 기록한다.
 */

import { getDb } from "../store/database.js";
import { nanoid } from "nanoid";
import type { ExecutionBudget, AuditEvent } from "./contracts.js";
import { AuditEventStore } from "./audit-event-store.js";

export type BudgetExceedType = "time" | "retries" | "files" | "cost";

export interface BudgetCheckResult {
  exceeded: boolean;
  exceedTypes: BudgetExceedType[];
  details: {
    elapsedMinutes: number;
    retriesUsed: number;
    filesChanged: number;
    costUsd: number;
    maxWallClockMinutes: number;
    maxRetries: number;
    maxFilesChanged: number;
    maxCostUsd: number;
  };
}

interface BudgetRow {
  task_id: string;
  proposal_id: string;
  module_id: string;
  agent_id: string;
  max_wall_clock_minutes: number;
  max_retries: number;
  max_files_changed: number;
  max_cost_usd: number;
  elapsed_minutes: number;
  retries_used: number;
  files_changed: number;
  cost_usd: number;
  files_changed_list_json: string;
  status: string;
  started_at: number;
  updated_at: number;
  exceeded_at: number | null;
}

export class BudgetEnforcer {
  private auditStore: AuditEventStore;

  constructor(deps?: { auditStore?: AuditEventStore }) {
    this.auditStore = deps?.auditStore ?? new AuditEventStore();
  }

  /**
   * 새 task의 예산 추적을 시작한다.
   */
  startTracking(
    taskId: string,
    proposalId: string,
    moduleId: string,
    agentId: string,
    budget: ExecutionBudget,
  ): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO budget_tracking (
         task_id, proposal_id, module_id, agent_id,
         max_wall_clock_minutes, max_retries, max_files_changed, max_cost_usd,
         started_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      taskId,
      proposalId,
      moduleId,
      agentId,
      budget.maxWallClockMinutes,
      budget.maxRetries,
      budget.maxFilesChanged,
      budget.maxCostUsd,
      now,
      now,
    );
  }

  /**
   * 파일 변경을 기록하고 예산을 검사한다.
   */
  recordFileChange(taskId: string, filePath: string): BudgetCheckResult {
    const db = getDb();
    const row = this.getRow(taskId);
    if (!row) throw new Error(`Budget tracking not found: ${taskId}`);

    const files: string[] = JSON.parse(row.files_changed_list_json);
    if (!files.includes(filePath)) {
      files.push(filePath);
      db.prepare(
        `UPDATE budget_tracking
         SET files_changed = ?, files_changed_list_json = ?, updated_at = ?
         WHERE task_id = ?`,
      ).run(files.length, JSON.stringify(files), Date.now(), taskId);
    }

    return this.checkBudget(taskId);
  }

  /**
   * 재시도를 기록한다.
   */
  recordRetry(taskId: string): BudgetCheckResult {
    const db = getDb();
    db.prepare(
      `UPDATE budget_tracking
       SET retries_used = retries_used + 1, updated_at = ?
       WHERE task_id = ?`,
    ).run(Date.now(), taskId);

    return this.checkBudget(taskId);
  }

  /**
   * 비용을 기록한다.
   */
  recordCost(taskId: string, usd: number): BudgetCheckResult {
    const db = getDb();
    db.prepare(
      `UPDATE budget_tracking
       SET cost_usd = cost_usd + ?, updated_at = ?
       WHERE task_id = ?`,
    ).run(usd, Date.now(), taskId);

    return this.checkBudget(taskId);
  }

  /**
   * 현재 예산 사용량을 검사한다.
   */
  checkBudget(taskId: string): BudgetCheckResult {
    const row = this.getRow(taskId);
    if (!row) throw new Error(`Budget tracking not found: ${taskId}`);

    const elapsedMinutes = (Date.now() - row.started_at) / 60000;
    const exceedTypes: BudgetExceedType[] = [];

    if (elapsedMinutes > row.max_wall_clock_minutes) exceedTypes.push("time");
    if (row.retries_used > row.max_retries) exceedTypes.push("retries");
    if (row.files_changed > row.max_files_changed) exceedTypes.push("files");
    if (row.cost_usd > row.max_cost_usd) exceedTypes.push("cost");

    return {
      exceeded: exceedTypes.length > 0,
      exceedTypes,
      details: {
        elapsedMinutes,
        retriesUsed: row.retries_used,
        filesChanged: row.files_changed,
        costUsd: row.cost_usd,
        maxWallClockMinutes: row.max_wall_clock_minutes,
        maxRetries: row.max_retries,
        maxFilesChanged: row.max_files_changed,
        maxCostUsd: row.max_cost_usd,
      },
    };
  }

  /**
   * 예산 초과 시 task를 차단하고 감사 이벤트를 기록한다.
   * @returns true if budget was exceeded and task was blocked
   */
  enforceBudget(taskId: string, proposalId: string): boolean {
    const result = this.checkBudget(taskId);
    if (!result.exceeded) return false;

    const db = getDb();
    const now = Date.now();

    db.prepare(
      `UPDATE budget_tracking
       SET status = 'exceeded', exceeded_at = ?, updated_at = ?
       WHERE task_id = ?`,
    ).run(now, now, taskId);

    const event: AuditEvent = {
      eventId: `evt_${nanoid(8)}`,
      eventType: "budget_exceeded",
      proposalId,
      details: {
        taskId,
        exceedTypes: result.exceedTypes,
        ...result.details,
      },
      severity: "warning",
      timestamp: now,
    };

    try {
      this.auditStore.save(event);
    } catch {
      // 감사 로그 실패가 예산 강제를 막지 않음
    }

    return true;
  }

  /**
   * 특정 proposal의 모든 budget 추적 현황을 조회한다.
   */
  listByProposal(proposalId: string): BudgetCheckResult[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM budget_tracking WHERE proposal_id = ?")
      .all(proposalId) as BudgetRow[];

    return rows.map((row) => {
      const elapsedMinutes = (Date.now() - row.started_at) / 60000;
      const exceedTypes: BudgetExceedType[] = [];
      if (elapsedMinutes > row.max_wall_clock_minutes) exceedTypes.push("time");
      if (row.retries_used > row.max_retries) exceedTypes.push("retries");
      if (row.files_changed > row.max_files_changed) exceedTypes.push("files");
      if (row.cost_usd > row.max_cost_usd) exceedTypes.push("cost");

      return {
        exceeded: exceedTypes.length > 0,
        exceedTypes,
        details: {
          elapsedMinutes,
          retriesUsed: row.retries_used,
          filesChanged: row.files_changed,
          costUsd: row.cost_usd,
          maxWallClockMinutes: row.max_wall_clock_minutes,
          maxRetries: row.max_retries,
          maxFilesChanged: row.max_files_changed,
          maxCostUsd: row.max_cost_usd,
        },
      };
    });
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private getRow(taskId: string): BudgetRow | null {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM budget_tracking WHERE task_id = ?")
      .get(taskId) as BudgetRow | undefined;
    return row ?? null;
  }
}
