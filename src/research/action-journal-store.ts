import { getDb } from "../store/database.js";
import type { ActionJournalRecord } from "./contracts.js";

export class ActionJournalStore {
  saveAction(action: ActionJournalRecord): ActionJournalRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO research_action_journal (
         id, session_id, run_id, action_type, state, dedupe_key, lease_id, summary,
         payload_json, result_json, error, created_at, updated_at, heartbeat_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      action.actionId,
      action.sessionId,
      action.runId,
      action.actionType,
      action.state,
      action.dedupeKey,
      action.leaseId ?? null,
      action.summary,
      action.payload ? JSON.stringify(action.payload) : null,
      action.result ? JSON.stringify(action.result) : null,
      action.error ?? null,
      action.createdAt,
      action.updatedAt,
      action.heartbeatAt ?? null,
    );
    return action;
  }

  listRunActions(sessionId: string, runId: string): ActionJournalRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM research_action_journal
       WHERE session_id = ? AND run_id = ?
       ORDER BY created_at DESC, id DESC`,
    ).all(sessionId, runId) as Array<Record<string, unknown>>;
    return rows.map(mapActionJournalRecord);
  }

  listSessionActions(sessionId: string, limit = 50): ActionJournalRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM research_action_journal
       WHERE session_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    ).all(sessionId, limit) as Array<Record<string, unknown>>;
    return rows.map(mapActionJournalRecord);
  }

  getActionByDedupeKey(sessionId: string, runId: string, dedupeKey: string): ActionJournalRecord | null {
    const db = getDb();
    const row = db.prepare(
      `SELECT * FROM research_action_journal
       WHERE session_id = ? AND run_id = ? AND dedupe_key = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    ).get(sessionId, runId, dedupeKey) as Record<string, unknown> | undefined;
    return row ? mapActionJournalRecord(row) : null;
  }
}

function mapActionJournalRecord(row: Record<string, unknown>): ActionJournalRecord {
  return {
    actionId: row.id as string,
    sessionId: row.session_id as string,
    runId: row.run_id as string,
    actionType: row.action_type as ActionJournalRecord["actionType"],
    state: row.state as ActionJournalRecord["state"],
    dedupeKey: row.dedupe_key as string,
    leaseId: (row.lease_id as string | null) ?? undefined,
    summary: row.summary as string,
    payload: row.payload_json ? JSON.parse(row.payload_json as string) as Record<string, unknown> : undefined,
    result: row.result_json ? JSON.parse(row.result_json as string) as Record<string, unknown> : undefined,
    error: (row.error as string | null) ?? undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    heartbeatAt: (row.heartbeat_at as number | null) ?? undefined,
  };
}
