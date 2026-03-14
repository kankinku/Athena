/**
 * `athena research <view> [target]` — inspect research workflow state.
 */

import { Effect } from "effect";
import { Option } from "effect";
import { Command, Args, Options } from "@effect/cli";

const view = Args.text({ name: "view" }).pipe(
  Args.withDescription("runs|workflow|automation|proposals|simulations|decisions|lineage|ingestion|ingest|graph|revisit|scorecard|budget|claims|improvements|review|queue|incidents|journal|operate|evals|checklist|soak|next-actions"),
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
  Options.withDescription("Review/operate target kind: run|proposal|improvement"),
  Options.optional,
);

const action = Options.text("action").pipe(
  Options.withDescription("Review action: approve|scope_trial|defer|revisit|archive|queue|start_review|promote|dismiss"),
  Options.optional,
);

const inputType = Options.text("type").pipe(
  Options.withDescription("For ingest: url|document|text|repo"),
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

const actor = Options.text("actor").pipe(
  Options.withDescription("Operator actor id used for RBAC and audit"),
  Options.optional,
);

export const research = Command.make(
  "research",
  { view, target, state, tag, recent, kind, action, inputType, problemArea, title, runId, actor },
  ({ view, target: targetOpt, state: stateOpt, tag: tagOpt, recent, kind: kindOpt, action: actionOpt, inputType: inputTypeOpt, problemArea: problemAreaOpt, title: titleOpt, runId: runIdOpt, actor: actorOpt }) =>
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
      const actorId = Option.getOrUndefined(actorOpt) ?? process.env.ATHENA_OPERATOR_ID ?? "operator:local";
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
            const run = target ? runs.find((item) => item.id === target) : runs[0];
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
            const run = target ? runs.find((item) => item.id === target) : runs[0];
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
                `evidence  strength=${source.evidenceConfidence ?? "n/a"} freshness=${source.freshnessScore ?? "n/a"} model_conf=${source.evidenceHealth?.modelConfidence ?? "n/a"} separation=${source.evidenceHealth?.confidenceSeparation ?? "n/a"}`,
                `coverage  gaps=${source.evidenceHealth?.coverageGaps.join(", ") || "n/a"} contradiction_count=${source.evidenceHealth?.contradictionCount ?? 0}`,
                `digest  ${source.sourceDigest ?? "n/a"}`,
                "excerpt  [redacted in CLI output]",
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
            runtime.securityManager.assertActionAllowed("ingest", {
              actorRole: "operator",
              actorId,
              sessionId: resolvedSessionId,
              runId: targetRunId,
              toolName: "research_ingest",
              toolFamily: "research-orchestration",
            });
            const ingestionService = new IngestionService(runtime.teamStore, runtime.teamOrchestrator, runtime.securityManager);
            const result = await ingestionService.ingest({
              inputType: inputType as "url" | "document" | "text" | "repo",
              value: target,
              problemArea,
              title: sourceTitle,
              runId: targetRunId,
              sessionId: resolvedSessionId,
            });
            printLines([
              `run  ${result.run.id} workflow=${result.run.workflowState} stage=${result.run.currentStage}`,
              `source  ${result.source.sourceId} ${result.source.sourceType} ${result.source.status} ${result.source.title}`,
              `claims  extracted=${result.pack.claims.length} canonical=${result.pack.canonicalClaims?.length ?? 0} contradictions=${result.pack.counterEvidence.length} gaps=${result.source.evidenceHealth?.coverageGaps.join(", ") || "n/a"}`,
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
            const evidenceHealth = runtime.teamStore.buildEvidenceHealth(resolvedSessionId, target);
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
              `evidence_health  model_conf=${evidenceHealth.modelConfidence.toFixed(2)} separation=${evidenceHealth.confidenceSeparation.toFixed(2)} gaps=${evidenceHealth.coverageGaps.join(", ") || "n/a"}`,
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
          case "queue": {
            const queue = runtime.teamStore.listReviewQueue(resolvedSessionId);
            printLines(queue.map((entry) => `${entry.kind.padEnd(18)} priority=${entry.priority} status=${entry.status} id=${entry.id}  ${entry.summary} -> ${entry.actionHint}`));
            return;
          }
          case "incidents": {
            const incidents = runtime.teamStore.listIncidents(resolvedSessionId, target);
            printLines(incidents.map((incident) => `${incident.severity.padEnd(8)} ${incident.type.padEnd(20)} status=${incident.status} run=${incident.runId} proposal=${incident.proposalId ?? "n/a"} experiment=${incident.experimentId ?? "n/a"}  ${incident.summary}`));
            return;
          }
          case "evals": {
            const { OPERATOR_SUPERVISED_EVAL_FIXTURES } = await import("../research/evals/operator-supervised-fixtures.js");
            printLines(
              OPERATOR_SUPERVISED_EVAL_FIXTURES.map((fixture) =>
                `${fixture.category.padEnd(22)} ${fixture.id}  signals=${fixture.expectedSignals.join(",")}  failure=${fixture.failureMode}`,
              ),
            );
            return;
          }
          case "checklist": {
            const { buildEnvironmentAwareScenarios, buildSupervisedProductionChecklist, createSoakArtifact, loadSoakArtifact } = await import("../research/soak-harness.js");
            const { loadMachines } = await import("../remote/config.js");
            const machines = ["local", ...loadMachines().map((machine) => machine.id)];
            const artifact = loadSoakArtifact() ?? createSoakArtifact(machines, buildEnvironmentAwareScenarios(machines.filter((machine) => machine !== "local")));
            const checklist = buildSupervisedProductionChecklist(artifact.results);
            printLines(checklist.split("\n"));
            return;
          }
          case "soak": {
            const { buildEnvironmentAwareScenarios, buildSupervisedProductionChecklist, createSoakArtifact, getSoakArtifactPath, saveSoakArtifact } = await import("../research/soak-harness.js");
            const { loadMachines } = await import("../remote/config.js");
            let localSmokePassed = false;
            try {
              const smoke = await runtime.executor.exec(
                "local",
                process.platform === "win32" ? "echo athena_soak_ok" : "printf athena_soak_ok",
                5000,
                {
                  actorRole: "operator",
                  actorId,
                  sessionId: resolvedSessionId,
                  toolName: "research_soak",
                  toolFamily: "research-orchestration",
                },
              );
              localSmokePassed = smoke.exitCode === 0 && /athena_soak_ok/i.test(smoke.stdout);
            } catch {
              localSmokePassed = false;
            }
            const remoteMachineIds = loadMachines().map((machine) => machine.id);
            const artifact = createSoakArtifact(
              ["local", ...remoteMachineIds],
              buildEnvironmentAwareScenarios(remoteMachineIds, { localSmokePassed }),
            );
            const artifactPath = getSoakArtifactPath();
            saveSoakArtifact(artifact, artifactPath);
            printLines([
              `artifact  ${artifactPath}`,
              `generated_at  ${new Date(artifact.generatedAt).toISOString()}`,
              `machines  ${artifact.machineIds.join(",")}`,
              ...buildSupervisedProductionChecklist(artifact.results).split("\n"),
            ]);
            return;
          }
          case "journal": {
            if (!target) {
              console.error("Usage: athena research journal <run-id>");
              process.exit(1);
            }
            const actions = runtime.teamStore.listActionJournal(resolvedSessionId, target);
            if (!runtime.teamStore.getTeamRunForSession(resolvedSessionId, target) && actions.length === 0) {
              console.error(`Run not found in current session: ${target}`);
              process.exit(1);
            }
            const lease = runtime.teamStore.listActiveRunLeases(resolvedSessionId).find((item) => item.runId === target);
            printLines([
              `lease  owner=${lease?.ownerId ?? "n/a"} status=${lease?.status ?? "n/a"} expires_at=${lease?.expiresAt ?? "n/a"}`,
              ...actions.map((item) => `${item.state.padEnd(14)} ${item.actionType.padEnd(28)} dedupe=${item.dedupeKey}  ${item.summary}${item.error ? " err=[redacted]" : ""}`),
            ]);
            return;
          }
          case "operate": {
            if (!target || !action) {
              console.error("Usage: athena research operate <target-id> --kind run|proposal|improvement --action <action>");
              process.exit(1);
            }
            const operateKind = kind ?? "run";
            if (operateKind === "proposal") {
              runtime.securityManager.assertActionAllowed(action as import("../security/contracts.js").SecurityActionClass, {
                actorRole: "operator",
                actorId,
                sessionId: resolvedSessionId,
                actionClass: action as import("../security/contracts.js").SecurityActionClass,
                toolName: "research_operate",
                toolFamily: "research-orchestration",
              });
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
            if (operateKind === "improvement") {
              runtime.securityManager.assertActionAllowed(action as import("../security/contracts.js").SecurityActionClass, {
                actorRole: "operator",
                actorId,
                sessionId: resolvedSessionId,
                actionClass: action as import("../security/contracts.js").SecurityActionClass,
                toolName: "research_operate",
                toolFamily: "research-orchestration",
              });
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
            if (!runtime.teamStore.getTeamRunForSession(resolvedSessionId, target)) {
              console.error(`Run not found in current session: ${target}`);
              process.exit(1);
            }
            runtime.securityManager.assertActionAllowed(action as import("../security/contracts.js").SecurityActionClass, {
              actorRole: "operator",
              actorId,
              sessionId: resolvedSessionId,
              runId: target,
              actionClass: action as import("../security/contracts.js").SecurityActionClass,
              toolName: "research_operate",
              toolFamily: "research-orchestration",
            });
            if (action === "resume") {
              const updated = runtime.teamStore.resumeAutomation(target, "operator requested resume");
              if (!updated) {
                console.error(`Run not found: ${target}`);
                process.exit(1);
              }
              runtime.teamStore.clearAutomationBlock(target);
              runtime.teamStore.resolveRunIncidents(resolvedSessionId, target);
              runtime.teamStore.saveActionJournal({
                actionId: `operator-resume-${Date.now()}`,
                sessionId: resolvedSessionId,
                runId: target,
                actionType: "operator_resume",
                state: "committed",
                dedupeKey: `operator_resume:${Date.now()}`,
                summary: "operator resumed automation",
                payload: { actorId },
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
              printLines([`${updated.id}  status=${updated.status} workflow=${updated.workflowState}`, "action  resumed automation"]);
              return;
            }
            if (action === "rollback") {
              const updated = runtime.teamOrchestrator.rollbackRun(target, "operator requested rollback");
              if (!updated) {
                console.error(`Run not found or not rollbackable: ${target}`);
                process.exit(1);
              }
              runtime.teamStore.clearAutomationBlock(target);
              runtime.teamStore.resolveRunIncidents(resolvedSessionId, target);
              runtime.teamStore.saveActionJournal({
                actionId: `operator-rollback-${Date.now()}`,
                sessionId: resolvedSessionId,
                runId: target,
                actionType: "operator_rollback",
                state: "committed",
                dedupeKey: `operator_rollback:${Date.now()}`,
                summary: "operator rolled back run",
                payload: { actorId },
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
              printLines([`${updated.id}  status=${updated.status} workflow=${updated.workflowState}`, "action  rollback applied"]);
              return;
            }
            if (action === "archive") {
              const updated = runtime.teamStore.transitionWorkflow(target, "archived", "operator archived the run");
              if (!updated) {
                console.error(`Run not found: ${target}`);
                process.exit(1);
              }
              runtime.teamStore.clearAutomationBlock(target);
              runtime.teamStore.resolveRunIncidents(resolvedSessionId, target);
              printLines([`${updated.id}  status=${updated.status} workflow=${updated.workflowState}`, "action  archived"]);
              return;
            }
            console.error(`Unknown operator action: ${action}`);
            process.exit(1);
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
            runtime.securityManager.assertActionAllowed(action as import("../security/contracts.js").SecurityActionClass, {
              actorRole: "operator",
              actorId,
              sessionId: resolvedSessionId,
              actionClass: action as import("../security/contracts.js").SecurityActionClass,
              toolName: "research_review",
              toolFamily: "research-orchestration",
            });
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
            const queue = runtime.teamStore.listReviewQueue(resolvedSessionId);
            const lines = [
              ...queue.slice(0, 8).map((entry) => `${entry.kind}  ${entry.id} ${entry.actionHint}`),
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
