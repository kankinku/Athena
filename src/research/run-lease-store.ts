import { nanoid } from "nanoid";
import { getDb } from "../store/database.js";
import type { RunLeaseRecord } from "./contracts.js";

export class RunLeaseStore {
  acquireLease(sessionId: string, runId: string, ownerId: string, ttlMs = 300_000): RunLeaseRecord | null {
    const db = getDb();
    const now = Date.now();
    const existing = this.getLease(sessionId, runId);
    const active = existing?.status === "active" && existing.expiresAt > now;
    if (active && existing.ownerId !== ownerId) {
      return null;
    }
    const lease: RunLeaseRecord = {
      leaseId: active && existing?.ownerId === ownerId ? existing.leaseId : nanoid(),
      sessionId,
      runId,
      ownerId,
      status: "active",
      acquiredAt: active && existing?.ownerId === ownerId ? existing.acquiredAt : now,
      heartbeatAt: now,
      expiresAt: now + ttlMs,
      releasedAt: undefined,
    };

    db.prepare(
      `INSERT INTO research_run_leases (
         lease_id, session_id, run_id, owner_id, status, acquired_at, heartbeat_at, expires_at, released_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         lease_id = excluded.lease_id,
         owner_id = excluded.owner_id,
         status = excluded.status,
         acquired_at = excluded.acquired_at,
         heartbeat_at = excluded.heartbeat_at,
         expires_at = excluded.expires_at,
         released_at = excluded.released_at`,
    ).run(
      lease.leaseId,
      lease.sessionId,
      lease.runId,
      lease.ownerId,
      lease.status,
      lease.acquiredAt,
      lease.heartbeatAt,
      lease.expiresAt,
      null,
    );
    return lease;
  }

  heartbeatLease(runId: string, ownerId: string, ttlMs = 300_000): RunLeaseRecord | null {
    const existing = this.getLeaseByRunId(runId);
    if (!existing || existing.status !== "active" || existing.ownerId !== ownerId || existing.expiresAt <= Date.now()) return null;
    return this.acquireLease(existing.sessionId, existing.runId, existing.ownerId, ttlMs);
  }

  releaseLease(runId: string, ownerId?: string): RunLeaseRecord | null {
    const db = getDb();
    const existing = this.getLeaseByRunId(runId);
    if (!existing) return null;
    if (ownerId && existing.ownerId !== ownerId) return null;
    const released: RunLeaseRecord = {
      ...existing,
      status: "released",
      releasedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    db.prepare(
      `UPDATE research_run_leases
       SET status = ?, heartbeat_at = ?, released_at = ?
       WHERE run_id = ?`,
    ).run(released.status, released.heartbeatAt, released.releasedAt, runId);
    return released;
  }

  getLease(sessionId: string, runId: string): RunLeaseRecord | null {
    const db = getDb();
    const row = db.prepare(
      `SELECT * FROM research_run_leases WHERE session_id = ? AND run_id = ?`,
    ).get(sessionId, runId) as Record<string, unknown> | undefined;
    return row ? mapRunLeaseRecord(row) : null;
  }

  listActiveLeases(sessionId: string): RunLeaseRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM research_run_leases
       WHERE session_id = ? AND status = 'active' AND expires_at > ?
       ORDER BY heartbeat_at DESC`,
    ).all(sessionId, Date.now()) as Array<Record<string, unknown>>;
    return rows.map(mapRunLeaseRecord);
  }

  private getLeaseByRunId(runId: string): RunLeaseRecord | null {
    const db = getDb();
    const row = db.prepare(
      `SELECT * FROM research_run_leases WHERE run_id = ?`,
    ).get(runId) as Record<string, unknown> | undefined;
    return row ? mapRunLeaseRecord(row) : null;
  }
}

function mapRunLeaseRecord(row: Record<string, unknown>): RunLeaseRecord {
  return {
    leaseId: row.lease_id as string,
    sessionId: row.session_id as string,
    runId: row.run_id as string,
    ownerId: row.owner_id as string,
    status: row.status as RunLeaseRecord["status"],
    acquiredAt: row.acquired_at as number,
    heartbeatAt: row.heartbeat_at as number,
    expiresAt: row.expires_at as number,
    releasedAt: (row.released_at as number | null) ?? undefined,
  };
}
