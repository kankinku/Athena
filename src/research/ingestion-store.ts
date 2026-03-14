import { getDb } from "../store/database.js";
import type { IngestionSourceRecord } from "./contracts.js";

export class IngestionStore {
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
}
