/**
 * `athena research <view> [target]` — inspect research workflow state.
 */

import { Effect } from "effect";
import { Option } from "effect";
import { Command, Args, Options } from "@effect/cli";

const view = Args.text({ name: "view" }).pipe(
  Args.withDescription("runs|proposals|simulations|decisions|lineage|ingestion|graph|revisit|scorecard|budget|claims"),
);

const target = Args.text({ name: "target" }).pipe(
  Args.withDescription("Optional proposal ID or graph root ID"),
  Args.optional,
);

const state = Options.text("state").pipe(
  Options.withDescription("Optional proposal state filter"),
  Options.optional,
);

const tag = Options.text("tag").pipe(
  Options.withDescription("Optional decision reason tag filter"),
  Options.optional,
);

const recent = Options.boolean("recent").pipe(
  Options.withDescription("Limit to recent items for operator views"),
  Options.withDefault(false),
);

export const research = Command.make(
  "research",
  { view, target, state, tag, recent },
  ({ view, target: targetOpt, state: stateOpt, tag: tagOpt, recent }) =>
    Effect.promise(async () => {
      const target = Option.getOrUndefined(targetOpt);
      const state = Option.getOrUndefined(stateOpt);
      const tag = Option.getOrUndefined(tagOpt);
      const { createRuntime } = await import("../init.js");
      const runtime = await createRuntime();

      try {
        const sessionId = runtime.memoryStore.getSessionId();
        const latestSession = runtime.orchestrator.sessionStore.listSessions(1)[0]?.id;
        const resolvedSessionId = sessionId !== "pending"
          ? sessionId
          : runtime.orchestrator.currentSession?.id ?? latestSession ?? runtime.memoryStore.getSessionId();

        switch (view) {
          case "runs": {
            const runs = runtime.teamStore.listRecentTeamRuns(resolvedSessionId, 20);
            printLines(runs.map((run) => `${run.id}  ${run.currentStage.padEnd(10)} ${run.status.padEnd(10)} ${run.goal}`));
            return;
          }
          case "proposals": {
            const proposals = runtime.teamStore
              .listProposalBriefs(resolvedSessionId)
              .filter((proposal) => (state ? proposal.status === state : true));
            printLines(proposals.map((proposal) => `${proposal.proposalId}  ${proposal.status.padEnd(14)} score=${proposal.scorecard?.decisionScore ?? "n/a"}  ${proposal.title}`));
            return;
          }
          case "simulations": {
            const simulations = runtime.teamStore.listRecentSimulationRuns(resolvedSessionId, 20);
            printLines(simulations.map((simulation) => `${simulation.id}  ${simulation.status.padEnd(16)} proposal=${simulation.proposalId} task=${simulation.taskKey ?? "n/a"}`));
            return;
          }
          case "decisions": {
            const decisions = tag
              ? runtime.teamStore.listDecisionRecordsByTag(resolvedSessionId, tag)
              : runtime.teamStore.listDecisionRecords(resolvedSessionId, target);
            const visible = recent ? decisions.slice(0, 10) : decisions;
            printLines(visible.map((decision) => `${decision.decisionId}  ${decision.decisionType.padEnd(8)} proposal=${decision.proposalId} confidence=${decision.confidence.toFixed(2)} weighted=${decision.calibration?.weightedScore ?? "n/a"}  ${decision.decisionSummary}`));
            return;
          }
          case "lineage": {
            const lineage = runtime.teamStore.listExperimentLineage(resolvedSessionId, target);
            printLines(lineage.map((entry) => `${entry.lineageId}  ${entry.relationType.padEnd(14)} proposal=${entry.proposalId} experiment=${entry.experimentId ?? "n/a"} related=${entry.relatedExperimentId ?? "n/a"} superseded_by=${entry.supersededByExperimentId ?? "n/a"}`));
            return;
          }
          case "ingestion": {
            const sources = runtime.teamStore.listIngestionSources(resolvedSessionId);
            printLines(sources.map((source) => `${source.sourceId}  ${source.sourceType.padEnd(10)} ${source.status.padEnd(10)} claims=${source.claimCount ?? 0} linked=${source.linkedProposalCount ?? 0} ${source.title}`));
            return;
          }
          case "revisit": {
            if (target !== "due") {
              console.error("Usage: athena research revisit due");
              process.exit(1);
            }
            const proposals = runtime.teamStore.listRevisitDueProposals(resolvedSessionId);
            printLines(proposals.map((proposal) => `${proposal.proposalId}  ${proposal.status.padEnd(12)} claims=${proposal.claimIds.join(",") || "n/a"}  ${proposal.title}`));
            return;
          }
          case "scorecard": {
            if (!target) {
              console.error("Usage: athena research scorecard <proposal-id>");
              process.exit(1);
            }
            const proposal = runtime.teamStore.getProposalBrief(resolvedSessionId, target);
            const latestDecision = runtime.teamStore.getLatestDecisionRecord(resolvedSessionId, target);
            const latestResult = runtime.teamStore.listRecentSimulationRuns(resolvedSessionId, 50).find((simulation) => simulation.proposalId === target)?.result;
            if (!proposal?.scorecard) {
              console.error(`No scorecard found for proposal: ${target}`);
              process.exit(1);
            }
            printLines([
              `${proposal.proposalId}  weighted=${proposal.scorecard.weightedScore.toFixed(2)} decision_score=${proposal.scorecard.decisionScore.toFixed(2)}  ${proposal.title}`,
              `axes  ${Object.entries(proposal.scorecard.axisScores).map(([key, value]) => `${key}=${value}`).join(" ")}`,
              `decision  ${latestDecision?.decisionType ?? "n/a"} confidence=${latestDecision?.confidence ?? "n/a"}`,
              `latest_result  ${latestResult?.outcomeStatus ?? "n/a"}`,
            ]);
            return;
          }
          case "budget": {
            if (target !== "anomalies") {
              console.error("Usage: athena research budget anomalies");
              process.exit(1);
            }
            const anomalies = runtime.teamStore.listBudgetAnomalies(resolvedSessionId);
            printLines(anomalies.map((item) => `${item.experimentId}  proposal=${item.proposalId} decision=${item.decisionId ?? "n/a"}  ${item.findings.join(" | ") || item.notes || "budget anomaly"}`));
            return;
          }
          case "claims": {
            const claims = runtime.graphMemory.listNodesByKind("claim");
            printLines(claims.map((claim) => `${claim.id}  ${claim.gist ?? claim.label}`));
            return;
          }
          case "graph": {
            if (!target) {
              console.error("Usage: athena research graph <root-id>");
              process.exit(1);
            }
            console.log(runtime.graphMemory.formatSubgraph([target], 1, 12));
            return;
          }
          default:
            console.error(`Unknown research view: ${view}`);
            process.exit(1);
        }
      } finally {
        runtime.cleanup();
      }
    }),
);

function printLines(lines: string[]): void {
  if (lines.length === 0) {
    console.log("No research records found.");
    return;
  }
  for (const line of lines) {
    console.log(line);
  }
}
