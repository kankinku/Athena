import { getDb } from "../store/database.js";
import type { AutomationCheckpointRecord } from "./contracts.js";

export class AutomationStore {
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
}
