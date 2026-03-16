import { getDb } from "../store/database.js";
import type { PipelineContext } from "./change-pipeline.js";
import { MeetingStore } from "./meeting-store.js";
import type { ChangeWorkflowState } from "./contracts.js";

export class PipelineStore {
  constructor(private readonly meetingStore = new MeetingStore()) {}

  save(ctx: PipelineContext): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO pipeline_runs (
         pipeline_id, proposal_id, session_id,
         current_state, current_stage,
         meeting_id, execution_plan_id, verification_id,
         impact_result_json, stages_json, options_json,
         started_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pipeline_id) DO UPDATE SET
         current_state = excluded.current_state,
         current_stage = excluded.current_stage,
         meeting_id = excluded.meeting_id,
         execution_plan_id = excluded.execution_plan_id,
         verification_id = excluded.verification_id,
         impact_result_json = excluded.impact_result_json,
         stages_json = excluded.stages_json,
         options_json = excluded.options_json,
         updated_at = excluded.updated_at,
         completed_at = excluded.completed_at`,
    ).run(
      ctx.pipelineId,
      ctx.proposalId,
      ctx.sessionId,
      ctx.currentState,
      currentStage(ctx),
      ctx.meetingId ?? ctx.meetingResult?.meetingId ?? null,
      ctx.executionPlan?.executionPlanId ?? ctx.meetingResult?.executionPlanId ?? null,
      ctx.verificationResult?.verificationId ?? null,
      ctx.impactResult ? JSON.stringify(ctx.impactResult) : null,
      JSON.stringify(ctx.stages),
      "{}",
      now,
      now,
      isTerminal(ctx.currentState) ? now : null,
    );
  }

  load(proposalId: string): PipelineContext | null {
    const db = getDb();
    const row = db.prepare(
      `SELECT * FROM pipeline_runs
       WHERE proposal_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(proposalId) as PipelineRunRow | undefined;

    return row ? this.rowToContext(row) : null;
  }

  getById(pipelineId: string): PipelineContext | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM pipeline_runs WHERE pipeline_id = ?",
    ).get(pipelineId) as PipelineRunRow | undefined;

    return row ? this.rowToContext(row) : null;
  }

  listActive(): PipelineContext[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM pipeline_runs
       WHERE completed_at IS NULL
       ORDER BY updated_at DESC`,
    ).all() as PipelineRunRow[];

    return rows.map((row) => this.rowToContext(row));
  }

  updateState(pipelineId: string, state: ChangeWorkflowState): void {
    const db = getDb();
    db.prepare(
      `UPDATE pipeline_runs
       SET current_state = ?, updated_at = ?,
           completed_at = CASE WHEN ? THEN ? ELSE completed_at END
       WHERE pipeline_id = ?`,
    ).run(state, Date.now(), isTerminal(state) ? 1 : 0, Date.now(), pipelineId);
  }

  private rowToContext(row: PipelineRunRow): PipelineContext {
    const meetingResult = row.meeting_id
      ? this.meetingStore.getMeetingSession(row.meeting_id)
      : undefined;
    const executionPlan = row.execution_plan_id
      ? this.meetingStore.getExecutionPlan(row.execution_plan_id)
      : undefined;
    const verificationResult = row.verification_id
      ? this.meetingStore.getVerificationResult(row.verification_id)
      : undefined;

    return {
      pipelineId: row.pipeline_id,
      proposalId: row.proposal_id,
      sessionId: row.session_id,
      currentState: row.current_state as ChangeWorkflowState,
      stages: row.stages_json ? JSON.parse(row.stages_json) : [],
      impactResult: row.impact_result_json ? JSON.parse(row.impact_result_json) : undefined,
      meetingId: row.meeting_id ?? meetingResult?.meetingId ?? undefined,
      meetingResult: meetingResult ?? undefined,
      executionPlan: executionPlan ?? undefined,
      verificationResult: verificationResult ?? undefined,
      auditTrail: [],
    };
  }
}

interface PipelineRunRow {
  pipeline_id: string;
  proposal_id: string;
  session_id: string;
  current_state: string;
  current_stage: string | null;
  meeting_id: string | null;
  execution_plan_id: string | null;
  verification_id: string | null;
  impact_result_json: string | null;
  stages_json: string | null;
  options_json: string | null;
  started_at: number;
  updated_at: number;
  completed_at: number | null;
}

function currentStage(ctx: PipelineContext): string | null {
  const last = ctx.stages[ctx.stages.length - 1];
  return last?.stage ?? null;
}

function isTerminal(state: ChangeWorkflowState): boolean {
  return state === "merged" || state === "failed" || state === "rejected" || state === "rolled-back";
}
