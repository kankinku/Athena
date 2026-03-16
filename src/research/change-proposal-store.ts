/**
 * change-proposal-store.ts
 *
 * @experimental
 * 이 모듈은 코어 루프와 직접 통합되지 않은 legacy change-management 서브시스템이다.
 * 코어 루프의 ProposalStore(proposal-store.ts)와 혼용하지 않는다.
 *
 * 연구(research) proposal과 코드 변경(change) proposal을 명확히 분리하는 저장소.
 *
 * 분리 원칙:
 * - 기존 ProposalStore는 ML 연구 제안용 (proposal_briefs.status = "candidate" 등)
 * - ChangeProposalStore는 코드 변경 제안용 (proposal_briefs.change_workflow_state != "draft" or created_by != "user")
 * - 같은 proposal_briefs 테이블을 사용하되 change_workflow_state 컬럼으로 구분
 * - 이를 통해 기존 데이터와 신규 데이터가 공존 가능
 */

import { nanoid } from "nanoid";
import { getDb } from "../store/database.js";
import type {
  AffectedModuleRecord,
  ChangeProposalStatus,
  ChangeWorkflowState,
} from "./contracts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChangeProposalRecord {
  proposalId: string;
  sessionId: string;
  title: string;
  summary: string;
  requestedChange: string;
  changedPaths: string[];
  expectedEffect: string;
  riskAssumptions: string[];
  targetModules: string[];
  createdBy: string;

  // 영향도
  directlyAffectedModules: AffectedModuleRecord[];
  indirectlyAffectedModules: AffectedModuleRecord[];
  observerModules: AffectedModuleRecord[];
  requiredAgents: string[];
  meetingRequired: boolean;
  meetingRequiredReason?: string;

  // 연결
  meetingSessionId?: string;
  executionPlanId?: string;

  // 검증
  requiredTests: string[];
  rollbackConditions: string[];
  featureFlagRequired: boolean;
  featureFlagName?: string;

  // 상태
  status: ChangeProposalStatus;
  workflowState: ChangeWorkflowState;

  createdAt: number;
  updatedAt: number;
}

// ─── ChangeProposalStore ──────────────────────────────────────────────────────

export class ChangeProposalStore {

  /**
   * 새 change proposal을 생성한다.
   */
  create(
    sessionId: string,
    input: {
      title: string;
      summary?: string;
      requestedChange?: string;
      changedPaths?: string[];
      createdBy?: string;
    },
  ): ChangeProposalRecord {
    const proposalId = `cp_${nanoid(7)}`;
    const now = Date.now();

    const record: ChangeProposalRecord = {
      proposalId,
      sessionId,
      title: input.title,
      summary: input.summary ?? "",
      requestedChange: input.requestedChange ?? "",
      changedPaths: input.changedPaths ?? [],
      expectedEffect: "",
      riskAssumptions: [],
      targetModules: [],
      createdBy: input.createdBy ?? "user",
      directlyAffectedModules: [],
      indirectlyAffectedModules: [],
      observerModules: [],
      requiredAgents: [],
      meetingRequired: false,
      requiredTests: [],
      rollbackConditions: [],
      featureFlagRequired: false,
      status: "draft",
      workflowState: "draft",
      createdAt: now,
      updatedAt: now,
    };

    this.save(record);
    return record;
  }

  /**
   * change proposal을 저장 (upsert).
   * 기존 proposal_briefs 테이블의 payload_json + 새 컬럼 모두에 저장.
   */
  save(record: ChangeProposalRecord): ChangeProposalRecord {
    const db = getDb();
    const now = Date.now();

    // payload_json에 전체 record를 직렬화 (기존 패턴 유지)
    // 새 컬럼에도 개별 필드를 저장 (쿼리/필터 가능)
    db.prepare(
      `INSERT INTO proposal_briefs (
         id, session_id, title, status, payload_json,
         change_workflow_state, changed_paths_json,
         directly_affected_modules_json, indirectly_affected_modules_json, observer_modules_json,
         required_agents_json, meeting_required, meeting_session_id, execution_plan_id,
         required_tests_json, rollback_conditions_json,
         feature_flag_required, feature_flag_name, created_by,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         status = excluded.status,
         payload_json = excluded.payload_json,
         change_workflow_state = excluded.change_workflow_state,
         changed_paths_json = excluded.changed_paths_json,
         directly_affected_modules_json = excluded.directly_affected_modules_json,
         indirectly_affected_modules_json = excluded.indirectly_affected_modules_json,
         observer_modules_json = excluded.observer_modules_json,
         required_agents_json = excluded.required_agents_json,
         meeting_required = excluded.meeting_required,
         meeting_session_id = excluded.meeting_session_id,
         execution_plan_id = excluded.execution_plan_id,
         required_tests_json = excluded.required_tests_json,
         rollback_conditions_json = excluded.rollback_conditions_json,
         feature_flag_required = excluded.feature_flag_required,
         feature_flag_name = excluded.feature_flag_name,
         updated_at = excluded.updated_at`,
    ).run(
      record.proposalId,
      record.sessionId,
      record.title,
      record.status,
      JSON.stringify(record),
      record.workflowState,
      JSON.stringify(record.changedPaths),
      JSON.stringify(record.directlyAffectedModules),
      JSON.stringify(record.indirectlyAffectedModules),
      JSON.stringify(record.observerModules),
      JSON.stringify(record.requiredAgents),
      record.meetingRequired ? 1 : 0,
      record.meetingSessionId ?? null,
      record.executionPlanId ?? null,
      JSON.stringify(record.requiredTests),
      JSON.stringify(record.rollbackConditions),
      record.featureFlagRequired ? 1 : 0,
      record.featureFlagName ?? null,
      record.createdBy,
      record.createdAt,
      now,
    );

    return { ...record, updatedAt: now };
  }

  /**
   * change proposal을 ID로 조회한다.
   * change_workflow_state가 'draft' 이외이거나 created_by가 존재하는 proposal만 반환.
   */
  get(proposalId: string): ChangeProposalRecord | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT payload_json FROM proposal_briefs WHERE id = ? AND created_by IS NOT NULL",
    ).get(proposalId) as { payload_json: string } | undefined;

    if (!row) return null;

    try {
      const parsed = JSON.parse(row.payload_json) as ChangeProposalRecord;
      // change proposal인지 확인 (proposalId가 cp_ 접두사)
      if (parsed.proposalId?.startsWith("cp_") || parsed.workflowState) {
        return parsed;
      }
    } catch {
      // payload_json이 ChangeProposalRecord 형태가 아님 — 기존 연구 proposal
    }

    return null;
  }

  /**
   * change proposal 목록을 조회한다.
   * 기존 연구 proposal과 구분하여 change proposal만 반환.
   */
  list(options?: {
    sessionId?: string;
    workflowState?: ChangeWorkflowState;
    moduleId?: string;
  }): ChangeProposalRecord[] {
    const db = getDb();
    let sql = "SELECT payload_json FROM proposal_briefs WHERE created_by IS NOT NULL AND change_workflow_state != 'draft'";
    const params: unknown[] = [];

    // draft 상태도 포함하려면 cp_ 접두사로 판별
    sql = "SELECT payload_json FROM proposal_briefs WHERE id LIKE 'cp_%'";

    if (options?.sessionId) {
      sql += " AND session_id = ?";
      params.push(options.sessionId);
    }
    if (options?.workflowState) {
      sql += " AND change_workflow_state = ?";
      params.push(options.workflowState);
    }
    sql += " ORDER BY updated_at DESC";

    const rows = db.prepare(sql).all(...params) as Array<{ payload_json: string }>;
    const results: ChangeProposalRecord[] = [];

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payload_json) as ChangeProposalRecord;
        if (options?.moduleId) {
          const allModules = [
            ...parsed.directlyAffectedModules.map((m) => m.moduleId),
            ...parsed.indirectlyAffectedModules.map((m) => m.moduleId),
            ...parsed.observerModules.map((m) => m.moduleId),
          ];
          if (!allModules.includes(options.moduleId)) continue;
        }
        results.push(parsed);
      } catch {
        continue;
      }
    }

    return results;
  }

  /**
   * change proposal의 워크플로 상태를 업데이트한다.
   */
  updateWorkflowState(
    proposalId: string,
    workflowState: ChangeWorkflowState,
  ): ChangeProposalRecord | null {
    const current = this.get(proposalId);
    if (!current) return null;
    return this.save({ ...current, workflowState });
  }

  /**
   * 영향도 분석 결과를 change proposal에 저장한다.
   */
  applyImpactAnalysis(
    proposalId: string,
    impact: {
      directlyAffectedModules: AffectedModuleRecord[];
      indirectlyAffectedModules: AffectedModuleRecord[];
      observerModules: AffectedModuleRecord[];
      requiredAgents: string[];
      meetingRequired: boolean;
      meetingRequiredReason?: string;
    },
  ): ChangeProposalRecord | null {
    const current = this.get(proposalId);
    if (!current) return null;

    return this.save({
      ...current,
      ...impact,
      workflowState: "impact-analyzed",
    });
  }

  /**
   * 활성 change proposal(completed/rejected/failed 아닌) 목록.
   */
  listActive(sessionId?: string): ChangeProposalRecord[] {
    const all = this.list({ sessionId });
    return all.filter((p) =>
      p.workflowState !== "completed" &&
      p.workflowState !== "rejected" &&
      p.workflowState !== "failed",
    );
  }
}
