/**
 * `athena research <view> [target]` — inspect research workflow state.
 */

import { Effect } from "effect";
import { Option } from "effect";
import { Command, Args, Options } from "@effect/cli";

const view = Args.text({ name: "view" }).pipe(
  Args.withDescription("runs|workflow|automation|proposals|simulations|decisions|lineage|ingestion|ingest|graph|revisit|scorecard|budget|claims|improvements|review|next-actions"),
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

const kind = Options.text("kind").pipe(
  Options.withDescription("Review target kind: proposal|improvement"),
  Options.optional,
);

const action = Options.text("action").pipe(
  Options.withDescription("Review action: approve|scope_trial|defer|revisit|archive|queue|start_review|promote|dismiss"),
  Options.optional,
);

const inputType = Options.text("type").pipe(
  Options.withDescription("For ingest: url|document|text"),
  Options.optional,
);

const problemArea = Options.text("problem-area").pipe(
  Options.withDescription("For ingest: research problem area used for claim grouping"),
  Options.optional,
);

const title = Options.text("title").pipe(
  Options.withDescription("For ingest: optional source title override"),
  Options.optional,
);

const runId = Options.text("run").pipe(
  Options.withDescription("For ingest: optional run id to attach the ingestion result to"),
  Options.optional,
);

export const research = Command.make(
  "research",
  { view, target, state, tag, recent, kind, action, inputType, problemArea, title, runId },
  ({ view, target: targetOpt, state: stateOpt, tag: tagOpt, recent, kind: kindOpt, action: actionOpt, inputType: inputTypeOpt, problemArea: problemAreaOpt, title: titleOpt, runId: runIdOpt }) =>
    Effect.promise(async () => {
      const target = Option.getOrUndefined(targetOpt);
      const state = Option.getOrUndefined(stateOpt);
      const tag = Option.getOrUndefined(tagOpt);
      const kind = Option.getOrUndefined(kindOpt);
      const action = Option.getOrUndefined(actionOpt);
      const inputType = Option.getOrUndefined(inputTypeOpt);
      const problemArea = Option.getOrUndefined(problemAreaOpt);
      const sourceTitle = Option.getOrUndefined(titleOpt);
      const targetRunId = Option.getOrUndefined(runIdOpt);
      const { createRuntime } = await import("../init.js");
      const runtime = await createRuntime();
      const { IngestionService } = await import("../research/ingestion-service.js");

      try {
        const sessionId = runtime.memoryStore.getSessionId();
        const latestSession = runtime.orchestrator.sessionStore.listSessions(1)[0]?.id;
        let resolvedSessionId = sessionId !== "pending"
          ? sessionId
          : runtime.orchestrator.currentSession?.id ?? latestSession ?? runtime.memoryStore.getSessionId();

        if (view === "ingest" && resolvedSessionId === "pending") {
          const created = runtime.orchestrator.sessionStore.createSession(
            runtime.orchestrator.currentProvider?.name ?? "claude",
            runtime.orchestrator.currentModel ?? undefined,
          );
          resolvedSessionId = created.id;
        }

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
              formatAutonomyLine(run),
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
            if (target) {
              const source = sources.find((item) => item.sourceId === target);
              if (!source) {
                console.error(`No ingestion source found: ${target}`);
                process.exit(1);
              }
              printLines([
                `${source.sourceId}  ${source.sourceType.padEnd(10)} ${source.status.padEnd(10)} ${source.title}`,
                `claims  ${source.claimCount ?? 0} canonical=${source.canonicalClaims?.length ?? 0} linked=${source.linkedProposalCount ?? 0}`,
                `evidence  confidence=${source.evidenceConfidence ?? "n/a"} freshness=${source.freshnessScore ?? "n/a"}`,
                `digest  ${source.sourceDigest ?? "n/a"}`,
                `excerpt  ${source.sourceExcerpt ?? source.notes ?? "n/a"}`,
                ...(source.extractedClaims ?? []).slice(0, 5).map((claim) => `claim  ${claim.disposition ?? "support"} confidence=${claim.confidence ?? "n/a"} ${claim.statement}`),
                ...(source.extractedClaims ?? []).slice(0, 3).flatMap((claim) =>
                  (claim.citationSpans ?? []).slice(0, 1).map((span) => `citation  ${span.locator ?? "n/a"} ${span.text}`),
                ),
              ]);
              return;
            }
            printLines(sources.map((source) => `${source.sourceId}  ${source.sourceType.padEnd(10)} ${source.status.padEnd(10)} claims=${source.claimCount ?? 0} canonical=${source.canonicalClaims?.length ?? 0} linked=${source.linkedProposalCount ?? 0} ${source.title}`));
            return;
          }
          case "ingest": {
            if (!target || !inputType || !problemArea) {
              console.error("Usage: athena research ingest <value> --type url|document|text --problem-area <area> [--title <title>] [--run <run-id>]");
              process.exit(1);
            }
            const ingestionService = new IngestionService(runtime.teamStore, runtime.teamOrchestrator);
            const result = await ingestionService.ingest({
              inputType: inputType as "url" | "document" | "text",
              value: target,
              problemArea,
              title: sourceTitle,
              runId: targetRunId,
              sessionId: resolvedSessionId,
            });
            printLines([
              `run  ${result.run.id} workflow=${result.run.workflowState} stage=${result.run.currentStage}`,
              `source  ${result.source.sourceId} ${result.source.sourceType} ${result.source.status} ${result.source.title}`,
              `claims  extracted=${result.pack.claims.length} canonical=${result.pack.canonicalClaims?.length ?? 0} contradictions=${result.pack.counterEvidence.length}`,
              ...result.pack.claims.slice(0, 5).map((claim) => `claim  ${claim.disposition ?? "support"} confidence=${claim.confidence ?? "n/a"} ${claim.statement}`),
            ]);
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
                  `source_attribution  ${claim.sourceAttributions?.map((item) => `${item.title}${item.locator ? `@${item.locator}` : ""}`).join(" | ") || "n/a"}`,
                  `citations  ${claim.citationSpans?.map((item) => `${item.locator ?? "n/a"}:${item.text}`).join(" | ") || "n/a"}`,
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
          case "review": {
            if (!target || !kind || !action) {
              console.error("Usage: athena research review <target-id> --kind proposal|improvement --action <action>");
              process.exit(1);
            }
            if (kind === "proposal") {
              const updated = runtime.teamStore.reviewProposalBrief(
                resolvedSessionId,
                target,
                action as import("../research/contracts.js").ProposalReviewAction,
              );
              printLines([
                `${updated.proposalId}  status=${updated.status}`,
                `summary  ${updated.summary}`,
              ]);
              return;
            }
            if (kind === "improvement") {
              const updated = runtime.teamStore.reviewImprovementProposal(
                resolvedSessionId,
                target,
                action as import("../research/contracts.js").ImprovementReviewAction,
              );
              printLines([
                `${updated.improvementId}  review=${updated.reviewStatus} status=${updated.status}`,
                `title  ${updated.title}`,
              ]);
              return;
            }
            console.error(`Unknown review kind: ${kind}`);
            process.exit(1);
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

function formatAutonomyLine(run: import("../research/contracts.js").TeamRunRecord): string {
  if (run.automationPolicy.mode !== "fully-autonomous") {
    return "autonomy  n/a";
  }
  const policy = run.automationPolicy.autonomyPolicy;
  if (!policy) {
    return "autonomy  n/a";
  }

  return [
    "autonomy",
    `risk=${policy.maxRiskTier}`,
    `retry_cap=${policy.maxRetryCount ?? "n/a"}`,
    `wall_min=${policy.maxWallClockMinutes ?? "n/a"}`,
    `cost=${policy.maxCostUsd ?? "n/a"}`,
    `evidence_floor=${policy.requireEvidenceFloor ?? "n/a"}`,
    `rollback=${policy.requireRollbackPlan ?? false}`,
    `machines=${policy.allowedMachineIds?.join(",") ?? "n/a"}`,
  ].join("  ");
}
