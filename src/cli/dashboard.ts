/**
 * `athena dashboard [view]` — operator control plane.
 *
 * Spec §11: 활성 proposal, 영향 모듈, 소집된 에이전트, 충돌 포인트,
 * 승인 조건, 실행 상태, 검증 상태를 한 화면에서 본다.
 *
 * Views:
 *   overview     전체 현황 (default)
 *   proposals    활성 change proposals
 *   meetings     진행 중 회의
 *   agents       에이전트 상태
 *   conflicts    미해결 충돌
 *   conditions   미충족 승인 조건
 *   verification 검증 상태
 *   audit        최근 감사 로그
 */

import { Effect, Option } from "effect";
import { Command, Args } from "@effect/cli";

const view = Args.text({ name: "view" }).pipe(
  Args.withDescription("overview|proposals|meetings|agents|conflicts|conditions|verification|audit"),
  Args.optional,
);

export const dashboard = Command.make(
  "dashboard",
  { view },
  (opts) =>
    Effect.promise(async () => {
      const selectedView = Option.getOrUndefined(opts.view) ?? "overview";

      try {
        const { MeetingStore } = await import("../research/meeting-store.js");
        const { ChangeProposalStore } = await import("../research/change-proposal-store.js");
        const store = new MeetingStore();
        const proposalStore = new ChangeProposalStore();

        switch (selectedView) {
          case "overview": {
            console.log("╔══════════════════════════════════════════════════════╗");
            console.log("║  Athena Change Management Dashboard                  ║");
            console.log("╚══════════════════════════════════════════════════════╝");
            console.log("");

            const activeProposals = proposalStore.listActive();
            const activeMeetings = store.listActiveMeetings();

            console.log(`  Active Proposals:  ${activeProposals.length}`);
            console.log(`  Active Meetings:   ${activeMeetings.length}`);

            // action required
            const pendingConditions = activeProposals.flatMap((p) =>
              store.listPendingConditions(p.proposalId),
            );
            const meetingsNeedingAttention = activeMeetings.filter(
              (m) => m.absentAgents.length > 0 || m.state === "pending-quorum",
            );

            if (pendingConditions.length > 0 || meetingsNeedingAttention.length > 0) {
              console.log("");
              console.log("  ⚠ ACTION REQUIRED:");
              for (const m of meetingsNeedingAttention) {
                console.log(`    - Meeting ${m.meetingId}: ${m.state} (${m.absentAgents.length} absent)`);
              }
              for (const c of pendingConditions) {
                console.log(`    - Condition: ${c.conditionText} (by ${c.requiredBy})`);
              }
            }

            // per-proposal summary
            if (activeProposals.length > 0) {
              console.log("");
              console.log("  PROPOSALS:");
              for (const p of activeProposals) {
                console.log(`    ${p.proposalId}  ${p.workflowState.padEnd(16)}  ${p.title}`);
              }
            }
            break;
          }

          case "proposals": {
            const proposals = proposalStore.listActive();
            if (proposals.length === 0) {
              console.log("No active change proposals.");
              return;
            }
            console.log("Active Change Proposals:");
            for (const p of proposals) {
              const direct = p.directlyAffectedModules.map((m) => m.moduleId).join(", ");
              console.log(`  ${p.proposalId}  ${p.workflowState.padEnd(16)}  ${p.title}`);
              console.log(`    Direct: ${direct || "—"}  Meeting: ${p.meetingRequired ? "yes" : "no"}`);
              console.log(`    Created by: ${p.createdBy}  Paths: ${p.changedPaths.length}`);
              console.log("");
            }
            break;
          }

          case "meetings": {
            const meetings = store.listActiveMeetings();
            if (meetings.length === 0) {
              console.log("No active meetings.");
              return;
            }
            console.log("Active Meetings:");
            for (const m of meetings) {
              const responded = m.respondedAgents.length;
              const total = m.mandatoryAgents.length + m.conditionalAgents.length;
              console.log(`  ${m.meetingId}  ${m.state.padEnd(16)}  round ${m.currentRound}/5  agents ${responded}/${total}`);
              console.log(`    Proposal: ${m.proposalId}`);
              if (m.conflictPoints.length > 0) {
                console.log(`    Conflicts: ${m.conflictPoints.length}`);
              }
              if (m.absentAgents.length > 0) {
                console.log(`    ⚠ Absent: ${m.absentAgents.join(", ")}`);
              }
              console.log("");
            }
            break;
          }

          case "agents": {
            const meetings = store.listActiveMeetings();
            console.log("Agent Status (across active meetings):");
            const agentStatus = new Map<string, { responded: number; absent: number; meetings: number }>();
            for (const m of meetings) {
              const all = [...m.mandatoryAgents, ...m.conditionalAgents];
              for (const a of all) {
                if (!agentStatus.has(a)) agentStatus.set(a, { responded: 0, absent: 0, meetings: 0 });
                const s = agentStatus.get(a)!;
                s.meetings++;
                if (m.respondedAgents.includes(a)) s.responded++;
                if (m.absentAgents.includes(a)) s.absent++;
              }
            }
            for (const [agentId, status] of agentStatus) {
              const icon = status.absent > 0 ? "⚠" : "✓";
              console.log(`  ${icon} ${agentId.padEnd(20)}  meetings: ${status.meetings}  responded: ${status.responded}  absent: ${status.absent}`);
            }
            break;
          }

          case "conflicts": {
            const meetings = store.listActiveMeetings();
            const allConflicts = meetings.flatMap((m) =>
              m.conflictPoints.map((c) => ({ meetingId: m.meetingId, ...c })),
            );
            if (allConflicts.length === 0) {
              console.log("No active conflicts.");
              return;
            }
            console.log("Active Conflicts:");
            for (const c of allConflicts) {
              const status = c.resolvedAt ? "✓ resolved" : "⚠ open";
              console.log(`  [${c.conflictType}] ${status}`);
              console.log(`    ${c.description}`);
              console.log(`    Agents: ${c.involvedAgents.join(", ")}`);
              console.log(`    Meeting: ${c.meetingId}`);
              console.log("");
            }
            break;
          }

          case "conditions": {
            const proposals = proposalStore.listActive();
            let total = 0;
            for (const p of proposals) {
              const conditions = store.listPendingConditions(p.proposalId);
              if (conditions.length > 0) {
                console.log(`Proposal ${p.proposalId}: ${p.title}`);
                for (const c of conditions) {
                  console.log(`  [${c.status}] ${c.conditionText}`);
                  console.log(`    Required by: ${c.requiredBy}  Method: ${c.verificationMethod}`);
                }
                console.log("");
                total += conditions.length;
              }
            }
            if (total === 0) console.log("No pending approval conditions.");
            break;
          }

          case "verification": {
            const proposals = proposalStore.listActive();
            for (const p of proposals) {
              const results = store.listVerificationResults(p.proposalId);
              if (results.length > 0) {
                const latest = results[0];
                const passedTests = latest.testResults.filter((t) => t.outcome === "passed").length;
                const totalTests = latest.testResults.length;
                const icon = latest.overallOutcome === "passed" ? "✓" : latest.overallOutcome === "failed" ? "✗" : "~";
                console.log(`  ${icon} ${p.proposalId}  ${latest.overallOutcome}  tests: ${passedTests}/${totalTests}`);
                if (latest.remeetingRequired) {
                  console.log(`    ⚠ Remeeting required: ${latest.remeetingReason}`);
                }
              }
            }
            break;
          }

          case "audit": {
            const { AuditEventStore } = await import("../research/audit-event-store.js");
            const auditStore = new AuditEventStore();
            const events = auditStore.listRecent(20);
            if (events.length === 0) {
              console.log("No recent audit events.");
              break;
            }
            console.log("Recent Audit Events:");
            for (const evt of events) {
              const time = new Date(evt.timestamp).toISOString().slice(0, 19);
              const proposal = evt.proposalId ? `  proposal=${evt.proposalId}` : "";
              console.log(`  [${evt.severity}] ${time}  ${evt.eventType}${proposal}`);
              if (evt.details && typeof evt.details === "object") {
                const detail = Object.entries(evt.details as Record<string, unknown>)
                  .slice(0, 3)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" ");
                if (detail) console.log(`    ${detail}`);
              }
            }
            break;
          }

          default:
            console.error(`Unknown view: ${selectedView}`);
            console.error("Valid views: overview, proposals, meetings, agents, conflicts, conditions, verification, audit");
            process.exitCode = 1;
        }
      } catch {
        console.log("Dashboard unavailable — database not initialized.");
        console.log("Run 'athena' first to initialize the database.");
      }
    }),
);
