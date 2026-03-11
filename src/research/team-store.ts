import { nanoid } from "nanoid";
import { getDb } from "../store/database.js";
import type {
  AutomationCheckpointRecord,
  AutomationPolicy,
  AutomationRuntimeState,
  BudgetAnomalyRecord,
  CheckpointPolicy,
  ClaimSupportSummary,
  DecisionRecord,
  ExperimentLineageRecord,
  ExperimentBudget,
  ExperimentCharter,
  ExperimentResult,
  IngestionSourceRecord,
  ImprovementEvaluationRecord,
  ImprovementProposalRecord,
  ProposalBrief,
  ProposalScorecard,
  ReconsiderationTrigger,
  TeamRunRecord,
  TeamRunStatus,
  TeamStage,
  TimeoutPolicy,
  WorkflowTransitionRecord,
  RetryPolicy,
} from "./contracts.js";
import { resolveCanonicalClaimReference } from "./claim-graph.js";
import { assertValidWorkflowTransition, canRollbackWorkflowState } from "./workflow-state.js";

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

type AutomationAction = "proposal" | "experiment" | "resume" | "retry";

export interface SimulationRunRecord {
  id: string;
  sessionId: string;
  proposalId: string;
  taskKey?: string;
  status: string;
  charter: ExperimentCharter;
  budget?: ExperimentBudget;
  result?: ExperimentResult;
  createdAt: number;
  updatedAt: number;
}

export interface ReconsiderationTriggerRecord extends ReconsiderationTrigger {
  proposalId: string;
}

export class TeamStore {
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

  updateTeamRun(
    id: string,
    updates: {
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
    },
  ): TeamRunRecord | null {
    const current = this.getTeamRun(id);
    if (!current) return null;

    const db = getDb();
    const next: TeamRunRecord = {
      ...current,
      currentStage: updates.currentStage ?? current.currentStage,
      status: updates.status ?? current.status,
      workflowState: updates.workflowState ?? current.workflowState,
      automationPolicy: updates.automationPolicy ?? current.automationPolicy,
      checkpointPolicy: updates.checkpointPolicy ?? current.checkpointPolicy,
      retryPolicy: updates.retryPolicy ?? current.retryPolicy,
      timeoutPolicy: updates.timeoutPolicy ?? current.timeoutPolicy,
      automationState: updates.automationState ?? current.automationState,
      latestOutput: updates.latestOutput ?? current.latestOutput,
      budget: updates.budget ?? current.budget,
      updatedAt: Date.now(),
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

  transitionWorkflow(
    runId: string,
    toState: TeamRunRecord["workflowState"],
    reason: string,
    options: { rollbackOfTransitionId?: string; metadata?: Record<string, unknown> } = {},
  ): TeamRunRecord | null {
    const run = this.getTeamRun(runId);
    if (!run) return null;
    assertValidWorkflowTransition(run.workflowState, toState);
    const next = this.updateTeamRun(runId, {
      workflowState: toState,
      status: toState === "failed"
        ? "failed"
        : toState === "archived"
          ? "completed"
          : run.status,
    });
    if (!next) return null;
    this.saveWorkflowTransition(run.sessionId, {
      transitionId: nanoid(),
      runId,
      fromState: run.workflowState,
      toState,
      reason,
      rollbackOfTransitionId: options.rollbackOfTransitionId,
      metadata: options.metadata,
      createdAt: Date.now(),
    });
    return next;
  }

  rollbackWorkflow(runId: string, reason: string): TeamRunRecord | null {
    const run = this.getTeamRun(runId);
    if (!run) return null;
    const history = this.listWorkflowTransitions(run.sessionId, runId);
    const target = [...history].reverse().find((entry) => canRollbackWorkflowState(entry.fromState));
    if (!target) return null;
    const next = this.updateTeamRun(runId, {
      workflowState: target.fromState,
      status: "active",
    });
    if (!next) return null;
    this.saveWorkflowTransition(run.sessionId, {
      transitionId: nanoid(),
      runId,
      fromState: run.workflowState,
      toState: target.fromState,
      reason,
      rollbackOfTransitionId: target.transitionId,
      metadata: { rollback: true },
      createdAt: Date.now(),
    });
    return next;
  }

  configureAutomation(
    runId: string,
    updates: Partial<Pick<TeamRunRecord, "automationPolicy" | "checkpointPolicy" | "retryPolicy" | "timeoutPolicy">>,
  ): TeamRunRecord | null {
    const run = this.getTeamRun(runId);
    if (!run) return null;
    const checkpointPolicy = updates.checkpointPolicy ?? run.checkpointPolicy;
    const timeoutPolicy = updates.timeoutPolicy ?? run.timeoutPolicy;
    return this.updateTeamRun(runId, {
      automationPolicy: updates.automationPolicy ?? run.automationPolicy,
      checkpointPolicy,
      retryPolicy: updates.retryPolicy ?? run.retryPolicy,
      timeoutPolicy,
      automationState: {
        ...run.automationState,
        timeoutAt: timeoutPolicy.maxRunMinutes > 0
          ? run.createdAt + (timeoutPolicy.maxRunMinutes * 60_000)
          : undefined,
        nextCheckpointAt: checkpointPolicy.intervalMinutes > 0
          ? Date.now() + (checkpointPolicy.intervalMinutes * 60_000)
          : undefined,
      },
    });
  }

  canAutomateAction(
    runId: string,
    action: AutomationAction,
  ): { ok: true; run: TeamRunRecord } | { ok: false; run: TeamRunRecord | null; reason: string } {
    const run = this.getTeamRun(runId);
    if (!run) {
      return { ok: false, run: null, reason: "run not found" };
    }
    if (run.automationState.timeoutAt !== undefined && Date.now() >= run.automationState.timeoutAt) {
      return { ok: false, run, reason: "automation timeout exceeded" };
    }
    if (action === "proposal" && run.automationPolicy.requireProposalApproval) {
      return { ok: false, run, reason: "proposal approval required by automation policy" };
    }
    if (action === "experiment" && run.automationPolicy.requireExperimentApproval) {
      return { ok: false, run, reason: "experiment approval required by automation policy" };
    }
    if (action === "retry" && run.automationState.retryCount >= run.retryPolicy.maxRetries) {
      return { ok: false, run, reason: "retry limit reached" };
    }
    return { ok: true, run };
  }

  noteAutomationBlock(runId: string, action: AutomationAction, reason: string): TeamRunRecord | null {
    const run = this.getTeamRun(runId);
    if (!run) return null;
    return this.updateTeamRun(runId, {
      latestOutput: {
        ...(run.latestOutput ?? {}),
        automationBlock: {
          action,
          reason,
          at: Date.now(),
        },
      },
    });
  }

  saveAutomationCheckpoint(sessionId: string, checkpoint: AutomationCheckpointRecord): AutomationCheckpointRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO automation_checkpoints (
         id, run_id, session_id, workflow_state, stage, reason, snapshot_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      checkpoint.checkpointId,
      checkpoint.runId,
      sessionId,
      checkpoint.workflowState,
      checkpoint.stage,
      checkpoint.reason,
      checkpoint.snapshot ? JSON.stringify(checkpoint.snapshot) : null,
      checkpoint.createdAt,
    );
    return checkpoint;
  }

  listAutomationCheckpoints(sessionId: string, runId: string): AutomationCheckpointRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM automation_checkpoints
       WHERE session_id = ? AND run_id = ?
       ORDER BY created_at ASC`,
    ).all(sessionId, runId) as Record<string, unknown>[];
    return rows.map((row) => ({
      checkpointId: row.id as string,
      runId: row.run_id as string,
      workflowState: row.workflow_state as AutomationCheckpointRecord["workflowState"],
      stage: row.stage as AutomationCheckpointRecord["stage"],
      reason: row.reason as string,
      snapshot: row.snapshot_json ? (JSON.parse(row.snapshot_json as string) as Record<string, unknown>) : undefined,
      createdAt: row.created_at as number,
    }));
  }

  saveImprovementProposal(sessionId: string, proposal: ImprovementProposalRecord): ImprovementProposalRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO improvement_proposals (
         id, session_id, run_id, proposal_id, experiment_id, title, target_area, status, payload_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    ).run(
      proposal.improvementId,
      sessionId,
      proposal.runId,
      proposal.proposalId ?? null,
      proposal.experimentId ?? null,
      proposal.title,
      proposal.targetArea,
      proposal.status,
      JSON.stringify(proposal),
      proposal.createdAt,
      proposal.updatedAt,
    );
    return proposal;
  }

  listImprovementProposals(sessionId: string, runId?: string): ImprovementProposalRecord[] {
    const db = getDb();
    const rows = runId
      ? db.prepare(`SELECT payload_json FROM improvement_proposals WHERE session_id = ? AND run_id = ? ORDER BY updated_at DESC`).all(sessionId, runId)
      : db.prepare(`SELECT payload_json FROM improvement_proposals WHERE session_id = ? ORDER BY updated_at DESC`).all(sessionId);
    return (rows as Array<Record<string, unknown>>).map((row) => JSON.parse(row.payload_json as string) as ImprovementProposalRecord);
  }

  saveImprovementEvaluation(sessionId: string, evaluation: ImprovementEvaluationRecord): ImprovementEvaluationRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO improvement_evaluations (
         id, session_id, improvement_id, run_id, experiment_id, outcome, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      evaluation.evaluationId,
      sessionId,
      evaluation.improvementId ?? null,
      evaluation.runId,
      evaluation.experimentId ?? null,
      evaluation.outcome,
      JSON.stringify(evaluation),
      evaluation.createdAt,
    );
    return evaluation;
  }

  listImprovementEvaluations(sessionId: string, runId?: string): ImprovementEvaluationRecord[] {
    const db = getDb();
    const rows = runId
      ? db.prepare(`SELECT payload_json FROM improvement_evaluations WHERE session_id = ? AND run_id = ? ORDER BY created_at DESC`).all(sessionId, runId)
      : db.prepare(`SELECT payload_json FROM improvement_evaluations WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId);
    return (rows as Array<Record<string, unknown>>).map((row) => JSON.parse(row.payload_json as string) as ImprovementEvaluationRecord);
  }

  recordAutomationCheckpoint(runId: string, reason: string, snapshot?: Record<string, unknown>): AutomationCheckpointRecord | null {
    const run = this.getTeamRun(runId);
    if (!run) return null;
    const now = Date.now();
    this.updateTeamRun(runId, {
      automationState: {
        ...run.automationState,
        lastCheckpointAt: now,
        lastCheckpointReason: reason,
        nextCheckpointAt: run.checkpointPolicy.intervalMinutes > 0
          ? now + (run.checkpointPolicy.intervalMinutes * 60_000)
          : undefined,
      },
    });
    return this.saveAutomationCheckpoint(run.sessionId, {
      checkpointId: nanoid(),
      runId,
      workflowState: run.workflowState,
      stage: run.currentStage,
      reason,
      snapshot,
      createdAt: now,
    });
  }

  resumeAutomation(runId: string, reason: string): TeamRunRecord | null {
    const gate = this.canAutomateAction(runId, "resume");
    if (!gate.ok) {
      return this.noteAutomationBlock(runId, "resume", gate.reason);
    }
    const run = gate.run;
    return this.updateTeamRun(runId, {
      automationState: {
        ...run.automationState,
        resumeCount: run.automationState.resumeCount + 1,
      },
      latestOutput: {
        ...(run.latestOutput ?? {}),
        resumeReason: reason,
      },
      status: "active",
    });
  }

  recordAutomationRetry(runId: string, reason: string): TeamRunRecord | null {
    const gate = this.canAutomateAction(runId, "retry");
    if (!gate.ok) {
      return this.noteAutomationBlock(runId, "retry", gate.reason);
    }
    const run = gate.run;
    const retryCount = Math.min(run.retryPolicy.maxRetries, run.automationState.retryCount + 1);
    return this.updateTeamRun(runId, {
      automationState: {
        ...run.automationState,
        retryCount,
      },
      latestOutput: {
        ...(run.latestOutput ?? {}),
        retryReason: reason,
        retryCount,
      },
    });
  }

  saveWorkflowTransition(sessionId: string, transition: WorkflowTransitionRecord): WorkflowTransitionRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO workflow_transitions (
         id, run_id, session_id, from_state, to_state, reason, rollback_of_transition_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      transition.transitionId,
      transition.runId,
      sessionId,
      transition.fromState,
      transition.toState,
      transition.reason,
      transition.rollbackOfTransitionId ?? null,
      transition.metadata ? JSON.stringify(transition.metadata) : null,
      transition.createdAt,
    );
    return transition;
  }

  listWorkflowTransitions(sessionId: string, runId: string): WorkflowTransitionRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM workflow_transitions
       WHERE session_id = ? AND run_id = ?
       ORDER BY created_at ASC`,
    ).all(sessionId, runId) as Record<string, unknown>[];
    return rows.map((row) => ({
      transitionId: row.id as string,
      runId: row.run_id as string,
      fromState: row.from_state as WorkflowTransitionRecord["fromState"],
      toState: row.to_state as WorkflowTransitionRecord["toState"],
      reason: row.reason as string,
      rollbackOfTransitionId: (row.rollback_of_transition_id as string | null) ?? undefined,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json as string) as Record<string, unknown>) : undefined,
      createdAt: row.created_at as number,
    }));
  }

  saveProposalBrief(sessionId: string, brief: ProposalBrief): ProposalBrief {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO proposal_briefs (id, session_id, title, status, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         status = excluded.status,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    ).run(
      brief.proposalId,
      sessionId,
      brief.title,
      brief.status,
      JSON.stringify(brief),
      now,
      now,
    );
    return brief;
  }

  saveProposalScorecard(sessionId: string, scorecard: ProposalScorecard): ProposalScorecard {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO proposal_scorecards (proposal_id, session_id, weighted_score, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(proposal_id) DO UPDATE SET
         weighted_score = excluded.weighted_score,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    ).run(
      scorecard.proposalId,
      sessionId,
      scorecard.decisionScore,
      JSON.stringify(scorecard),
      now,
      now,
    );
    return scorecard;
  }

  getProposalScorecard(proposalId: string): ProposalScorecard | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT payload_json FROM proposal_scorecards WHERE proposal_id = ?",
    ).get(proposalId) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as ProposalScorecard) : null;
  }

  listProposalBriefs(sessionId: string): ProposalBrief[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT payload_json FROM proposal_briefs WHERE session_id = ? ORDER BY updated_at DESC",
    ).all(sessionId) as Array<{ payload_json: string }>;
    return rows.map((row) => {
      const brief = JSON.parse(row.payload_json) as ProposalBrief;
      if (!brief.scorecard) {
        brief.scorecard = this.getProposalScorecard(brief.proposalId) ?? undefined;
      }
      return brief;
    });
  }

  saveDecisionRecord(sessionId: string, decision: DecisionRecord): DecisionRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO decision_records (
          id, session_id, proposal_id, simulation_id, decision_type, confidence, summary,
          reason_tags_json, evidence_links_json, supersedes_decision_id, created_by, created_at,
          drift_json, calibration_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          decision_type = excluded.decision_type,
          confidence = excluded.confidence,
          summary = excluded.summary,
          reason_tags_json = excluded.reason_tags_json,
          evidence_links_json = excluded.evidence_links_json,
          supersedes_decision_id = excluded.supersedes_decision_id,
          created_by = excluded.created_by,
          drift_json = excluded.drift_json,
          calibration_json = excluded.calibration_json`,
    ).run(
      decision.decisionId,
      sessionId,
      decision.proposalId,
      decision.simulationId ?? null,
      decision.decisionType,
      decision.confidence,
      decision.decisionSummary,
      JSON.stringify(decision.reasonTags),
      JSON.stringify(decision.evidenceLinks),
      decision.supersedesDecisionId ?? null,
      decision.createdBy,
      decision.createdAt,
      decision.drift ? JSON.stringify(decision.drift) : null,
      decision.calibration ? JSON.stringify(decision.calibration) : null,
    );
    return decision;
  }

  listDecisionRecords(sessionId: string, proposalId?: string): DecisionRecord[] {
    const db = getDb();
    const rows = proposalId
      ? db.prepare(
          `SELECT * FROM decision_records
           WHERE session_id = ? AND proposal_id = ?
           ORDER BY created_at DESC`,
        ).all(sessionId, proposalId)
      : db.prepare(
          `SELECT * FROM decision_records
           WHERE session_id = ?
           ORDER BY created_at DESC`,
        ).all(sessionId);
    return (rows as Record<string, unknown>[]).map((row) => ({
      decisionId: row.id as string,
      proposalId: row.proposal_id as string,
      simulationId: (row.simulation_id as string | null) ?? undefined,
      decisionType: row.decision_type as DecisionRecord["decisionType"],
      decisionSummary: row.summary as string,
      confidence: row.confidence as number,
      reasonTags: JSON.parse(row.reason_tags_json as string) as DecisionRecord["reasonTags"],
      createdAt: row.created_at as number,
      createdBy: row.created_by as string,
      evidenceLinks: JSON.parse(row.evidence_links_json as string) as string[],
      supersedesDecisionId: (row.supersedes_decision_id as string | null) ?? undefined,
      drift: row.drift_json ? (JSON.parse(row.drift_json as string) as DecisionRecord["drift"]) : undefined,
      calibration: row.calibration_json
        ? (JSON.parse(row.calibration_json as string) as DecisionRecord["calibration"])
        : undefined,
    }));
  }

  listDecisionRecordsByTag(sessionId: string, tag: string): DecisionRecord[] {
    return this.listDecisionRecords(sessionId).filter((decision) => decision.reasonTags.includes(tag as DecisionRecord["reasonTags"][number]));
  }

  getLatestDecisionRecord(sessionId: string, proposalId: string): DecisionRecord | null {
    return this.listDecisionRecords(sessionId, proposalId)[0] ?? null;
  }

  saveReconsiderationTrigger(sessionId: string, trigger: ReconsiderationTrigger): ReconsiderationTrigger {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO reconsideration_triggers (id, session_id, decision_id, trigger_type, trigger_condition, status, created_at, updated_at, satisfied_at, evidence_links_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
          trigger_type = excluded.trigger_type,
          trigger_condition = excluded.trigger_condition,
          status = excluded.status,
          satisfied_at = excluded.satisfied_at,
          evidence_links_json = excluded.evidence_links_json,
          updated_at = excluded.updated_at`,
    ).run(
      trigger.triggerId,
      sessionId,
      trigger.decisionId,
      trigger.triggerType,
      trigger.triggerCondition,
      trigger.status,
      now,
      now,
      trigger.satisfiedAt ?? null,
      trigger.evidenceLinks ? JSON.stringify(trigger.evidenceLinks) : null,
    );
    return trigger;
  }

  listReconsiderationTriggers(sessionId: string, proposalId?: string): ReconsiderationTrigger[] {
    const db = getDb();
    const rows = proposalId
      ? db.prepare(
          `SELECT rt.*
           FROM reconsideration_triggers rt
           JOIN decision_records dr ON dr.id = rt.decision_id
           WHERE rt.session_id = ? AND dr.proposal_id = ?
           ORDER BY rt.updated_at DESC`,
        ).all(sessionId, proposalId)
      : db.prepare(
          `SELECT * FROM reconsideration_triggers
           WHERE session_id = ?
           ORDER BY updated_at DESC`,
        ).all(sessionId);
    return (rows as Record<string, unknown>[]).map((row) => ({
      triggerId: row.id as string,
      decisionId: row.decision_id as string,
      triggerType: row.trigger_type as ReconsiderationTrigger["triggerType"],
      triggerCondition: row.trigger_condition as string,
      status: row.status as ReconsiderationTrigger["status"],
      satisfiedAt: (row.satisfied_at as number | null) ?? undefined,
      evidenceLinks: row.evidence_links_json
        ? (JSON.parse(row.evidence_links_json as string) as string[])
        : undefined,
    }));
  }

  listOpenReconsiderationTriggers(sessionId: string): ReconsiderationTriggerRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT rt.*, dr.proposal_id
       FROM reconsideration_triggers rt
       JOIN decision_records dr ON dr.id = rt.decision_id
       WHERE rt.session_id = ? AND rt.status = 'open'
       ORDER BY rt.updated_at DESC`,
    ).all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => ({
      triggerId: row.id as string,
      decisionId: row.decision_id as string,
      proposalId: row.proposal_id as string,
      triggerType: row.trigger_type as ReconsiderationTrigger["triggerType"],
      triggerCondition: row.trigger_condition as string,
      status: row.status as ReconsiderationTrigger["status"],
      satisfiedAt: (row.satisfied_at as number | null) ?? undefined,
      evidenceLinks: row.evidence_links_json
        ? (JSON.parse(row.evidence_links_json as string) as string[])
        : undefined,
    }));
  }

  updateReconsiderationTrigger(
    sessionId: string,
    triggerId: string,
    updates: Partial<Pick<ReconsiderationTrigger, "status" | "evidenceLinks" | "satisfiedAt">>,
  ): ReconsiderationTrigger | null {
    const current = this.listReconsiderationTriggers(sessionId).find((item) => item.triggerId === triggerId);
    if (!current) return null;
    return this.saveReconsiderationTrigger(sessionId, {
      ...current,
      status: updates.status ?? current.status,
      evidenceLinks: updates.evidenceLinks ?? current.evidenceLinks,
      satisfiedAt: updates.satisfiedAt ?? current.satisfiedAt,
    });
  }

  saveExperimentLineage(sessionId: string, lineage: ExperimentLineageRecord): ExperimentLineageRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO experiment_lineage (id, session_id, proposal_id, experiment_id, related_experiment_id, relation_type, summary, created_at, superseded_by_experiment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
          related_experiment_id = excluded.related_experiment_id,
          relation_type = excluded.relation_type,
          summary = excluded.summary,
          superseded_by_experiment_id = excluded.superseded_by_experiment_id`,
    ).run(
      lineage.lineageId,
      sessionId,
      lineage.proposalId,
      lineage.experimentId ?? null,
      lineage.relatedExperimentId ?? null,
      lineage.relationType,
      lineage.summary,
      lineage.createdAt,
      lineage.supersededByExperimentId ?? null,
    );
    return lineage;
  }

  listExperimentLineage(sessionId: string, proposalId?: string): ExperimentLineageRecord[] {
    const db = getDb();
    const rows = proposalId
      ? db.prepare(
          `SELECT * FROM experiment_lineage
           WHERE session_id = ? AND proposal_id = ?
           ORDER BY created_at DESC`,
        ).all(sessionId, proposalId)
      : db.prepare(
          `SELECT * FROM experiment_lineage
           WHERE session_id = ?
           ORDER BY created_at DESC`,
        ).all(sessionId);
    return (rows as Record<string, unknown>[]).map((row) => ({
      lineageId: row.id as string,
      proposalId: row.proposal_id as string,
      experimentId: (row.experiment_id as string | null) ?? undefined,
      relatedExperimentId: (row.related_experiment_id as string | null) ?? undefined,
      relationType: row.relation_type as ExperimentLineageRecord["relationType"],
      summary: row.summary as string,
      createdAt: row.created_at as number,
      supersededByExperimentId: (row.superseded_by_experiment_id as string | null) ?? undefined,
    }));
  }

  saveIngestionSource(sessionId: string, source: IngestionSourceRecord): IngestionSourceRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO ingestion_sources (
         id, session_id, source_type, title, url, status, extracted_candidate_id, notes,
         claim_count, linked_proposal_count, freshness_score, evidence_confidence,
          method_tags_json, claims_json, canonical_claims_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          extracted_candidate_id = excluded.extracted_candidate_id,
          notes = excluded.notes,
          claim_count = excluded.claim_count,
          linked_proposal_count = excluded.linked_proposal_count,
          freshness_score = excluded.freshness_score,
          evidence_confidence = excluded.evidence_confidence,
          method_tags_json = excluded.method_tags_json,
          claims_json = excluded.claims_json,
          canonical_claims_json = excluded.canonical_claims_json,
          updated_at = excluded.updated_at`,
    ).run(
      source.sourceId,
      sessionId,
      source.sourceType,
      source.title,
      source.url ?? null,
      source.status,
      source.extractedCandidateId ?? null,
      source.notes ?? null,
      source.claimCount ?? 0,
      source.linkedProposalCount ?? 0,
      source.freshnessScore ?? null,
      source.evidenceConfidence ?? null,
      source.methodTags ? JSON.stringify(source.methodTags) : null,
      source.extractedClaims ? JSON.stringify(source.extractedClaims) : null,
      source.canonicalClaims ? JSON.stringify(source.canonicalClaims) : null,
      source.createdAt,
      source.updatedAt,
    );
    return source;
  }

  listIngestionSources(sessionId: string): IngestionSourceRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM ingestion_sources WHERE session_id = ? ORDER BY updated_at DESC`,
    ).all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => ({
      sourceId: row.id as string,
      sourceType: row.source_type as IngestionSourceRecord["sourceType"],
      title: row.title as string,
      url: (row.url as string | null) ?? undefined,
      status: row.status as IngestionSourceRecord["status"],
      extractedCandidateId: (row.extracted_candidate_id as string | null) ?? undefined,
      notes: (row.notes as string | null) ?? undefined,
      claimCount: row.claim_count as number,
      linkedProposalCount: row.linked_proposal_count as number,
      freshnessScore: (row.freshness_score as number | null) ?? undefined,
      evidenceConfidence: (row.evidence_confidence as number | null) ?? undefined,
      methodTags: row.method_tags_json ? (JSON.parse(row.method_tags_json as string) as string[]) : undefined,
      extractedClaims: row.claims_json
        ? (JSON.parse(row.claims_json as string) as IngestionSourceRecord["extractedClaims"])
        : undefined,
      canonicalClaims: row.canonical_claims_json
        ? (JSON.parse(row.canonical_claims_json as string) as IngestionSourceRecord["canonicalClaims"])
        : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }));
  }

  getProposalBrief(sessionId: string, proposalId: string): ProposalBrief | null {
    return this.listProposalBriefs(sessionId).find((brief) => brief.proposalId === proposalId) ?? null;
  }

  summarizeClaims(sessionId: string, claimIds: string[]): ClaimSupportSummary {
    const normalizedIds = claimIds.map((claimId) => resolveCanonicalClaimReference(claimId));
    const canonicalClaims = this.listIngestionSources(sessionId)
      .flatMap((source) => source.canonicalClaims ?? [])
      .filter((claim) => normalizedIds.includes(resolveCanonicalClaimReference(claim.canonicalClaimId)));

    const evidenceStrength = average(canonicalClaims.map((claim) => claim.confidence));
    const freshnessScore = average(canonicalClaims.map((claim) => claim.freshnessScore));
    const contradictionPressure = average(canonicalClaims.map((claim) => {
      const contradictionCount = claim.contradictionTags.length;
      const supportCount = Math.max(1, claim.supportTags.length + claim.evidenceIds.length);
      return contradictionCount === 0 ? 0 : Math.min(1, contradictionCount / supportCount);
    }));
    const sourceCoverage = canonicalClaims.length === 0
      ? 0
      : average(canonicalClaims.map((claim) => Math.min(1, claim.sourceIds.length / 3)));

    return {
      claimIds: normalizedIds,
      sourceCoverage,
      evidenceStrength,
      freshnessScore,
      contradictionPressure,
      unresolvedClaims: normalizedIds.filter((claimId) => !canonicalClaims.some((claim) => resolveCanonicalClaimReference(claim.canonicalClaimId) === claimId)),
    };
  }

  updateProposalBrief(sessionId: string, proposalId: string, updates: Partial<ProposalBrief>): ProposalBrief | null {
    const current = this.getProposalBrief(sessionId, proposalId);
    if (!current) return null;
    const next = {
      ...current,
      ...updates,
    } satisfies ProposalBrief;
    return this.saveProposalBrief(sessionId, next);
  }

  listRevisitDueProposals(sessionId: string): ProposalBrief[] {
    return this.listProposalBriefs(sessionId).filter((proposal) => proposal.status === "revisit_due");
  }

  listBudgetAnomalies(sessionId: string): BudgetAnomalyRecord[] {
    const simulations = this.listRecentSimulationRuns(sessionId, 100);
    const decisions = this.listDecisionRecords(sessionId);
    return simulations
      .filter((simulation) => simulation.result?.outcomeStatus === "budget_exceeded")
      .map((simulation) => ({
        experimentId: simulation.id,
        proposalId: simulation.proposalId,
        decisionId: decisions.find((decision) => decision.simulationId === simulation.id)?.decisionId,
        findings: simulation.result?.surprisingFindings ?? [],
        notes: simulation.result?.notes,
        createdAt: simulation.updatedAt,
      }));
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

  listRecentSimulationRuns(sessionId: string, limit = 5): SimulationRunRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM simulation_runs
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    ).all(sessionId, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      proposalId: row.proposal_id as string,
      taskKey: (row.task_key as string | null) ?? undefined,
      status: row.status as string,
      charter: JSON.parse(row.charter_json as string) as ExperimentCharter,
      budget: row.budget_json ? (JSON.parse(row.budget_json as string) as ExperimentBudget) : undefined,
      result: row.result_json ? (JSON.parse(row.result_json as string) as ExperimentResult) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }));
  }

  listRunningSimulationRuns(sessionId: string): SimulationRunRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM simulation_runs
       WHERE session_id = ? AND status = 'running'
       ORDER BY updated_at DESC`,
    ).all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      proposalId: row.proposal_id as string,
      taskKey: (row.task_key as string | null) ?? undefined,
      status: row.status as string,
      charter: JSON.parse(row.charter_json as string) as ExperimentCharter,
      budget: row.budget_json ? (JSON.parse(row.budget_json as string) as ExperimentBudget) : undefined,
      result: row.result_json ? (JSON.parse(row.result_json as string) as ExperimentResult) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }));
  }

  createSimulationRun(
    sessionId: string,
    proposalId: string,
    charter: ExperimentCharter,
  ): SimulationRunRecord {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();
    db.prepare(
      `INSERT INTO simulation_runs (id, session_id, proposal_id, task_key, status, charter_json, budget_json, result_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      sessionId,
      proposalId,
      null,
      "pending",
      JSON.stringify(charter),
      charter.budget ? JSON.stringify(charter.budget) : null,
      null,
      now,
      now,
    );

    return {
      id,
      sessionId,
      proposalId,
      status: "pending",
      charter,
      budget: charter.budget,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateSimulationRun(
    id: string,
    updates: {
      taskKey?: string;
      status?: string;
      result?: ExperimentResult;
    },
  ): SimulationRunRecord | null {
    const current = this.getSimulationRun(id);
    if (!current) return null;
    const next: SimulationRunRecord = {
      ...current,
      taskKey: updates.taskKey ?? current.taskKey,
      status: updates.status ?? current.status,
      result: updates.result ?? current.result,
      updatedAt: Date.now(),
    };
    const db = getDb();
    db.prepare(
      `UPDATE simulation_runs
       SET task_key = ?, status = ?, result_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      next.taskKey ?? null,
      next.status,
      next.result ? JSON.stringify(next.result) : null,
      next.updatedAt,
      id,
    );
    return next;
  }

  getSimulationRun(id: string): SimulationRunRecord | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM simulation_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      proposalId: row.proposal_id as string,
      taskKey: (row.task_key as string | null) ?? undefined,
      status: row.status as string,
      charter: JSON.parse(row.charter_json as string) as ExperimentCharter,
      budget: row.budget_json ? (JSON.parse(row.budget_json as string) as ExperimentBudget) : undefined,
      result: row.result_json ? (JSON.parse(row.result_json as string) as ExperimentResult) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
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
      ? (JSON.parse(row.automation_policy_json) as AutomationPolicy)
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
      ? (JSON.parse(row.automation_state_json) as AutomationRuntimeState)
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

function average(values: Array<number | undefined>): number {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
