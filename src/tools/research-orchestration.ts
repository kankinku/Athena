import type { ToolDefinition } from "../providers/types.js";
import type { GraphMemory } from "../memory/graph-memory.js";
import type { TeamOrchestrator } from "../research/team-orchestrator.js";
import type { SimulationRunner } from "../research/simulation-runner.js";
import type { TeamStore } from "../research/team-store.js";
import type { IngestionService } from "../research/ingestion-service.js";
import type { ResearchAutomationManager } from "../research/automation-manager.js";
import { checkLoopExecutionGate } from "../research/autonomous-loop.js";
import type {
  IngestionSourceRecord,
  ExperimentBudget,
  ExperimentCharter,
  ExperimentResult,
  ProposalBrief,
  ResearchCandidatePack,
} from "../research/contracts.js";
import { formatError } from "../ui/format.js";

export function createResearchOrchestrationTools(
  graphMemory: GraphMemory,
  teamOrchestrator: TeamOrchestrator,
  simulationRunner: SimulationRunner,
  teamStore: TeamStore,
  ingestionService: IngestionService,
  automationManager: ResearchAutomationManager,
  getSessionId: () => string,
): ToolDefinition[] {
  return [
    {
      name: "team_automation_tick",
      description:
        "Process automation checkpoints, timeouts, finished simulations, retries, and recovery for the current or provided session.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Optional session ID override" },
          recover: { type: "boolean", description: "Run startup recovery before processing automation" },
        },
      },
      execute: async (args) => {
        try {
          const sessionId = (args.session_id as string | undefined) ?? getSessionId();
          const runs = args.recover
            ? await automationManager.recoverSession(sessionId)
            : await automationManager.tickSession(sessionId);
          return JSON.stringify({ sessionId, updatedRuns: runs.map((run) => run.id) });
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "team_start_run",
      description:
        "Start a multi-team research workflow run. Creates a collection -> planning -> simulation tracking record with an optional budget.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "Overall research goal" },
          budget: {
            type: "object",
            description: "Optional experiment budget payload",
          },
        },
        required: ["goal"],
      },
      execute: async (args) => {
        try {
          const run = teamOrchestrator.startRun(
            args.goal as string,
            args.budget as ExperimentBudget | undefined,
          );
          return JSON.stringify(run);
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "team_record_collection",
      description:
        "Record a collection-stage Research Candidate Pack and project it into graph memory.",
      parameters: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "Team run ID" },
          pack: { type: "object", description: "Research Candidate Pack payload" },
        },
        required: ["run_id", "pack"],
      },
      execute: async (args) => {
        try {
          const updated = teamOrchestrator.recordCollectionPack(
            args.run_id as string,
            args.pack as ResearchCandidatePack,
          );
          return JSON.stringify(updated ?? { error: "run not found" });
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "team_record_proposal",
      description:
        "Record a planning-stage Proposal Brief, persist it, and link it to supporting claims in graph memory.",
      parameters: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "Team run ID" },
          proposal: { type: "object", description: "Proposal Brief payload" },
        },
        required: ["run_id", "proposal"],
      },
      execute: async (args) => {
        try {
          const updated = teamOrchestrator.recordProposalBrief(
            args.run_id as string,
            args.proposal as ProposalBrief,
          );
          return JSON.stringify(updated ?? { error: "run not found" });
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "simulation_start",
      description:
        "Launch a budgeted simulation or experiment run from an Experiment Charter and return the tracking identifiers.",
      parameters: {
        type: "object",
        properties: {
          charter: { type: "object", description: "Experiment Charter payload" },
        },
        required: ["charter"],
      },
      execute: async (args) => {
        try {
          const charter = args.charter as ExperimentCharter;
          // Loop execution gate: check the active run's policy, budget, and
          // workflow state before crossing into the simulation (execution) stage.
          const sessionId = getSessionId();
          const activeRun = teamStore.listRecentTeamRuns(sessionId, 1)[0] ?? null;
          if (activeRun) {
            const gate = checkLoopExecutionGate(activeRun);
            if (!gate.allowed) {
              return JSON.stringify({
                error: "loop_execution_gate_blocked",
                blockers: gate.blockers,
                warnings: gate.warnings,
              });
            }
          }
          const result = await simulationRunner.launch(charter);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "team_record_simulation",
      description:
        "Record a simulation-stage Experiment Result and move the team run toward reporting.",
      parameters: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "Team run ID" },
          simulation_id: { type: "string", description: "Simulation run ID" },
          result: { type: "object", description: "Experiment Result payload" },
        },
        required: ["run_id", "simulation_id", "result"],
      },
      execute: async (args) => {
        try {
          const result = simulationRunner.finalize(
            args.simulation_id as string,
            args.result as ExperimentResult,
          );
          const updated = teamOrchestrator.recordSimulationResult(
            args.run_id as string,
            result,
          );
          return JSON.stringify({ run: updated, result });
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "team_handoff_context",
      description:
        "Build a concise handoff context for the next team stage using recent proposals, simulations, and graph context.",
      parameters: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "Team run ID" },
          next_stage: { type: "string", description: "Optional target stage for the handoff" },
        },
        required: ["run_id"],
      },
      execute: async (args) => {
        try {
          const handoff = teamOrchestrator.buildHandoffContext(
            args.run_id as string,
            args.next_stage as "collection" | "planning" | "simulation" | "reporting" | undefined,
          );
          return JSON.stringify(handoff ? { handoff } : { error: "run not found" });
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "team_decisions",
      description:
        "List decision records for the current session or a specific proposal.",
      parameters: {
        type: "object",
        properties: {
          proposal_id: { type: "string", description: "Optional proposal ID filter" },
        },
      },
      execute: async (args) => {
        try {
          const decisions = teamStore.listDecisionRecords(getSessionId(), args.proposal_id as string | undefined);
          return JSON.stringify({ decisions });
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "graph_link",
      description:
        "Create or update a relationship edge between two graph-memory nodes.",
      parameters: {
        type: "object",
        properties: {
          source_id: { type: "string", description: "Source node path" },
          target_id: { type: "string", description: "Target node path" },
          relationship: { type: "string", description: "Relationship label" },
          weight: { type: "number", description: "Optional edge weight" },
          metadata: { type: "object", description: "Optional edge metadata" },
        },
        required: ["source_id", "target_id", "relationship"],
      },
      execute: async (args) => {
        try {
          graphMemory.link({
            sourceId: args.source_id as string,
            targetId: args.target_id as string,
            relationship: args.relationship as string,
            weight: args.weight as number | undefined,
            metadata: args.metadata as Record<string, unknown> | undefined,
          });
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "graph_subgraph",
      description:
        "Retrieve a bounded subgraph around one or more node paths for team handoffs and GraphRAG-style retrieval.",
      parameters: {
        type: "object",
        properties: {
          root_ids: {
            type: "array",
            items: { type: "string" },
            description: "Root node paths",
          },
          query: { type: "string", description: "Optional ranking query" },
          depth: { type: "number", description: "Traversal depth (default 1)" },
          max_nodes: { type: "number", description: "Node cap (default 25)" },
        },
        required: ["root_ids"],
      },
      execute: async (args) => {
        try {
          const subgraph = args.query
            ? graphMemory.buildRankedSubgraph(args.root_ids as string[], {
                query: args.query as string,
                depth: (args.depth as number | undefined) ?? 1,
                maxNodes: (args.max_nodes as number | undefined) ?? 25,
              })
            : graphMemory.buildSubgraph(
                args.root_ids as string[],
                (args.depth as number | undefined) ?? 1,
                (args.max_nodes as number | undefined) ?? 25,
              );
          return JSON.stringify(subgraph);
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "ingestion_extract_source",
      description:
        "Extract claim candidates from a URL, document path, or raw text, then attach them to the current research run.",
      parameters: {
        type: "object",
        properties: {
          input_type: { type: "string", description: "url|document|text|repo" },
          value: { type: "string", description: "URL, local file path, or raw text" },
          problem_area: { type: "string", description: "Research problem area for canonical claim grouping" },
          title: { type: "string", description: "Optional source title override" },
          run_id: { type: "string", description: "Optional existing run id to attach ingestion to" },
          source_type: { type: "string", description: "Optional paper|repo|docs|benchmark|manual override" },
        },
        required: ["input_type", "value", "problem_area"],
      },
      execute: async (args) => {
        try {
          const result = await ingestionService.ingest({
            inputType: args.input_type as "url" | "document" | "text" | "repo",
            value: args.value as string,
            problemArea: args.problem_area as string,
            title: args.title as string | undefined,
            runId: args.run_id as string | undefined,
            sourceType: args.source_type as IngestionSourceRecord["sourceType"] | undefined,
            sessionId: getSessionId(),
          });
          return JSON.stringify({
            run: result.run,
            source: result.source,
            pack: {
              candidateId: result.pack.candidateId,
              claimCount: result.pack.claims.length,
              canonicalClaimCount: result.pack.canonicalClaims?.length ?? 0,
              contradictionCount: result.pack.counterEvidence.length,
              openQuestionCount: result.pack.openQuestions?.length ?? 0,
            },
          });
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
    {
      name: "ingestion_register_source",
      description:
        "Register an external or manual research source for later claim extraction and candidate-pack ingestion.",
      parameters: {
        type: "object",
        properties: {
          source_type: { type: "string", description: "paper|repo|docs|benchmark|manual" },
          title: { type: "string", description: "Source title" },
          url: { type: "string", description: "Optional source URL" },
          notes: { type: "string", description: "Optional notes" },
        },
        required: ["source_type", "title"],
      },
      execute: async (args) => {
        try {
          const now = Date.now();
          const record: IngestionSourceRecord = {
            sourceId: `${args.source_type}-${now}`,
            sourceType: args.source_type as IngestionSourceRecord["sourceType"],
            title: args.title as string,
            url: args.url as string | undefined,
            status: "pending",
            notes: args.notes as string | undefined,
            createdAt: now,
            updatedAt: now,
          };
          teamStore.saveIngestionSource(getSessionId(), record);
          return JSON.stringify(record);
        } catch (err) {
          return JSON.stringify({ error: formatError(err) });
        }
      },
    },
  ];
}
