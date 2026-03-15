/**
 * meeting-store.ts
 *
 * 에이전트 회의 세션, 발언 기록, 승인 조건, 실행 계획의 CRUD.
 * 기존 ProposalStore, DecisionStore와 동일한 패턴:
 *   getDb() + prepared statements + JSON 직렬화.
 */

import { getDb } from "../store/database.js";
import type {
  AgentPositionRecord,
  AgentPositionSummary,
  ApprovalConditionRecord,
  ConflictPoint,
  ConsensusType,
  ExecutionPlanRecord,
  MeetingFollowUpAction,
  MeetingSessionRecord,
  MeetingState,
  TaskAssignment,
  VerificationOutcome,
  VerificationResult,
  TestResult,
} from "./contracts.js";

// ─── MeetingStore ─────────────────────────────────────────────────────────────

export class MeetingStore {
  // ── Meeting Sessions ──────────────────────────────────────────────────────

  saveMeetingSession(session: MeetingSessionRecord): MeetingSessionRecord {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO meeting_sessions (
         id, proposal_id, state, current_round,
         mandatory_agents_json, conditional_agents_json, observer_agents_json,
         responded_agents_json, absent_agents_json,
         key_positions_json, conflict_points_json,
         consensus_type, execution_plan_id, follow_up_actions_json,
         scheduled_at, started_at, completed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         current_round = excluded.current_round,
         responded_agents_json = excluded.responded_agents_json,
         absent_agents_json = excluded.absent_agents_json,
         key_positions_json = excluded.key_positions_json,
         conflict_points_json = excluded.conflict_points_json,
         consensus_type = excluded.consensus_type,
         execution_plan_id = excluded.execution_plan_id,
         follow_up_actions_json = excluded.follow_up_actions_json,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
    ).run(
      session.meetingId,
      session.proposalId,
      session.state,
      session.currentRound,
      JSON.stringify(session.mandatoryAgents),
      JSON.stringify(session.conditionalAgents),
      JSON.stringify(session.observerAgents),
      JSON.stringify(session.respondedAgents),
      JSON.stringify(session.absentAgents),
      JSON.stringify(session.keyPositions),
      JSON.stringify(session.conflictPoints),
      session.consensusType ?? null,
      session.executionPlanId ?? null,
      JSON.stringify(session.followUpActions),
      session.scheduledAt,
      session.startedAt ?? null,
      session.completedAt ?? null,
      session.createdAt ?? now,
      now,
    );
    return { ...session, updatedAt: now };
  }

  getMeetingSession(meetingId: string): MeetingSessionRecord | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM meeting_sessions WHERE id = ?",
    ).get(meetingId) as Record<string, unknown> | undefined;
    return row ? this.rowToMeetingSession(row) : null;
  }

  getMeetingByProposal(proposalId: string): MeetingSessionRecord | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM meeting_sessions WHERE proposal_id = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(proposalId) as Record<string, unknown> | undefined;
    return row ? this.rowToMeetingSession(row) : null;
  }

  listMeetingSessions(options?: {
    state?: MeetingState;
    proposalId?: string;
  }): MeetingSessionRecord[] {
    const db = getDb();
    let sql = "SELECT * FROM meeting_sessions WHERE 1=1";
    const params: unknown[] = [];

    if (options?.state) {
      sql += " AND state = ?";
      params.push(options.state);
    }
    if (options?.proposalId) {
      sql += " AND proposal_id = ?";
      params.push(options.proposalId);
    }
    sql += " ORDER BY updated_at DESC";

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToMeetingSession(row));
  }

  listActiveMeetings(): MeetingSessionRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM meeting_sessions
       WHERE state NOT IN ('completed', 'failed')
       ORDER BY updated_at DESC`,
    ).all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToMeetingSession(row));
  }

  updateMeetingState(
    meetingId: string,
    state: MeetingState,
    updates?: Partial<Pick<MeetingSessionRecord,
      "currentRound" | "consensusType" | "executionPlanId" |
      "startedAt" | "completedAt" | "respondedAgents" | "absentAgents"
    >>,
  ): MeetingSessionRecord | null {
    const current = this.getMeetingSession(meetingId);
    if (!current) return null;

    const updated: MeetingSessionRecord = {
      ...current,
      state,
      currentRound: updates?.currentRound ?? current.currentRound,
      consensusType: updates?.consensusType ?? current.consensusType,
      executionPlanId: updates?.executionPlanId ?? current.executionPlanId,
      startedAt: updates?.startedAt ?? current.startedAt,
      completedAt: updates?.completedAt ?? current.completedAt,
      respondedAgents: updates?.respondedAgents ?? current.respondedAgents,
      absentAgents: updates?.absentAgents ?? current.absentAgents,
    };
    return this.saveMeetingSession(updated);
  }

  private rowToMeetingSession(row: Record<string, unknown>): MeetingSessionRecord {
    return {
      meetingId: row.id as string,
      proposalId: row.proposal_id as string,
      state: row.state as MeetingState,
      currentRound: row.current_round as number,
      mandatoryAgents: JSON.parse(row.mandatory_agents_json as string) as string[],
      conditionalAgents: JSON.parse(row.conditional_agents_json as string) as string[],
      observerAgents: JSON.parse(row.observer_agents_json as string) as string[],
      respondedAgents: JSON.parse(row.responded_agents_json as string) as string[],
      absentAgents: JSON.parse(row.absent_agents_json as string) as string[],
      keyPositions: row.key_positions_json
        ? (JSON.parse(row.key_positions_json as string) as AgentPositionSummary[])
        : [],
      conflictPoints: row.conflict_points_json
        ? (JSON.parse(row.conflict_points_json as string) as ConflictPoint[])
        : [],
      consensusType: (row.consensus_type as ConsensusType | null) ?? undefined,
      executionPlanId: (row.execution_plan_id as string | null) ?? undefined,
      followUpActions: row.follow_up_actions_json
        ? (JSON.parse(row.follow_up_actions_json as string) as MeetingFollowUpAction[])
        : [],
      scheduledAt: row.scheduled_at as number,
      startedAt: (row.started_at as number | null) ?? undefined,
      completedAt: (row.completed_at as number | null) ?? undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // ── Agent Positions ───────────────────────────────────────────────────────

  saveAgentPosition(position: AgentPositionRecord): AgentPositionRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO agent_positions (
         id, meeting_id, agent_id, module_id, round,
         position, impact, risk, required_changes_json,
         vote, approval_condition, notes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         position = excluded.position,
         impact = excluded.impact,
         risk = excluded.risk,
         required_changes_json = excluded.required_changes_json,
         vote = excluded.vote,
         approval_condition = excluded.approval_condition,
         notes = excluded.notes`,
    ).run(
      position.positionId,
      position.meetingId,
      position.agentId,
      position.moduleId,
      position.round,
      position.position,
      position.impact,
      position.risk,
      JSON.stringify(position.requiredChanges),
      position.vote ?? null,
      position.approvalCondition ?? null,
      position.notes ?? null,
      position.createdAt,
    );
    return position;
  }

  listAgentPositions(meetingId: string, round?: number): AgentPositionRecord[] {
    const db = getDb();
    let sql = "SELECT * FROM agent_positions WHERE meeting_id = ?";
    const params: unknown[] = [meetingId];

    if (round !== undefined) {
      sql += " AND round = ?";
      params.push(round);
    }
    sql += " ORDER BY created_at ASC";

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToAgentPosition(row));
  }

  getAgentPosition(meetingId: string, agentId: string, round: number): AgentPositionRecord | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM agent_positions WHERE meeting_id = ? AND agent_id = ? AND round = ?",
    ).get(meetingId, agentId, round) as Record<string, unknown> | undefined;
    return row ? this.rowToAgentPosition(row) : null;
  }

  private rowToAgentPosition(row: Record<string, unknown>): AgentPositionRecord {
    return {
      positionId: row.id as string,
      meetingId: row.meeting_id as string,
      agentId: row.agent_id as string,
      moduleId: row.module_id as string,
      round: row.round as number,
      position: row.position as AgentPositionRecord["position"],
      impact: row.impact as string,
      risk: row.risk as string,
      requiredChanges: JSON.parse(row.required_changes_json as string) as string[],
      vote: (row.vote as AgentPositionRecord["vote"]) ?? undefined,
      approvalCondition: (row.approval_condition as string | null) ?? undefined,
      notes: (row.notes as string | null) ?? undefined,
      createdAt: row.created_at as number,
    };
  }

  // ── Approval Conditions ───────────────────────────────────────────────────

  saveApprovalCondition(condition: ApprovalConditionRecord): ApprovalConditionRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO approval_conditions (
         id, meeting_id, proposal_id, required_by,
         condition_text, verification_method, verified_by,
         status, verified_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         verified_by = excluded.verified_by,
         verified_at = excluded.verified_at`,
    ).run(
      condition.conditionId,
      condition.meetingId,
      condition.proposalId,
      condition.requiredBy,
      condition.conditionText,
      condition.verificationMethod,
      condition.verifiedBy ?? null,
      condition.status,
      condition.verifiedAt ?? null,
      condition.createdAt,
    );
    return condition;
  }

  listApprovalConditions(meetingId: string): ApprovalConditionRecord[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM approval_conditions WHERE meeting_id = ? ORDER BY created_at ASC",
    ).all(meetingId) as Record<string, unknown>[];
    return rows.map((row) => ({
      conditionId: row.id as string,
      meetingId: row.meeting_id as string,
      proposalId: row.proposal_id as string,
      requiredBy: row.required_by as string,
      conditionText: row.condition_text as string,
      verificationMethod: row.verification_method as string,
      verifiedBy: (row.verified_by as string | null) ?? undefined,
      status: row.status as ApprovalConditionRecord["status"],
      verifiedAt: (row.verified_at as number | null) ?? undefined,
      createdAt: row.created_at as number,
    }));
  }

  listPendingConditions(proposalId: string): ApprovalConditionRecord[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM approval_conditions WHERE proposal_id = ? AND status = 'pending' ORDER BY created_at ASC",
    ).all(proposalId) as Record<string, unknown>[];
    return rows.map((row) => ({
      conditionId: row.id as string,
      meetingId: row.meeting_id as string,
      proposalId: row.proposal_id as string,
      requiredBy: row.required_by as string,
      conditionText: row.condition_text as string,
      verificationMethod: row.verification_method as string,
      verifiedBy: (row.verified_by as string | null) ?? undefined,
      status: row.status as ApprovalConditionRecord["status"],
      verifiedAt: (row.verified_at as number | null) ?? undefined,
      createdAt: row.created_at as number,
    }));
  }

  updateApprovalCondition(
    conditionId: string,
    updates: Partial<Pick<ApprovalConditionRecord, "status" | "verifiedBy" | "verifiedAt">>,
  ): ApprovalConditionRecord | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM approval_conditions WHERE id = ?")
      .get(conditionId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const status = updates.status ?? row.status as string;
    const verifiedBy = updates.verifiedBy ?? row.verified_by as string | null;
    const verifiedAt = updates.verifiedAt ?? row.verified_at as number | null;

    db.prepare(
      "UPDATE approval_conditions SET status = ?, verified_by = ?, verified_at = ? WHERE id = ?",
    ).run(status, verifiedBy, verifiedAt, conditionId);

    return {
      conditionId: row.id as string,
      meetingId: row.meeting_id as string,
      proposalId: row.proposal_id as string,
      requiredBy: row.required_by as string,
      conditionText: row.condition_text as string,
      verificationMethod: row.verification_method as string,
      verifiedBy: verifiedBy ?? undefined,
      status: status as ApprovalConditionRecord["status"],
      verifiedAt: verifiedAt ?? undefined,
      createdAt: row.created_at as number,
    };
  }

  // ── Execution Plans ───────────────────────────────────────────────────────

  saveExecutionPlan(plan: ExecutionPlanRecord): ExecutionPlanRecord {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO execution_plans (
         id, proposal_id, meeting_id,
         task_assignments_json, required_tests_json,
         rollback_plan, feature_flags_json,
         status, started_at, completed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         task_assignments_json = excluded.task_assignments_json,
         required_tests_json = excluded.required_tests_json,
         rollback_plan = excluded.rollback_plan,
         feature_flags_json = excluded.feature_flags_json,
         status = excluded.status,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
    ).run(
      plan.executionPlanId,
      plan.proposalId,
      plan.meetingId,
      JSON.stringify(plan.taskAssignments),
      JSON.stringify(plan.requiredTests),
      plan.rollbackPlan,
      JSON.stringify(plan.featureFlags),
      plan.status,
      plan.startedAt ?? null,
      plan.completedAt ?? null,
      plan.createdAt ?? now,
      now,
    );
    return { ...plan, updatedAt: now };
  }

  getExecutionPlan(planId: string): ExecutionPlanRecord | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM execution_plans WHERE id = ?")
      .get(planId) as Record<string, unknown> | undefined;
    return row ? this.rowToExecutionPlan(row) : null;
  }

  getExecutionPlanByProposal(proposalId: string): ExecutionPlanRecord | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM execution_plans WHERE proposal_id = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(proposalId) as Record<string, unknown> | undefined;
    return row ? this.rowToExecutionPlan(row) : null;
  }

  updateExecutionPlanStatus(
    planId: string,
    status: ExecutionPlanRecord["status"],
    timestamps?: { startedAt?: number; completedAt?: number },
  ): ExecutionPlanRecord | null {
    const current = this.getExecutionPlan(planId);
    if (!current) return null;
    return this.saveExecutionPlan({
      ...current,
      status,
      startedAt: timestamps?.startedAt ?? current.startedAt,
      completedAt: timestamps?.completedAt ?? current.completedAt,
    });
  }

  private rowToExecutionPlan(row: Record<string, unknown>): ExecutionPlanRecord {
    return {
      executionPlanId: row.id as string,
      proposalId: row.proposal_id as string,
      meetingId: row.meeting_id as string,
      taskAssignments: JSON.parse(row.task_assignments_json as string) as TaskAssignment[],
      requiredTests: JSON.parse(row.required_tests_json as string) as string[],
      rollbackPlan: row.rollback_plan as string,
      featureFlags: row.feature_flags_json
        ? (JSON.parse(row.feature_flags_json as string) as string[])
        : [],
      status: row.status as ExecutionPlanRecord["status"],
      startedAt: (row.started_at as number | null) ?? undefined,
      completedAt: (row.completed_at as number | null) ?? undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // ── Verification Results ──────────────────────────────────────────────────

  saveVerificationResult(result: VerificationResult): VerificationResult {
    const db = getDb();
    db.prepare(
      `INSERT INTO verification_results (
         id, proposal_id, execution_plan_id,
         test_results_json, overall_outcome,
         remeeting_required, remeeting_reason,
         verified_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         test_results_json = excluded.test_results_json,
         overall_outcome = excluded.overall_outcome,
         remeeting_required = excluded.remeeting_required,
         remeeting_reason = excluded.remeeting_reason`,
    ).run(
      result.verificationId,
      result.proposalId,
      result.executionPlanId,
      JSON.stringify(result.testResults),
      result.overallOutcome,
      result.remeetingRequired ? 1 : 0,
      result.remeetingReason ?? null,
      result.verifiedAt,
      result.createdAt,
    );
    return result;
  }

  listVerificationResults(proposalId: string): VerificationResult[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM verification_results WHERE proposal_id = ? ORDER BY verified_at DESC",
    ).all(proposalId) as Record<string, unknown>[];
    return rows.map((row) => ({
      verificationId: row.id as string,
      proposalId: row.proposal_id as string,
      executionPlanId: row.execution_plan_id as string,
      testResults: JSON.parse(row.test_results_json as string) as TestResult[],
      overallOutcome: row.overall_outcome as VerificationOutcome,
      remeetingRequired: (row.remeeting_required as number) === 1,
      remeetingReason: (row.remeeting_reason as string | null) ?? undefined,
      verifiedAt: row.verified_at as number,
      createdAt: row.created_at as number,
    }));
  }

  getLatestVerification(proposalId: string): VerificationResult | null {
    return this.listVerificationResults(proposalId)[0] ?? null;
  }

  // ── Module Impact Cache ───────────────────────────────────────────────────

  saveModuleImpact(
    proposalId: string,
    changedPaths: string[],
    impactResultJson: string,
    analyzerVersion?: string,
  ): void {
    const db = getDb();
    const id = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO module_impact_records (id, proposal_id, changed_paths_json, impact_result_json, analyzer_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, proposalId, JSON.stringify(changedPaths), impactResultJson, analyzerVersion ?? null, Date.now());
  }

  getLatestModuleImpact(proposalId: string): { changedPaths: string[]; impactResult: unknown; analyzerVersion?: string } | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM module_impact_records WHERE proposal_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(proposalId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      changedPaths: JSON.parse(row.changed_paths_json as string) as string[],
      impactResult: JSON.parse(row.impact_result_json as string),
      analyzerVersion: (row.analyzer_version as string | null) ?? undefined,
    };
  }
}
