import { getDb } from "../store/database.js";
import type {
  DecisionRecord,
  ReconsiderationTrigger,
} from "./contracts.js";
import type { ReconsiderationTriggerRecord } from "./team-store.js";

export class DecisionStore {
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
}
