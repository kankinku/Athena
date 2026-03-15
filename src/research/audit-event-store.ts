/**
 * audit-event-store.ts
 *
 * 파이프라인 감사 이벤트의 DB 영속화.
 * 모든 proposal/meeting/execution/verification 행동을 추적한다.
 */

import { getDb } from "../store/database.js";
import type { AuditEvent } from "./contracts.js";

export class AuditEventStore {
  /**
   * 감사 이벤트를 DB에 저장한다.
   */
  save(event: AuditEvent): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO audit_events (
         event_id, event_type, entity_type, entity_id,
         actor, action, proposal_id, meeting_id, agent_id, module_id,
         details_json, severity, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.eventId,
      event.eventType,
      event.details?.entityType as string ?? null,
      event.details?.entityId as string ?? null,
      event.details?.actor as string ?? "system",
      event.eventType,
      event.proposalId ?? null,
      event.meetingId ?? null,
      event.agentId ?? null,
      event.moduleId ?? null,
      JSON.stringify(event.details),
      event.severity,
      event.timestamp,
    );
  }

  /**
   * 여러 이벤트를 한 번에 저장한다 (트랜잭션).
   */
  saveBatch(events: AuditEvent[]): void {
    if (events.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO audit_events (
         event_id, event_type, entity_type, entity_id,
         actor, action, proposal_id, meeting_id, agent_id, module_id,
         details_json, severity, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (const event of events) {
        stmt.run(
          event.eventId,
          event.eventType,
          event.details?.entityType as string ?? null,
          event.details?.entityId as string ?? null,
          event.details?.actor as string ?? "system",
          event.eventType,
          event.proposalId ?? null,
          event.meetingId ?? null,
          event.agentId ?? null,
          event.moduleId ?? null,
          JSON.stringify(event.details),
          event.severity,
          event.timestamp,
        );
      }
    })();
  }

  /**
   * proposal ID로 감사 이벤트를 조회한다.
   */
  listByProposal(proposalId: string): AuditEvent[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM audit_events WHERE proposal_id = ? ORDER BY created_at ASC",
    ).all(proposalId) as AuditEventRow[];
    return rows.map(rowToEvent);
  }

  /**
   * 이벤트 타입으로 조회한다.
   */
  listByType(eventType: string, limit = 100): AuditEvent[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM audit_events WHERE event_type = ? ORDER BY created_at DESC LIMIT ?",
    ).all(eventType, limit) as AuditEventRow[];
    return rows.map(rowToEvent);
  }

  /**
   * 최근 이벤트를 조회한다.
   */
  listRecent(limit = 50): AuditEvent[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?",
    ).all(limit) as AuditEventRow[];
    return rows.map(rowToEvent);
  }

  /**
   * 특정 엔티티(proposal/meeting/task)의 이벤트를 조회한다.
   */
  listByEntity(entityType: string, entityId: string): AuditEvent[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC",
    ).all(entityType, entityId) as AuditEventRow[];
    return rows.map(rowToEvent);
  }

  /**
   * 감사 요약 통계를 반환한다.
   */
  summarize(): AuditSummary {
    const db = getDb();
    const row = db.prepare(
      `SELECT
         COUNT(*) as total,
         COUNT(DISTINCT proposal_id) as proposals,
         COUNT(DISTINCT meeting_id) as meetings,
         MAX(created_at) as last_event_at
       FROM audit_events`,
    ).get() as { total: number; proposals: number; meetings: number; last_event_at: number | null };

    const byType = db.prepare(
      "SELECT event_type, COUNT(*) as count FROM audit_events GROUP BY event_type ORDER BY count DESC",
    ).all() as Array<{ event_type: string; count: number }>;

    return {
      total: row.total,
      proposalCount: row.proposals,
      meetingCount: row.meetings,
      lastEventAt: row.last_event_at ?? 0,
      byType: Object.fromEntries(byType.map((r) => [r.event_type, r.count])),
    };
  }
}

export interface AuditSummary {
  total: number;
  proposalCount: number;
  meetingCount: number;
  lastEventAt: number;
  byType: Record<string, number>;
}

interface AuditEventRow {
  event_id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  actor: string;
  action: string;
  proposal_id: string | null;
  meeting_id: string | null;
  agent_id: string | null;
  module_id: string | null;
  details_json: string;
  severity: string;
  created_at: number;
}

function rowToEvent(row: AuditEventRow): AuditEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    proposalId: row.proposal_id ?? undefined,
    meetingId: row.meeting_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    moduleId: row.module_id ?? undefined,
    details: JSON.parse(row.details_json || "{}"),
    severity: row.severity as AuditEvent["severity"],
    timestamp: row.created_at,
  };
}
