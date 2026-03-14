import { getDb } from "../store/database.js";
import type { IncidentRecord } from "./contracts.js";

export class IncidentStore {
  saveIncident(incident: IncidentRecord): IncidentRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO research_incidents (
         id, session_id, run_id, proposal_id, experiment_id, type, severity, summary, details,
         status, action_required, related_action_id, related_decision_id, metadata_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         proposal_id = excluded.proposal_id,
         experiment_id = excluded.experiment_id,
         type = excluded.type,
         severity = excluded.severity,
         summary = excluded.summary,
         details = excluded.details,
         status = excluded.status,
         action_required = excluded.action_required,
         related_action_id = excluded.related_action_id,
         related_decision_id = excluded.related_decision_id,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).run(
      incident.incidentId,
      incident.sessionId,
      incident.runId,
      incident.proposalId ?? null,
      incident.experimentId ?? null,
      incident.type,
      incident.severity,
      incident.summary,
      incident.details ?? null,
      incident.status,
      incident.actionRequired ? 1 : 0,
      incident.relatedActionId ?? null,
      incident.relatedDecisionId ?? null,
      incident.metadata ? JSON.stringify(incident.metadata) : null,
      incident.createdAt,
      incident.updatedAt,
    );
    return incident;
  }

  listIncidents(sessionId: string, runId?: string): IncidentRecord[] {
    const db = getDb();
    const rows = runId
      ? db.prepare(`SELECT * FROM research_incidents WHERE session_id = ? AND run_id = ? ORDER BY updated_at DESC`).all(sessionId, runId)
      : db.prepare(`SELECT * FROM research_incidents WHERE session_id = ? ORDER BY updated_at DESC`).all(sessionId);
    return (rows as Array<Record<string, unknown>>).map(mapIncidentRecord);
  }

  listOpenIncidents(sessionId: string): IncidentRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM research_incidents
       WHERE session_id = ? AND status = 'open'
       ORDER BY severity DESC, updated_at DESC`,
    ).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(mapIncidentRecord);
  }

  resolveRunIncidents(sessionId: string, runId: string): number {
    const db = getDb();
    return db.prepare(
      `UPDATE research_incidents
       SET status = 'resolved', action_required = 0, updated_at = ?
       WHERE session_id = ? AND run_id = ? AND status != 'resolved'`,
    ).run(Date.now(), sessionId, runId).changes;
  }
}

function mapIncidentRecord(row: Record<string, unknown>): IncidentRecord {
  return {
    incidentId: row.id as string,
    sessionId: row.session_id as string,
    runId: row.run_id as string,
    proposalId: (row.proposal_id as string | null) ?? undefined,
    experimentId: (row.experiment_id as string | null) ?? undefined,
    type: row.type as IncidentRecord["type"],
    severity: row.severity as IncidentRecord["severity"],
    summary: row.summary as string,
    details: (row.details as string | null) ?? undefined,
    status: row.status as IncidentRecord["status"],
    actionRequired: Boolean(row.action_required),
    relatedActionId: (row.related_action_id as string | null) ?? undefined,
    relatedDecisionId: (row.related_decision_id as string | null) ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json as string) as Record<string, unknown> : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}
