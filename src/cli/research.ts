/**
 * `athena research <view> [target]` — inspect research workflow state.
 */

import { Effect } from "effect";
import { Option } from "effect";
import { Command, Args, Options } from "@effect/cli";

const view = Args.text({ name: "view" }).pipe(
  Args.withDescription("runs|workflow|automation|proposals|simulations|decisions|lineage|ingestion|graph|revisit|scorecard|budget|claims|improvements|next-actions"),
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
            printLines(runs.map((run) => `${run.id}  stage=${run.currentStage.padEnd(10)} workflow=${run.workflowState.padEnd(11)} status=${run.status.padEnd(10)} ${run.goal}`));
            return;
          }
          case "workflow": {
            const runs = runtime.teamStore.listRecentTeamRuns(resolvedSessionId, 20);
            const run = target
              ? runs.find((item) => item.id === target) ?? runtime.teamStore.getTeamRun(target)
              : runs[0];
            if (!run) {
              console.error("Usage: athena research workflow <run-id>");
              process.exit(1);
            }
            const history = runtime.teamStore.listWorkflowTransitions(resolvedSessionId, run.id);
            printLines([
              `${run.id}  stage=${run.currentStage} workflow=${run.workflowState} status=${run.status}`,
              `goal  ${run.goal}`,
              ...(history.length > 0
                ? history.map((entry) => `transition  ${entry.fromState} -> ${entry.toState} reason=${entry.reason}`)
                : ["transition  n/a"]),
            ]);
            return;
          }
          case "automation": {
            const runs = runtime.teamStore.listRecentTeamRuns(resolvedSessionId, 20);
            const run = target
              ? runs.find((item) => item.id === target) ?? runtime.teamStore.getTeamRun(target)
              : runs[0];
            if (!run) {
              console.error("Usage: athena research automation <run-id>");
              process.exit(1);
            }
            const checkpoints = runtime.teamStore.listAutomationCheckpoints(resolvedSessionId, run.id);
            printLines([
              `${run.id}  mode=${run.automationPolicy.mode} workflow=${run.workflowState} status=${run.status}`,
              `approval  proposal=${run.automationPolicy.requireProposalApproval} experiment=${run.automationPolicy.requireExperimentApproval} revisit=${run.automationPolicy.requireRevisitApproval}`,
              `retry  count=${run.automationState.retryCount}/${run.retryPolicy.maxRetries} retry_on=${run.retryPolicy.retryOn.join(",")}`,
              `checkpoint  last=${run.automationState.lastCheckpointAt ?? "n/a"} next=${run.automationState.nextCheckpointAt ?? "n/a"} interval_min=${run.checkpointPolicy.intervalMinutes}`,
              `timeout  at=${run.automationState.timeoutAt ?? "n/a"} max_run_min=${run.timeoutPolicy.maxRunMinutes} max_stage_min=${run.timeoutPolicy.maxStageMinutes ?? "n/a"}`,
              ...(checkpoints.length > 0
                ? checkpoints.slice(-5).map((checkpoint) => `checkpoint_record  ${checkpoint.workflowState}/${checkpoint.stage} reason=${checkpoint.reason}`)
                : ["checkpoint_record  n/a"]),
            ]);
            return;
          }
          case "proposals": {
            const proposals = runtime.teamStore
              .listProposalBriefs(resolvedSessionId)
              .filter((proposal) => (state ? proposal.status === state : true));
            printLines(proposals.map((proposal) => `${proposal.proposalId}  ${proposal.status.padEnd(14)} score=${proposal.scorecard?.decisionScore ?? "n/a"} evidence=${proposal.claimSupport?.evidenceStrength?.toFixed(2) ?? "n/a"} freshness=${proposal.claimSupport?.freshnessScore?.toFixed(2) ?? "n/a"} contradiction=${proposal.claimSupport?.contradictionPressure?.toFixed(2) ?? "n/a"}  ${proposal.title}`));
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
            if (target && visible.length === 1) {
              const decision = visible[0];
              printLines([
                `${decision.decisionId}  ${decision.decisionType} proposal=${decision.proposalId} confidence=${decision.confidence.toFixed(2)}`,
                `summary  ${decision.decisionSummary}`,
                `reasons  ${decision.reasonTags.join(", ") || "n/a"}`,
                `evidence  ${decision.evidenceLinks.join(", ") || "n/a"}`,
                decision.drift
                  ? `drift  changed=${decision.drift.changed} final=${decision.drift.finalDecision} notes=${decision.drift.notes.join(" | ") || "n/a"}`
                  : "drift  n/a",
              ]);
              return;
            }
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
            printLines(sources.map((source) => `${source.sourceId}  ${source.sourceType.padEnd(10)} ${source.status.padEnd(10)} claims=${source.claimCount ?? 0} canonical=${source.canonicalClaims?.length ?? 0} linked=${source.linkedProposalCount ?? 0} ${source.title}`));
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
              proposal.claimSupport
                ? `claim_support  evidence=${proposal.claimSupport.evidenceStrength.toFixed(2)} freshness=${proposal.claimSupport.freshnessScore.toFixed(2)} contradiction=${proposal.claimSupport.contradictionPressure.toFixed(2)} source_coverage=${proposal.claimSupport.sourceCoverage.toFixed(2)} unresolved=${proposal.claimSupport.unresolvedClaims.length}`
                : "claim_support  n/a",
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
            const claimKind = target === "source" ? "source_claim" : "claim";
            const claims = runtime.graphMemory.listNodesByKind(claimKind);
            if (target && target !== "source") {
              const canonicalClaims = runtime.teamStore.listIngestionSources(resolvedSessionId)
                .flatMap((source) => source.canonicalClaims ?? []);
              const claim = canonicalClaims.find((item) => item.canonicalClaimId === target || `/research/claims/${item.canonicalClaimId}` === target);
              if (claim) {
                printLines([
                  `${claim.canonicalClaimId}  ${claim.statement}`,
                  `semantic_key  ${claim.semanticKey}`,
                  `support  confidence=${claim.confidence ?? "n/a"} freshness=${claim.freshnessScore ?? "n/a"}`,
                  `sources  ${claim.sourceIds.join(", ") || "n/a"}`,
                  `evidence  ${claim.evidenceIds.join(", ") || "n/a"}`,
                  `support_tags  ${claim.supportTags.join(", ") || "n/a"}`,
                  `contradiction_tags  ${claim.contradictionTags.join(", ") || "n/a"}`,
                ]);
                return;
              }
            }
            printLines(claims.map((claim) => `${claim.id}  ${claim.gist ?? claim.label}`));
            return;
          }
          case "improvements": {
            const proposals = runtime.teamStore.listImprovementProposals(resolvedSessionId, target);
            const evaluations = runtime.teamStore.listImprovementEvaluations(resolvedSessionId, target);
            printLines([
              ...proposals
                .sort((a, b) => b.priorityScore - a.priorityScore)
                .map((proposal) => `${proposal.improvementId}  ${proposal.status.padEnd(10)} review=${proposal.reviewStatus.padEnd(10)} priority=${proposal.priorityScore.toFixed(2)} area=${proposal.targetArea}  ${proposal.title}`),
              ...evaluations.map((evaluation) => `${evaluation.evaluationId}  outcome=${evaluation.outcome.padEnd(17)} run=${evaluation.runId}  ${evaluation.recommendedAction}`),
            ]);
            return;
          }
          case "next-actions": {
            const proposals = runtime.teamStore.listProposalBriefs(resolvedSessionId);
            const revisitDue = runtime.teamStore.listRevisitDueProposals(resolvedSessionId);
            const openTriggers = runtime.teamStore.listOpenReconsiderationTriggers(resolvedSessionId);
            const activeRuns = runtime.teamStore.listRecentTeamRuns(resolvedSessionId, 20)
              .filter((run) => run.status === "active");
            const lines = [
              ...activeRuns.map((run) => `run  ${run.id} continue workflow=${run.workflowState} stage=${run.currentStage}`),
              ...revisitDue.map((proposal) => `revisit  ${proposal.proposalId} reassess due evidence changes`),
              ...openTriggers.slice(0, 5).map((trigger) => `trigger  ${trigger.proposalId} wait for ${trigger.triggerType}`),
              ...proposals
                .filter((proposal) => proposal.status === "ready_for_experiment" || proposal.status === "scoped_trial")
                .slice(0, 5)
                .map((proposal) => `experiment  ${proposal.proposalId} prepare validation run`),
            ];
            printLines(lines.length > 0 ? lines : ["No operator next actions identified."]);
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
