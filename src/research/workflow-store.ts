import { getDb } from "../store/database.js";
import type { WorkflowTransitionRecord } from "./contracts.js";

export class WorkflowStore {
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
}
