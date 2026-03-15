/**
 * `athena history` — 전체 이력 타임라인 뷰.
 *
 * 시간순으로 proposals, meetings, executions, verifications 이벤트를 통합 표시한다.
 *
 * Filters:
 *   --module <id>     모듈별 필터
 *   --state <state>   상태별 필터
 *   --from <epoch>    시작 시간 (epoch ms)
 *   --to <epoch>      종료 시간 (epoch ms)
 *   --limit <n>       최대 출력 건수 (기본 50)
 */

import { Effect, Option } from "effect";
import { Command, Options } from "@effect/cli";

const moduleFilter = Options.text("module").pipe(
  Options.withDescription("Filter by module ID"),
  Options.optional,
);

const stateFilter = Options.text("state").pipe(
  Options.withDescription("Filter by workflow state"),
  Options.optional,
);

const fromFilter = Options.text("from").pipe(
  Options.withDescription("Start time (epoch ms or ISO string)"),
  Options.optional,
);

const toFilter = Options.text("to").pipe(
  Options.withDescription("End time (epoch ms or ISO string)"),
  Options.optional,
);

const limitOpt = Options.integer("limit").pipe(
  Options.withDescription("Maximum number of entries (default: 50)"),
  Options.withDefault(50),
);

export const history = Command.make(
  "history",
  { module: moduleFilter, state: stateFilter, from: fromFilter, to: toFilter, limit: limitOpt },
  (opts) =>
    Effect.promise(async () => {
      const { getDb } = await import("../store/database.js");
      const db = getDb();

      const moduleVal = Option.getOrUndefined(opts.module);
      const stateVal = Option.getOrUndefined(opts.state);
      const fromVal = Option.getOrUndefined(opts.from);
      const toVal = Option.getOrUndefined(opts.to);
      const limit = opts.limit;

      const fromTime = fromVal ? parseTime(fromVal) : 0;
      const toTime = toVal ? parseTime(toVal) : Date.now();

      // 1. Proposals
      const proposals = db.prepare(`
        SELECT id, title, change_workflow_state AS state, created_at, updated_at
        FROM proposal_briefs
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
      `).all(fromTime, toTime) as Array<{
        id: string; title: string; state: string; created_at: number; updated_at: number
      }>;

      // 2. Meetings
      const meetings = db.prepare(`
        SELECT meeting_id, proposal_id, state, current_round, created_at, updated_at
        FROM meeting_sessions
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
      `).all(fromTime, toTime) as Array<{
        meeting_id: string; proposal_id: string; state: string;
        current_round: number; created_at: number; updated_at: number
      }>;

      // 3. Execution plans
      const executions = db.prepare(`
        SELECT execution_plan_id, proposal_id, status, created_at, updated_at
        FROM execution_plans
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
      `).all(fromTime, toTime) as Array<{
        execution_plan_id: string; proposal_id: string; status: string;
        created_at: number; updated_at: number
      }>;

      // 4. Verifications
      const verifications = db.prepare(`
        SELECT verification_id, proposal_id, overall_outcome, verified_at, created_at
        FROM verifications
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
      `).all(fromTime, toTime) as Array<{
        verification_id: string; proposal_id: string;
        overall_outcome: string; verified_at: number; created_at: number
      }>;

      // 5. Audit events
      const auditEvents = db.prepare(`
        SELECT event_id, event_type, proposal_id, severity, timestamp
        FROM audit_events
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(fromTime, toTime, limit) as Array<{
        event_id: string; event_type: string; proposal_id: string;
        severity: string; timestamp: number
      }>;

      // Unify into timeline entries
      type TimelineEntry = {
        time: number;
        type: string;
        id: string;
        state: string;
        proposalId?: string;
        detail: string;
      };

      const timeline: TimelineEntry[] = [];

      for (const p of proposals) {
        timeline.push({
          time: p.created_at,
          type: "PROPOSAL",
          id: p.id,
          state: p.state,
          detail: p.title || "(no title)",
        });
      }

      for (const m of meetings) {
        timeline.push({
          time: m.created_at,
          type: "MEETING",
          id: m.meeting_id,
          state: m.state,
          proposalId: m.proposal_id,
          detail: `round ${m.current_round}`,
        });
      }

      for (const e of executions) {
        timeline.push({
          time: e.created_at,
          type: "EXECUTION",
          id: e.execution_plan_id,
          state: e.status,
          proposalId: e.proposal_id,
          detail: e.status,
        });
      }

      for (const v of verifications) {
        timeline.push({
          time: v.created_at,
          type: "VERIFY",
          id: v.verification_id,
          state: v.overall_outcome,
          proposalId: v.proposal_id,
          detail: v.overall_outcome,
        });
      }

      for (const a of auditEvents) {
        timeline.push({
          time: a.timestamp,
          type: "AUDIT",
          id: a.event_id,
          state: a.severity,
          proposalId: a.proposal_id,
          detail: a.event_type,
        });
      }

      // Apply filters
      let filtered = timeline;

      if (stateVal) {
        filtered = filtered.filter((e) => e.state === stateVal);
      }

      if (moduleVal) {
        // module filter: need to cross-reference proposals
        const proposalIds = new Set(
          (db.prepare(`
            SELECT DISTINCT pb.id
            FROM proposal_briefs pb
            JOIN impact_caches ic ON pb.id = ic.proposal_id
            WHERE ic.analysis_json LIKE ?
          `).all(`%${moduleVal}%`) as Array<{ id: string }>).map((r) => r.id),
        );
        filtered = filtered.filter(
          (e) => (e.proposalId && proposalIds.has(e.proposalId)) || proposalIds.has(e.id),
        );
      }

      // Sort by time descending, apply limit
      filtered.sort((a, b) => b.time - a.time);
      filtered = filtered.slice(0, limit);

      // Output
      if (filtered.length === 0) {
        process.stdout.write("이력 없음\n");
        return;
      }

      process.stdout.write("──── Athena History Timeline ────\n\n");
      process.stdout.write(
        padRight("TIME", 24) +
        padRight("TYPE", 12) +
        padRight("STATE", 18) +
        padRight("ID", 20) +
        "DETAIL\n",
      );
      process.stdout.write("─".repeat(100) + "\n");

      for (const entry of filtered) {
        const timeStr = new Date(entry.time).toISOString().replace("T", " ").slice(0, 19);
        process.stdout.write(
          padRight(timeStr, 24) +
          padRight(entry.type, 12) +
          padRight(entry.state, 18) +
          padRight(entry.id.slice(0, 18), 20) +
          entry.detail + "\n",
        );
      }

      process.stdout.write(`\n총 ${filtered.length}건\n`);
    }),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTime(value: string): number {
  const asNum = Number(value);
  if (!Number.isNaN(asNum) && asNum > 1_000_000_000) return asNum;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function padRight(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}
