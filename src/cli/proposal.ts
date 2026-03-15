/**
 * `athena proposal <action> [options]` — change proposal management.
 *
 * Actions:
 *   create   Create a new change proposal
 *   list     List change proposals
 *   show     Show change proposal details
 *   impact   Run impact analysis on a proposal
 *   agree    Approve a proposal for execution
 *   execute  Start proposal execution
 *   verify   Run verification pipeline
 *   rollback Rollback a proposal
 */

import { Effect, Option } from "effect";
import { Command, Args, Options } from "@effect/cli";
import { nanoid } from "nanoid";

const action = Args.text({ name: "action" }).pipe(
  Args.withDescription("create|list|show|impact|agree|execute|verify|rollback|force-stop|force-remeeting|override|status"),
);

const proposalTarget = Args.text({ name: "target" }).pipe(
  Args.withDescription("Proposal ID (for show/impact/agree/execute/verify/rollback)"),
  Args.optional,
);

const titleOpt = Options.text("title").pipe(
  Options.withDescription("Proposal title"),
  Options.optional,
);

const pathsOpt = Options.text("paths").pipe(
  Options.withDescription("Comma-separated changed file paths"),
  Options.optional,
);

const summaryOpt = Options.text("summary").pipe(
  Options.withDescription("Proposal summary"),
  Options.optional,
);

const stateFilter = Options.text("state").pipe(
  Options.withDescription("Filter proposals by change_workflow_state"),
  Options.optional,
);

const moduleFilter = Options.text("module").pipe(
  Options.withDescription("Filter proposals by affected module"),
  Options.optional,
);

export const proposal = Command.make(
  "proposal",
  { action, target: proposalTarget, title: titleOpt, paths: pathsOpt, summary: summaryOpt, state: stateFilter, module: moduleFilter },
  (opts) =>
    Effect.promise(async () => {
      const target = Option.getOrUndefined(opts.target);
      const title = Option.getOrUndefined(opts.title);
      const paths = Option.getOrUndefined(opts.paths);
      const summary = Option.getOrUndefined(opts.summary);
      const state = Option.getOrUndefined(opts.state);
      const module_ = Option.getOrUndefined(opts.module);

      switch (opts.action) {
        case "create": {
          if (!title) {
            console.error("--title is required for proposal creation");
            process.exitCode = 1;
            return;
          }
          const proposalId = `cp_${nanoid(7)}`;
          const changedPaths = paths?.split(",").map((p) => p.trim()) ?? [];

          console.log(`Change Proposal created: ${proposalId}`);
          console.log(`  Title: ${title}`);
          console.log(`  Paths: ${changedPaths.length > 0 ? changedPaths.join(", ") : "(none)"}`);
          console.log(`  Summary: ${summary ?? "(none)"}`);
          console.log(`  State: draft`);
          console.log("");
          console.log("Next steps:");
          console.log(`  athena proposal impact ${proposalId}   # Run impact analysis`);
          console.log(`  athena meeting status ${proposalId}     # Check meeting status`);

          // Impact analysis
          if (changedPaths.length > 0) {
            try {
              const { ImpactAnalyzer } = await import("../impact/impact-analyzer.js");
              const analyzer = new ImpactAnalyzer();
              const result = analyzer.analyze(changedPaths);

              console.log("");
              console.log("Impact Analysis:");
              console.log(`  Direct:   ${result.directlyAffected.map((m) => m.moduleId).join(", ") || "none"}`);
              console.log(`  Indirect: ${result.indirectlyAffected.map((m) => m.moduleId).join(", ") || "none"}`);
              console.log(`  Observer: ${result.observers.map((m) => m.moduleId).join(", ") || "none"}`);
              console.log(`  Meeting required: ${result.meetingRequired ? "yes" : "no"}`);
              if (result.meetingRequired) {
                console.log(`  Reason: ${result.meetingRequiredReason}`);
              }
            } catch {
              console.log("\n(Impact analysis skipped — module registry not available)");
            }
          }
          break;
        }

        case "list": {
          console.log("Change Proposals:");
          console.log(`  (Filters: state=${state ?? "all"}, module=${module_ ?? "all"})`);
          console.log("  Use 'athena research proposals' for full listing");
          break;
        }

        case "show": {
          if (!target) {
            console.error("Proposal ID required: athena proposal show <id>");
            process.exitCode = 1;
            return;
          }
          console.log(`Proposal: ${target}`);
          console.log("  Use 'athena research proposals' with proposal ID for details");
          break;
        }

        case "impact": {
          if (!target && !paths) {
            console.error("Provide --paths or a proposal ID: athena proposal impact [id] --paths ...");
            process.exitCode = 1;
            return;
          }

          const changedPaths = paths?.split(",").map((p) => p.trim()) ?? [];
          if (changedPaths.length === 0) {
            console.error("No paths specified for impact analysis");
            process.exitCode = 1;
            return;
          }

          try {
            const { ImpactAnalyzer } = await import("../impact/impact-analyzer.js");
            const analyzer = new ImpactAnalyzer();
            const result = analyzer.analyze(changedPaths);

            console.log("Impact Analysis Result:");
            console.log(`  Changed paths: ${changedPaths.join(", ")}`);
            console.log("");

            if (result.directlyAffected.length > 0) {
              console.log("  Direct Impact:");
              for (const m of result.directlyAffected) {
                console.log(`    ${m.moduleId} (${m.ownerAgent}) — risk: ${m.riskLevel}`);
              }
            }
            if (result.indirectlyAffected.length > 0) {
              console.log("  Indirect Impact:");
              for (const m of result.indirectlyAffected) {
                console.log(`    ${m.moduleId} (${m.ownerAgent}) — ${m.impactReason}`);
              }
            }
            if (result.observers.length > 0) {
              console.log("  Observers:");
              for (const m of result.observers) {
                console.log(`    ${m.moduleId} (${m.ownerAgent})`);
              }
            }

            console.log("");
            console.log(`  Meeting required: ${result.meetingRequired ? "YES" : "NO"}`);
            console.log(`  Reason: ${result.meetingRequiredReason}`);
          } catch (e) {
            console.error("Impact analysis failed:", (e as Error).message);
            process.exitCode = 1;
          }
          break;
        }

        case "agree":
        case "execute":
        case "verify":
        case "rollback": {
          if (!target) {
            console.error(`Proposal ID required: athena proposal ${opts.action} <id>`);
            process.exitCode = 1;
            return;
          }
          await handlePipelineAction(opts.action, target);
          break;
        }

        case "force-stop": {
          if (!target) {
            console.error("Proposal ID required: athena proposal force-stop <id>");
            process.exitCode = 1;
            return;
          }
          await handleOperatorAction("force-stop", target);
          break;
        }

        case "force-remeeting": {
          if (!target) {
            console.error("Proposal ID required: athena proposal force-remeeting <id>");
            process.exitCode = 1;
            return;
          }
          await handleOperatorAction("force-remeeting", target);
          break;
        }

        case "override": {
          if (!target) {
            console.error("Proposal ID required: athena proposal override <id>");
            process.exitCode = 1;
            return;
          }
          await handleOperatorAction("override", target);
          break;
        }

        case "status": {
          if (!target) {
            console.error("Proposal ID required: athena proposal status <id>");
            process.exitCode = 1;
            return;
          }
          await showPipelineStatus(target);
          break;
        }

        default:
          console.error(`Unknown action: ${opts.action}`);
          console.error("Valid actions: create, list, show, impact, agree, execute, verify, rollback, force-stop, force-remeeting, override, status");
          process.exitCode = 1;
      }
    }),
);

// ─── Pipeline Action Handlers ─────────────────────────────────────────────────

async function handlePipelineAction(
  action: "agree" | "execute" | "verify" | "rollback",
  proposalId: string,
): Promise<void> {
  const { ChangePipeline } = await import("../research/change-pipeline.js");
  const { PipelineStore } = await import("../research/pipeline-store.js");
  const { AuditEventStore } = await import("../research/audit-event-store.js");

  const pipelineStore = new PipelineStore();
  const auditEventStore = new AuditEventStore();
  const pipeline = new ChangePipeline({ pipelineStore, auditEventStore });

  const ctx = pipelineStore.load(proposalId);
  if (!ctx) {
    console.error(`No active pipeline found for proposal: ${proposalId}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Pipeline ${ctx.pipelineId} — current state: ${ctx.currentState}`);

  switch (action) {
    case "agree": {
      const result = pipeline.buildDecisionContract(ctx, {
        rollbackPlan: "git reset --hard HEAD~1",
      });
      console.log(`  → Decision contract: state=${result.currentState}`);
      break;
    }
    case "execute": {
      const result = pipeline.execute(ctx, {
        rollbackPlan: "git reset --hard HEAD~1",
        autoExecute: true,
      });
      console.log(`  → Execution: state=${result.currentState}`);
      break;
    }
    case "verify": {
      const result = pipeline.verify(ctx);
      console.log(`  → Verification: state=${result.currentState}`);
      if (result.verificationResult) {
        console.log(`  → Outcome: ${result.verificationResult.overallOutcome}`);
      }
      break;
    }
    case "rollback": {
      await handleOperatorAction("rollback", proposalId);
      break;
    }
  }
}

// ─── Operator Action Handlers ─────────────────────────────────────────────────

type OperatorAction = "force-stop" | "force-remeeting" | "override" | "rollback";

async function handleOperatorAction(action: OperatorAction, proposalId: string): Promise<void> {
  const { PipelineStore } = await import("../research/pipeline-store.js");
  const { AuditEventStore } = await import("../research/audit-event-store.js");
  const { canTransitionChange } = await import("../research/change-workflow-state.js");

  const pipelineStore = new PipelineStore();
  const auditStore = new AuditEventStore();

  const ctx = pipelineStore.load(proposalId);
  if (!ctx) {
    console.error(`No active pipeline found for proposal: ${proposalId}`);
    process.exitCode = 1;
    return;
  }

  const from = ctx.currentState;
  console.log(`Pipeline ${ctx.pipelineId} — current state: ${from}`);

  switch (action) {
    case "force-stop": {
      if (!canTransitionChange(from, "failed")) {
        console.error(`Cannot force-stop from state: ${from}`);
        process.exitCode = 1;
        return;
      }
      pipelineStore.updateState(ctx.pipelineId, "failed");
      auditStore.save({
        eventId: `evt_${nanoid(8)}`,
        eventType: "operator_force_stop",
        proposalId,
        details: { previousState: from, action: "force-stop" },
        severity: "warning",
        timestamp: Date.now(),
      });
      console.log(`  ✓ Force-stopped: ${from} → failed`);
      break;
    }

    case "force-remeeting": {
      if (!canTransitionChange(from, "remeeting")) {
        console.error(`Cannot force-remeeting from state: ${from}`);
        process.exitCode = 1;
        return;
      }
      pipelineStore.updateState(ctx.pipelineId, "remeeting");
      auditStore.save({
        eventId: `evt_${nanoid(8)}`,
        eventType: "operator_force_remeeting",
        proposalId,
        details: { previousState: from, action: "force-remeeting" },
        severity: "warning",
        timestamp: Date.now(),
      });
      console.log(`  ✓ Force-remeeting: ${from} → remeeting`);
      break;
    }

    case "override": {
      // Override: operator가 agreed 상태를 강제 부여 (on-hold, rejected 등에서)
      const targetState = "agreed";
      if (!canTransitionChange(from, targetState) && from !== "on-hold") {
        console.error(`Cannot override from state: ${from}`);
        process.exitCode = 1;
        return;
      }
      // on-hold → draft → impact-analyzed → agents-summoned → in-meeting → agreed 은 너무 복잡하므로
      // operator override는 직접 상태를 설정 (audit trail에 기록)
      pipelineStore.updateState(ctx.pipelineId, "agreed");
      auditStore.save({
        eventId: `evt_${nanoid(8)}`,
        eventType: "operator_override",
        proposalId,
        details: { previousState: from, targetState, action: "override" },
        severity: "critical",
        timestamp: Date.now(),
      });
      console.log(`  ✓ Operator override: ${from} → agreed (WARNING: bypasses normal workflow)`);
      break;
    }

    case "rollback": {
      if (!canTransitionChange(from, "rolled-back")) {
        console.error(`Cannot rollback from state: ${from}`);
        process.exitCode = 1;
        return;
      }
      pipelineStore.updateState(ctx.pipelineId, "rolled-back");
      auditStore.save({
        eventId: `evt_${nanoid(8)}`,
        eventType: "operator_rollback",
        proposalId,
        details: { previousState: from, action: "rollback" },
        severity: "warning",
        timestamp: Date.now(),
      });
      console.log(`  ✓ Rolled back: ${from} → rolled-back`);
      break;
    }
  }
}

// ─── Pipeline Status ──────────────────────────────────────────────────────────

async function showPipelineStatus(proposalId: string): Promise<void> {
  const { PipelineStore } = await import("../research/pipeline-store.js");
  const { AuditEventStore } = await import("../research/audit-event-store.js");

  const pipelineStore = new PipelineStore();
  const auditStore = new AuditEventStore();

  const ctx = pipelineStore.load(proposalId);
  if (!ctx) {
    console.log(`No pipeline found for proposal: ${proposalId}`);
    return;
  }

  console.log(`Pipeline: ${ctx.pipelineId}`);
  console.log(`  Proposal:  ${ctx.proposalId}`);
  console.log(`  Session:   ${ctx.sessionId}`);
  console.log(`  State:     ${ctx.currentState}`);
  console.log(`  Meeting:   ${ctx.meetingId ?? "(none)"}`);
  console.log("");

  if (ctx.stages.length > 0) {
    console.log("  Stages:");
    for (const s of ctx.stages) {
      const dur = s.startedAt && s.completedAt ? `${s.completedAt - s.startedAt}ms` : "-";
      console.log(`    ${s.stage.padEnd(14)} ${s.status.padEnd(10)} ${dur}`);
      if (s.error) console.log(`      error: ${s.error}`);
    }
  }

  const events = auditStore.listByProposal(proposalId);
  if (events.length > 0) {
    console.log("");
    console.log("  Recent Audit Events:");
    for (const ev of events) {
      const time = new Date(ev.timestamp).toLocaleTimeString();
      console.log(`    [${time}] ${ev.eventType} (${ev.severity})`);
    }
  }
}
