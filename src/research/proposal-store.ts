import { getDb } from "../store/database.js";
import type {
  ProposalBrief,
  ProposalReviewAction,
  ProposalScorecard,
} from "./contracts.js";

export class ProposalStore {
  saveProposalBrief(sessionId: string, brief: ProposalBrief): ProposalBrief {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO proposal_briefs (id, session_id, title, status, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         status = excluded.status,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    ).run(
      brief.proposalId,
      sessionId,
      brief.title,
      brief.status,
      JSON.stringify(brief),
      now,
      now,
    );
    return brief;
  }

  reviewProposalBrief(
    sessionId: string,
    proposalId: string,
    action: ProposalReviewAction,
  ): ProposalBrief {
    const proposal = this.getProposalBrief(sessionId, proposalId);
    if (!proposal) {
      throw new Error(`Proposal brief not found: ${proposalId}`);
    }

    // Evidence gate: approve/scope_trial requires at least one claim link.
    // A proposal without evidence is not evidence-grounded selection — it is
    // an assumption, and assumptions are not allowed to reach execution.
    if ((action === "approve" || action === "scope_trial") && proposal.claimIds.length === 0) {
      throw new Error(
        `Cannot ${action} proposal ${proposalId}: no evidence links (claimIds is empty). ` +
        "Run evidence collection and link at least one claim before promoting this proposal.",
      );
    }

    const nextStatus = nextProposalStatus(proposal.status, action);
    const updated: ProposalBrief = {
      ...proposal,
      status: nextStatus,
    };
    return this.saveProposalBrief(sessionId, updated);
  }

  saveProposalScorecard(sessionId: string, scorecard: ProposalScorecard): ProposalScorecard {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO proposal_scorecards (proposal_id, session_id, weighted_score, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(proposal_id) DO UPDATE SET
         weighted_score = excluded.weighted_score,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    ).run(
      scorecard.proposalId,
      sessionId,
      scorecard.decisionScore,
      JSON.stringify(scorecard),
      now,
      now,
    );
    return scorecard;
  }

  getProposalScorecard(proposalId: string): ProposalScorecard | null {
    const db = getDb();
    const row = db.prepare(
      "SELECT payload_json FROM proposal_scorecards WHERE proposal_id = ?",
    ).get(proposalId) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as ProposalScorecard) : null;
  }

  listProposalBriefs(sessionId: string): ProposalBrief[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT payload_json FROM proposal_briefs WHERE session_id = ? ORDER BY updated_at DESC",
    ).all(sessionId) as Array<{ payload_json: string }>;
    return rows.map((row) => {
      const brief = JSON.parse(row.payload_json) as ProposalBrief;
      if (!brief.scorecard) {
        brief.scorecard = this.getProposalScorecard(brief.proposalId) ?? undefined;
      }
      return brief;
    });
  }

  getProposalBrief(sessionId: string, proposalId: string): ProposalBrief | null {
    return this.listProposalBriefs(sessionId).find((brief) => brief.proposalId === proposalId) ?? null;
  }

  updateProposalBrief(sessionId: string, proposalId: string, updates: Partial<ProposalBrief>): ProposalBrief | null {
    const current = this.getProposalBrief(sessionId, proposalId);
    if (!current) return null;
    const next = {
      ...current,
      ...updates,
    } satisfies ProposalBrief;
    return this.saveProposalBrief(sessionId, next);
  }

  listRevisitDueProposals(sessionId: string): ProposalBrief[] {
    return this.listProposalBriefs(sessionId).filter((proposal) => proposal.status === "revisit_due");
  }
}

function nextProposalStatus(
  current: ProposalBrief["status"],
  action: ProposalReviewAction,
): ProposalBrief["status"] {
  switch (action) {
    case "approve":
      if (current === "archived") {
        throw new Error("Cannot approve an archived proposal");
      }
      return "ready_for_experiment";
    case "scope_trial":
      if (current === "archived") {
        throw new Error("Cannot scope a trial for an archived proposal");
      }
      return "scoped_trial";
    case "defer":
      if (current === "archived") {
        throw new Error("Cannot defer an archived proposal");
      }
      return "deferred";
    case "revisit":
      if (current === "archived") {
        throw new Error("Cannot revisit an archived proposal");
      }
      return "revisit_due";
    case "archive":
      return "archived";
  }
}
