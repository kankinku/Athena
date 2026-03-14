import { getDb } from "../store/database.js";
import type {
  ImprovementEvaluationRecord,
  ImprovementProposalRecord,
  ImprovementReviewAction,
} from "./contracts.js";

export class ImprovementStore {
  saveImprovementProposal(sessionId: string, proposal: ImprovementProposalRecord): ImprovementProposalRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO improvement_proposals (
         id, session_id, run_id, proposal_id, experiment_id, title, target_area, status, payload_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    ).run(
      proposal.improvementId,
      sessionId,
      proposal.runId,
      proposal.proposalId ?? null,
      proposal.experimentId ?? null,
      proposal.title,
      proposal.targetArea,
      proposal.status,
      JSON.stringify(proposal),
      proposal.createdAt,
      proposal.updatedAt,
    );
    return proposal;
  }

  listImprovementProposals(sessionId: string, runId?: string): ImprovementProposalRecord[] {
    const db = getDb();
    const rows = runId
      ? db.prepare(`SELECT payload_json FROM improvement_proposals WHERE session_id = ? AND run_id = ? ORDER BY updated_at DESC`).all(sessionId, runId)
      : db.prepare(`SELECT payload_json FROM improvement_proposals WHERE session_id = ? ORDER BY updated_at DESC`).all(sessionId);
    return (rows as Array<Record<string, unknown>>).map((row) => JSON.parse(row.payload_json as string) as ImprovementProposalRecord);
  }

  reviewImprovementProposal(
    sessionId: string,
    improvementId: string,
    action: ImprovementReviewAction,
  ): ImprovementProposalRecord {
    const proposal = this.listImprovementProposals(sessionId).find((item) => item.improvementId === improvementId);
    if (!proposal) {
      throw new Error(`Improvement proposal not found: ${improvementId}`);
    }

    const nextReviewStatus = nextImprovementReviewStatus(proposal.reviewStatus, action);
    const nextStatus = nextImprovementProposalStatus(proposal.status, action);
    const updated: ImprovementProposalRecord = {
      ...proposal,
      reviewStatus: nextReviewStatus,
      status: nextStatus,
      updatedAt: Date.now(),
    };

    const duplicates = this.listImprovementProposals(sessionId)
      .filter((item) => item.improvementId !== proposal.improvementId && item.mergeKey === proposal.mergeKey);

    for (const duplicate of duplicates) {
      if (action === "promote") {
        this.saveImprovementProposal(sessionId, {
          ...duplicate,
          reviewStatus: "dismissed",
          status: duplicate.status === "rolled_back" ? duplicate.status : "rejected",
          updatedAt: updated.updatedAt,
        });
      }
    }

    return this.saveImprovementProposal(sessionId, updated);
  }

  saveImprovementEvaluation(sessionId: string, evaluation: ImprovementEvaluationRecord): ImprovementEvaluationRecord {
    const db = getDb();
    db.prepare(
      `INSERT INTO improvement_evaluations (
         id, session_id, improvement_id, run_id, experiment_id, outcome, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      evaluation.evaluationId,
      sessionId,
      evaluation.improvementId ?? null,
      evaluation.runId,
      evaluation.experimentId ?? null,
      evaluation.outcome,
      JSON.stringify(evaluation),
      evaluation.createdAt,
    );
    return evaluation;
  }

  listImprovementEvaluations(sessionId: string, runId?: string): ImprovementEvaluationRecord[] {
    const db = getDb();
    const rows = runId
      ? db.prepare(`SELECT payload_json FROM improvement_evaluations WHERE session_id = ? AND run_id = ? ORDER BY created_at DESC`).all(sessionId, runId)
      : db.prepare(`SELECT payload_json FROM improvement_evaluations WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId);
    return (rows as Array<Record<string, unknown>>).map((row) => JSON.parse(row.payload_json as string) as ImprovementEvaluationRecord);
  }
}

function nextImprovementReviewStatus(
  current: ImprovementProposalRecord["reviewStatus"],
  action: ImprovementReviewAction,
): ImprovementProposalRecord["reviewStatus"] {
  switch (action) {
    case "queue":
      if (current === "promoted" || current === "dismissed") {
        throw new Error(`Cannot queue improvement from terminal review state: ${current}`);
      }
      return "queued";
    case "start_review":
      if (current === "promoted" || current === "dismissed") {
        throw new Error(`Cannot start review from terminal review state: ${current}`);
      }
      return "in_review";
    case "promote":
      if (current === "dismissed") {
        throw new Error("Cannot promote a dismissed improvement proposal");
      }
      return "promoted";
    case "dismiss":
      if (current === "promoted") {
        throw new Error("Cannot dismiss a promoted improvement proposal");
      }
      return "dismissed";
  }
}

function nextImprovementProposalStatus(
  current: ImprovementProposalRecord["status"],
  action: ImprovementReviewAction,
): ImprovementProposalRecord["status"] {
  switch (action) {
    case "queue":
    case "start_review":
      return current;
    case "promote":
      if (current === "rolled_back") {
        throw new Error("Cannot promote a rolled back improvement proposal");
      }
      return "approved";
    case "dismiss":
      return current === "rolled_back" ? current : "rejected";
  }
}
