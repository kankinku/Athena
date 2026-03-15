/**
 * `athena meeting <action> [target]` — meeting session management.
 *
 * Actions:
 *   status      Show meeting status for a proposal
 *   transcript  Show full meeting transcript
 *   agents      Show agent participation details
 *   conflicts   Show conflict points
 *   conditions  Show approval conditions
 *   list        List active meetings
 */

import { Effect, Option } from "effect";
import { Command, Args, Options } from "@effect/cli";

const action = Args.text({ name: "action" }).pipe(
  Args.withDescription("status|transcript|agents|conflicts|conditions|list"),
);

const meetingTarget = Args.text({ name: "target" }).pipe(
  Args.withDescription("Proposal ID or Meeting ID"),
  Args.optional,
);

const allActive = Options.boolean("all-active").pipe(
  Options.withDescription("Show all active meetings"),
  Options.withDefault(false),
);

export const meeting = Command.make(
  "meeting",
  { action, target: meetingTarget, allActive },
  (opts) =>
    Effect.promise(async () => {
      const target = Option.getOrUndefined(opts.target);

      switch (opts.action) {
        case "status": {
          if (!target && !opts.allActive) {
            console.error("Proposal ID required: athena meeting status <proposal-id>");
            console.error("Or use --all-active to list all active meetings");
            process.exitCode = 1;
            return;
          }

          try {
            const { MeetingStore } = await import("../research/meeting-store.js");
            const store = new MeetingStore();

            if (opts.allActive) {
              const meetings = store.listActiveMeetings();
              if (meetings.length === 0) {
                console.log("No active meetings.");
                return;
              }
              console.log("Active Meetings:");
              for (const m of meetings) {
                const responded = m.respondedAgents.length;
                const total = m.mandatoryAgents.length + m.conditionalAgents.length;
                console.log(`  ${m.meetingId}  ${m.state}  round ${m.currentRound}/5  agents ${responded}/${total}  proposal=${m.proposalId}`);
              }
              return;
            }

            const m = store.getMeetingByProposal(target!);
            if (!m) {
              console.log(`No meeting found for proposal: ${target}`);
              return;
            }

            console.log(`Meeting: ${m.meetingId}`);
            console.log(`  Proposal: ${m.proposalId}`);
            console.log(`  State: ${m.state}`);
            console.log(`  Round: ${m.currentRound}/5`);
            console.log(`  Consensus: ${m.consensusType ?? "(none)"}`);
            console.log("");
            console.log("  Mandatory agents:");
            for (const agent of m.mandatoryAgents) {
              const responded = m.respondedAgents.includes(agent);
              const absent = m.absentAgents.includes(agent);
              const icon = absent ? "✗" : responded ? "✓" : "…";
              console.log(`    ${icon} ${agent}`);
            }
            if (m.conditionalAgents.length > 0) {
              console.log("  Conditional agents:");
              for (const agent of m.conditionalAgents) {
                const responded = m.respondedAgents.includes(agent);
                const icon = responded ? "✓" : "…";
                console.log(`    ${icon} ${agent}`);
              }
            }
            if (m.observerAgents.length > 0) {
              console.log(`  Observers: ${m.observerAgents.join(", ")}`);
            }
            if (m.conflictPoints.length > 0) {
              console.log(`  Conflicts: ${m.conflictPoints.length}`);
              for (const c of m.conflictPoints) {
                console.log(`    - ${c.conflictType}: ${c.description}`);
              }
            }
          } catch {
            console.log(`Meeting status for: ${target ?? "all"}`);
            console.log("  (Database not initialized — run athena first)");
          }
          break;
        }

        case "transcript": {
          if (!target) {
            console.error("Meeting ID required: athena meeting transcript <meeting-id>");
            process.exitCode = 1;
            return;
          }
          try {
            const { MeetingStore } = await import("../research/meeting-store.js");
            const store = new MeetingStore();
            const positions = store.listAgentPositions(target);

            if (positions.length === 0) {
              console.log(`No positions recorded for meeting: ${target}`);
              return;
            }

            console.log(`Meeting Transcript: ${target}`);
            console.log("");
            let currentRound = -1;
            for (const pos of positions) {
              if (pos.round !== currentRound) {
                currentRound = pos.round;
                console.log(`--- Round ${currentRound} ---`);
              }
              console.log(`  [${pos.agentId}] (${pos.moduleId})`);
              console.log(`    Position: ${pos.position}`);
              console.log(`    Impact: ${pos.impact}`);
              console.log(`    Risk: ${pos.risk}`);
              if (pos.requiredChanges.length > 0) {
                console.log(`    Required changes: ${pos.requiredChanges.join("; ")}`);
              }
              if (pos.vote) {
                console.log(`    Vote: ${pos.vote}`);
              }
              if (pos.approvalCondition) {
                console.log(`    Condition: ${pos.approvalCondition}`);
              }
              console.log("");
            }
          } catch {
            console.log("  (Database not initialized)");
          }
          break;
        }

        case "agents": {
          if (!target) {
            console.error("Proposal ID required: athena meeting agents <proposal-id>");
            process.exitCode = 1;
            return;
          }
          console.log(`Agent details for proposal: ${target}`);
          console.log("  Use 'athena meeting status <proposal-id>' for agent list");
          break;
        }

        case "conflicts": {
          if (!target) {
            console.error("Meeting ID required: athena meeting conflicts <meeting-id>");
            process.exitCode = 1;
            return;
          }
          try {
            const { MeetingStore } = await import("../research/meeting-store.js");
            const store = new MeetingStore();
            const m = store.getMeetingSession(target);
            if (!m) {
              console.log(`Meeting not found: ${target}`);
              return;
            }
            if (m.conflictPoints.length === 0) {
              console.log("No conflicts recorded.");
              return;
            }
            console.log(`Conflict Points: ${target}`);
            for (const c of m.conflictPoints) {
              console.log(`  [${c.conflictType}] ${c.description}`);
              console.log(`    Agents: ${c.involvedAgents.join(", ")}`);
              console.log(`    Resolutions: ${c.proposedResolutions.join("; ")}`);
              if (c.resolvedAt) console.log(`    Resolved: yes`);
              console.log("");
            }
          } catch {
            console.log("  (Database not initialized)");
          }
          break;
        }

        case "conditions": {
          if (!target) {
            console.error("Proposal ID or Meeting ID required");
            process.exitCode = 1;
            return;
          }
          try {
            const { MeetingStore } = await import("../research/meeting-store.js");
            const store = new MeetingStore();
            const conditions = store.listPendingConditions(target);
            if (conditions.length === 0) {
              console.log("No pending approval conditions.");
              return;
            }
            console.log("Approval Conditions:");
            for (const c of conditions) {
              console.log(`  [${c.status}] ${c.conditionText}`);
              console.log(`    Required by: ${c.requiredBy}`);
              console.log(`    Verification: ${c.verificationMethod}`);
              console.log("");
            }
          } catch {
            console.log("  (Database not initialized)");
          }
          break;
        }

        case "list": {
          try {
            const { MeetingStore } = await import("../research/meeting-store.js");
            const store = new MeetingStore();
            const meetings = store.listMeetingSessions();
            if (meetings.length === 0) {
              console.log("No meetings found.");
              return;
            }
            console.log("All Meetings:");
            for (const m of meetings) {
              console.log(`  ${m.meetingId}  ${m.state}  round=${m.currentRound}  consensus=${m.consensusType ?? "—"}  proposal=${m.proposalId}`);
            }
          } catch {
            console.log("  (Database not initialized)");
          }
          break;
        }

        default:
          console.error(`Unknown action: ${opts.action}`);
          console.error("Valid actions: status, transcript, agents, conflicts, conditions, list");
          process.exitCode = 1;
      }
    }),
);
