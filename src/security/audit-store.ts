import { getDb } from "../store/database.js";
import type { SecurityAuditRecord, SecurityAuditSummary } from "./contracts.js";

export class SecurityAuditStore {
  saveDecision(record: SecurityAuditRecord): SecurityAuditRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO security_decisions (
        id, subject_kind, subject, verdict, reason, matched_pattern, intent,
        actor_role, actor_id, actor_tier, action_class, session_id, run_id, machine_id, tool_name, tool_family,
        network_access, destructive, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.decisionId,
      record.subjectKind,
      record.subject,
      record.verdict,
      record.reason,
      record.matchedPattern ?? null,
      record.intent ?? null,
      record.actorRole ?? null,
      record.actorId ?? null,
      record.actorTier ?? null,
      record.actionClass ?? null,
      record.sessionId ?? null,
      record.runId ?? null,
      record.machineId ?? null,
      record.toolName ?? null,
      record.toolFamily ?? null,
      record.networkAccess === undefined ? null : Number(record.networkAccess),
      record.destructive === undefined ? null : Number(record.destructive),
      record.createdAt,
    );
    return record;
  }

  listRecent(limit = 20): SecurityAuditRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM security_decisions
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      decisionId: row.id as string,
      subjectKind: row.subject_kind as SecurityAuditRecord["subjectKind"],
      subject: row.subject as string,
      verdict: row.verdict as SecurityAuditRecord["verdict"],
      reason: row.reason as string,
      matchedPattern: row.matched_pattern as string | undefined,
      intent: row.intent as SecurityAuditRecord["intent"],
      actorRole: row.actor_role as SecurityAuditRecord["actorRole"],
      actorId: row.actor_id as string | undefined,
      actorTier: row.actor_tier as SecurityAuditRecord["actorTier"],
      actionClass: row.action_class as SecurityAuditRecord["actionClass"],
      sessionId: row.session_id as string | undefined,
      runId: row.run_id as string | undefined,
      machineId: row.machine_id as string | undefined,
      toolName: row.tool_name as string | undefined,
      toolFamily: row.tool_family as SecurityAuditRecord["toolFamily"],
      networkAccess: row.network_access === null ? undefined : Boolean(row.network_access),
      destructive: row.destructive === null ? undefined : Boolean(row.destructive),
      createdAt: row.created_at as number,
    }));
  }

  summarize(): SecurityAuditSummary {
    const db = getDb();
    const row = db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN verdict = 'allow' THEN 1 ELSE 0 END) AS allow_count,
         SUM(CASE WHEN verdict = 'review' THEN 1 ELSE 0 END) AS review_count,
         SUM(CASE WHEN verdict = 'block' THEN 1 ELSE 0 END) AS block_count,
         MAX(created_at) AS last_decision_at
       FROM security_decisions`,
    ).get() as
      | {
        total: number;
        allow_count: number | null;
        review_count: number | null;
        block_count: number | null;
        last_decision_at: number | null;
      }
      | undefined;

    return {
      total: row?.total ?? 0,
      allow: row?.allow_count ?? 0,
      review: row?.review_count ?? 0,
      block: row?.block_count ?? 0,
      lastDecisionAt: row?.last_decision_at ?? undefined,
    };
  }
}
