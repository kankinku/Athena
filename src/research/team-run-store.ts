import { nanoid } from "nanoid";
import { getDb } from "../store/database.js";
import type {
  AutomationPolicy,
  AutonomousModePolicy,
  AutomationRuntimeState,
  CheckpointPolicy,
  ExperimentBudget,
  RetryPolicy,
  TeamRunRecord,
  TeamRunStatus,
  TeamStage,
  TimeoutPolicy,
} from "./contracts.js";

interface TeamRunRow {
  id: string;
  session_id: string;
  goal: string;
  current_stage: TeamStage;
  status: TeamRunStatus;
  workflow_state: TeamRunRecord["workflowState"];
  automation_policy_json: string | null;
  checkpoint_policy_json: string | null;
  retry_policy_json: string | null;
  timeout_policy_json: string | null;
  automation_state_json: string | null;
  budget_json: string | null;
  latest_output_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface TeamRunUpdateInput {
  currentStage?: TeamStage;
  status?: TeamRunStatus;
  workflowState?: TeamRunRecord["workflowState"];
  automationPolicy?: AutomationPolicy;
  checkpointPolicy?: CheckpointPolicy;
  retryPolicy?: RetryPolicy;
  timeoutPolicy?: TimeoutPolicy;
  automationState?: AutomationRuntimeState;
  latestOutput?: Record<string, unknown>;
  budget?: ExperimentBudget;
}

export class TeamRunStore {
  createTeamRun(sessionId: string, goal: string, budget?: ExperimentBudget): TeamRunRecord {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();
    const automationPolicy = defaultAutomationPolicy();
    const checkpointPolicy = defaultCheckpointPolicy();
    const retryPolicy = defaultRetryPolicy();
    const timeoutPolicy = defaultTimeoutPolicy();
    const automationState = defaultAutomationState(now, checkpointPolicy, timeoutPolicy);
    db.prepare(
      `INSERT INTO team_runs (id, session_id, goal, current_stage, status, workflow_state, automation_policy_json, checkpoint_policy_json, retry_policy_json, timeout_policy_json, automation_state_json, budget_json, latest_output_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      sessionId,
      goal,
      "collection",
      "active",
      "draft",
      JSON.stringify(automationPolicy),
      JSON.stringify(checkpointPolicy),
      JSON.stringify(retryPolicy),
      JSON.stringify(timeoutPolicy),
      JSON.stringify(automationState),
      budget ? JSON.stringify(budget) : null,
      null,
      now,
      now,
    );

    return {
      id,
      sessionId,
      goal,
      currentStage: "collection",
      status: "active",
      workflowState: "draft",
      automationPolicy,
      checkpointPolicy,
      retryPolicy,
      timeoutPolicy,
      automationState,
      budget,
      createdAt: now,
      updatedAt: now,
    };
  }

  getTeamRun(id: string): TeamRunRecord | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM team_runs WHERE id = ?").get(id) as TeamRunRow | undefined;
    return row ? mapTeamRun(row) : null;
  }

  updateTeamRun(id: string, updates: TeamRunUpdateInput): TeamRunRecord | null {
    const current = this.getTeamRun(id);
    if (!current) return null;

    const db = getDb();
    const now = Date.now();
    const nextStage = updates.currentStage ?? current.currentStage;
    const next: TeamRunRecord = {
      ...current,
      currentStage: nextStage,
      status: updates.status ?? current.status,
      workflowState: updates.workflowState ?? current.workflowState,
      automationPolicy: normalizeAutomationPolicy(updates.automationPolicy ?? current.automationPolicy),
      checkpointPolicy: updates.checkpointPolicy ?? current.checkpointPolicy,
      retryPolicy: updates.retryPolicy ?? current.retryPolicy,
      timeoutPolicy: updates.timeoutPolicy ?? current.timeoutPolicy,
      automationState: normalizeAutomationState(
        updates.automationState ?? current.automationState,
        current.currentStage,
        nextStage,
        now,
        current.createdAt,
      ),
      latestOutput: updates.latestOutput ?? current.latestOutput,
      budget: updates.budget ?? current.budget,
      updatedAt: now,
    };

    db.prepare(
      `UPDATE team_runs
       SET current_stage = ?, status = ?, workflow_state = ?, automation_policy_json = ?, checkpoint_policy_json = ?, retry_policy_json = ?, timeout_policy_json = ?, automation_state_json = ?, budget_json = ?, latest_output_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      next.currentStage,
      next.status,
      next.workflowState,
      JSON.stringify(next.automationPolicy),
      JSON.stringify(next.checkpointPolicy),
      JSON.stringify(next.retryPolicy),
      JSON.stringify(next.timeoutPolicy),
      JSON.stringify(next.automationState),
      next.budget ? JSON.stringify(next.budget) : null,
      next.latestOutput ? JSON.stringify(next.latestOutput) : null,
      next.updatedAt,
      id,
    );

    return next;
  }

  listRecentTeamRuns(sessionId: string, limit = 5): TeamRunRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM team_runs
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    ).all(sessionId, limit) as TeamRunRow[];
    return rows.map(mapTeamRun);
  }
}

function mapTeamRun(row: TeamRunRow): TeamRunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    goal: row.goal,
    currentStage: row.current_stage,
    status: row.status,
    workflowState: row.workflow_state,
    automationPolicy: row.automation_policy_json
      ? normalizeAutomationPolicy(JSON.parse(row.automation_policy_json) as AutomationPolicy)
      : defaultAutomationPolicy(),
    checkpointPolicy: row.checkpoint_policy_json
      ? (JSON.parse(row.checkpoint_policy_json) as CheckpointPolicy)
      : defaultCheckpointPolicy(),
    retryPolicy: row.retry_policy_json
      ? (JSON.parse(row.retry_policy_json) as RetryPolicy)
      : defaultRetryPolicy(),
    timeoutPolicy: row.timeout_policy_json
      ? (JSON.parse(row.timeout_policy_json) as TimeoutPolicy)
      : defaultTimeoutPolicy(),
    automationState: row.automation_state_json
      ? normalizeAutomationState(
        JSON.parse(row.automation_state_json) as AutomationRuntimeState,
        row.current_stage,
        row.current_stage,
        row.updated_at,
        row.created_at,
      )
      : defaultAutomationState(row.created_at, defaultCheckpointPolicy(), defaultTimeoutPolicy()),
    budget: row.budget_json ? (JSON.parse(row.budget_json) as ExperimentBudget) : undefined,
    latestOutput: row.latest_output_json
      ? (JSON.parse(row.latest_output_json) as Record<string, unknown>)
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultAutomationPolicy(): AutomationPolicy {
  return {
    mode: "manual",
    requireProposalApproval: true,
    requireExperimentApproval: true,
    requireRevisitApproval: true,
    maxAutoExperiments: 1,
  };
}

function defaultAutonomousModePolicy(): AutonomousModePolicy {
  return {
    maxRiskTier: "safe",
    maxRetryCount: 1,
    requireRollbackPlan: true,
  };
}

function normalizeAutomationPolicy(policy: AutomationPolicy): AutomationPolicy {
  if (policy.mode !== "fully-autonomous") {
    return {
      ...policy,
      autonomyPolicy: undefined,
    };
  }

  return {
    ...policy,
    autonomyPolicy: {
      ...defaultAutonomousModePolicy(),
      ...(policy.autonomyPolicy ?? {}),
    },
  };
}

function defaultCheckpointPolicy(): CheckpointPolicy {
  return {
    intervalMinutes: 30,
    onWorkflowStates: ["running", "evaluating", "revisit_due"],
  };
}

function defaultRetryPolicy(): RetryPolicy {
  return {
    maxRetries: 2,
    retryOn: ["budget_exceeded", "inconclusive", "shadow_win"],
  };
}

function defaultTimeoutPolicy(): TimeoutPolicy {
  return {
    maxRunMinutes: 480,
    maxStageMinutes: 120,
  };
}

function defaultAutomationState(
  createdAt: number,
  checkpointPolicy: CheckpointPolicy,
  timeoutPolicy: TimeoutPolicy,
): AutomationRuntimeState {
  return {
    retryCount: 0,
    resumeCount: 0,
    timeoutAt: timeoutPolicy.maxRunMinutes > 0
      ? createdAt + (timeoutPolicy.maxRunMinutes * 60_000)
      : undefined,
    nextCheckpointAt: checkpointPolicy.intervalMinutes > 0
      ? createdAt + (checkpointPolicy.intervalMinutes * 60_000)
      : undefined,
  };
}

function normalizeAutomationState(
  state: AutomationRuntimeState,
  previousStage: TeamStage,
  nextStage: TeamStage,
  now: number,
  _createdAt: number,
): AutomationRuntimeState {
  const stageChanged = previousStage !== nextStage;
  return {
    ...state,
    stageStartedAt: stageChanged
      ? now
      : state.stageStartedAt,
  };
}
