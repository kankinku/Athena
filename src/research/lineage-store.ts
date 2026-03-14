import { getDb } from "../store/database.js";
import type { ExperimentLineageRecord } from "./contracts.js";

export class LineageStore {
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
}
