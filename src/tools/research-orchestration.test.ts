import test from "node:test";
import assert from "node:assert/strict";
import { createResearchOrchestrationTools } from "./research-orchestration.js";
import type {
  ExperimentBudget,
  ExperimentCharter,
  ExperimentResult,
  IngestionSourceRecord,
  ProposalBrief,
  ResearchCandidatePack,
  TeamRunRecord,
} from "../research/contracts.js";
import type { ToolDefinition } from "../providers/types.js";

function createRun(id = "run-1"): TeamRunRecord {
  return {
    id,
    sessionId: "session-1",
    goal: "Improve the training loop",
    currentStage: "collection",
    status: "active",
    workflowState: "running",
    automationPolicy: {
      mode: "supervised-auto",
      requireProposalApproval: false,
      requireExperimentApproval: false,
      requireRevisitApproval: false,
      maxAutoExperiments: 2,
    },
    checkpointPolicy: {
      intervalMinutes: 30,
      onWorkflowStates: ["running", "evaluating"],
    },
    retryPolicy: {
      maxRetries: 2,
      retryOn: ["inconclusive"],
    },
    timeoutPolicy: {
      maxRunMinutes: 120,
    },
    automationState: {
      retryCount: 0,
      resumeCount: 0,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createCharter(): ExperimentCharter {
  return {
    experimentId: "exp-1",
    proposalId: "proposal-1",
    machineId: "local",
    command: "python train.py",
    evaluationMetric: "loss",
    patchScope: ["trainer"],
    allowedChangeUnit: "trainer",
    budget: { maxConcurrentRuns: 1, maxWallClockMinutes: 30 },
    rollbackPlan: "git restore trainer.py",
    description: "Run the local baseline",
  };
}

function createProposal(): ProposalBrief {
  return {
    proposalId: "proposal-1",
    title: "Reduce optimizer overhead",
    summary: "Try a lighter optimizer schedule",
    targetModules: ["trainer"],
    expectedGain: "moderate",
    expectedRisk: "low",
    codeChangeScope: ["trainer"],
    status: "candidate",
    experimentBudget: { maxWallClockMinutes: 20 },
    stopConditions: [],
    reconsiderConditions: [],
    claimIds: [],
  };
}

function createPack(): ResearchCandidatePack {
  return {
    candidateId: "candidate-1",
    problemArea: "training",
    documents: ["doc-1"],
    claims: [
      {
        claimId: "claim-1",
        statement: "Mixed precision can improve throughput.",
      },
    ],
    canonicalClaims: [
      {
        canonicalClaimId: "canonical-1",
        semanticKey: "mixed-precision-throughput",
        statement: "Mixed precision improves throughput.",
        normalizedStatement: "mixed precision improves throughput",
        sourceClaimIds: ["claim-1"],
        evidenceIds: ["evidence-1"],
        supportTags: ["benchmark"],
        contradictionTags: [],
        sourceIds: ["source-1"],
      },
    ],
    methods: ["benchmark"],
    counterEvidence: [],
  };
}

function createResult(): ExperimentResult {
  return {
    experimentId: "exp-1",
    proposalId: "proposal-1",
    outcomeStatus: "keep",
    beforeMetrics: { loss: 1.2 },
    afterMetrics: { loss: 0.9 },
    resourceDelta: {},
    surprisingFindings: ["Lower loss after 1 epoch"],
    notes: "Looks promising",
  };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `Expected tool ${name} to exist`);
  return tool;
}

test("createResearchOrchestrationTools exposes the expected tool surface", () => {
  const tools = createResearchOrchestrationTools(
    {
      link: () => undefined,
      buildSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
      buildRankedSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
    } as never,
    {
      startRun: () => createRun(),
      recordCollectionPack: () => createRun(),
      recordProposalBrief: () => createRun(),
      recordSimulationResult: () => createRun(),
      buildHandoffContext: () => ({ notes: [] }),
    } as never,
    {
      launch: async () => ({ simulationId: "sim-1", taskId: "local:100" }),
      finalize: () => createResult(),
    } as never,
    {
      listDecisionRecords: () => [],
      saveIngestionSource: () => undefined,
    } as never,
    {
      ingest: async () => ({
        run: createRun(),
        source: {
          sourceId: "source-1",
          sourceType: "docs",
          title: "Guide",
          status: "ingested",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        pack: createPack(),
      }),
    } as never,
    {
      recoverSession: async () => [createRun()],
      tickSession: async () => [createRun()],
    } as never,
    () => "session-1",
  );

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "team_automation_tick",
      "team_start_run",
      "team_record_collection",
      "team_record_proposal",
      "simulation_start",
      "team_record_simulation",
      "team_handoff_context",
      "team_decisions",
      "graph_link",
      "graph_subgraph",
      "ingestion_extract_source",
      "ingestion_register_source",
    ],
  );
});

test("team_automation_tick chooses recoverSession when recover=true", async () => {
  const calls: string[] = [];
  const tools = createResearchOrchestrationTools(
    {
      link: () => undefined,
      buildSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
      buildRankedSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      recoverSession: async () => {
        calls.push("recover");
        return [createRun("run-recover")];
      },
      tickSession: async () => {
        calls.push("tick");
        return [createRun("run-tick")];
      },
    } as never,
    () => "session-99",
  );

  const output = await getTool(tools, "team_automation_tick").execute({ recover: true });
  assert.deepEqual(calls, ["recover"]);
  assert.deepEqual(JSON.parse(output), { sessionId: "session-99", updatedRuns: ["run-recover"] });
});

test("team_start_run and simulation_start return orchestrator payloads", async () => {
  const budget: ExperimentBudget = { maxWallClockMinutes: 15 };
  let capturedBudget: ExperimentBudget | undefined;
  let capturedCharter: ExperimentCharter | undefined;

  const tools = createResearchOrchestrationTools(
    {
      link: () => undefined,
      buildSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
      buildRankedSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
    } as never,
    {
      startRun: (_goal: string, toolBudget?: ExperimentBudget) => {
        capturedBudget = toolBudget;
        return createRun("run-started");
      },
    } as never,
    {
      launch: async (charter: ExperimentCharter) => {
        capturedCharter = charter;
        return { simulationId: "sim-123", taskId: "local:777", logPath: "/tmp/sim.log" };
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    () => "session-1",
  );

  const runOutput = await getTool(tools, "team_start_run").execute({ goal: "Improve throughput", budget });
  const simOutput = await getTool(tools, "simulation_start").execute({ charter: createCharter() });

  assert.equal(capturedBudget?.maxWallClockMinutes, 15);
  assert.equal(capturedCharter?.proposalId, "proposal-1");
  assert.equal(JSON.parse(runOutput).id, "run-started");
  assert.deepEqual(JSON.parse(simOutput), {
    simulationId: "sim-123",
    taskId: "local:777",
    logPath: "/tmp/sim.log",
  });
});

test("graph tools delegate to graph memory and return serialized output", async () => {
  const links: Array<{ sourceId: string; targetId: string; relationship: string }> = [];
  const tools = createResearchOrchestrationTools(
    {
      link: (edge: { sourceId: string; targetId: string; relationship: string }) => {
        links.push(edge);
      },
      buildSubgraph: (rootIds: string[], depth: number, maxNodes: number) => ({
        rootIds,
        nodes: [{ id: "node-1", label: "Node", kind: "note" }],
        edges: [{ sourceId: "a", targetId: "b", relationship: `depth:${depth}:max:${maxNodes}` }],
      }),
      buildRankedSubgraph: (rootIds: string[]) => ({
        rootIds,
        nodes: [{ id: "node-ranked", label: "Ranked", kind: "note" }],
        edges: [],
      }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    () => "session-1",
  );

  const linkOutput = await getTool(tools, "graph_link").execute({
    source_id: "/research/a",
    target_id: "/research/b",
    relationship: "supports",
  });
  const subgraphOutput = await getTool(tools, "graph_subgraph").execute({
    root_ids: ["/research/a"],
    depth: 2,
    max_nodes: 10,
  });
  const rankedOutput = await getTool(tools, "graph_subgraph").execute({
    root_ids: ["/research/a"],
    query: "throughput",
  });

  assert.deepEqual(JSON.parse(linkOutput), { ok: true });
  assert.equal(links.length, 1);
  assert.equal(links[0]?.sourceId, "/research/a");
  assert.equal(links[0]?.targetId, "/research/b");
  assert.equal(links[0]?.relationship, "supports");
  assert.equal(JSON.parse(subgraphOutput).edges[0].relationship, "depth:2:max:10");
  assert.equal(JSON.parse(rankedOutput).nodes[0].id, "node-ranked");
});

test("ingestion tools return reduced summaries and persist manual sources", async () => {
  const savedSources: IngestionSourceRecord[] = [];
  const tools = createResearchOrchestrationTools(
    {
      link: () => undefined,
      buildSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
      buildRankedSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
    } as never,
    {} as never,
    {} as never,
    {
      saveIngestionSource: (_sessionId: string, record: IngestionSourceRecord) => {
        savedSources.push(record);
      },
      listDecisionRecords: () => [],
    } as never,
    {
      ingest: async () => ({
        run: createRun("run-ingest"),
        source: {
          sourceId: "source-1",
          sourceType: "docs",
          title: "Guide",
          status: "ingested",
          claimCount: 1,
          canonicalClaims: createPack().canonicalClaims,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        pack: {
          ...createPack(),
          openQuestions: ["Does this hold at larger batch sizes?"],
        },
      }),
    } as never,
    {} as never,
    () => "session-55",
  );

  const extracted = await getTool(tools, "ingestion_extract_source").execute({
    input_type: "text",
    value: "Mixed precision improves throughput.",
    problem_area: "training",
  });
  const registered = await getTool(tools, "ingestion_register_source").execute({
    source_type: "manual",
    title: "Operator note",
    notes: "Use this later",
  });

  const extractedJson = JSON.parse(extracted);
  const registeredJson = JSON.parse(registered) as IngestionSourceRecord;

  assert.equal(extractedJson.run.id, "run-ingest");
  assert.deepEqual(extractedJson.pack, {
    candidateId: "candidate-1",
    claimCount: 1,
    canonicalClaimCount: 1,
    contradictionCount: 0,
    openQuestionCount: 1,
  });
  assert.equal(registeredJson.sourceType, "manual");
  assert.equal(savedSources.length, 1);
  assert.equal(savedSources[0]?.title, "Operator note");
});

test("team_record_simulation combines simulation finalization with run update", async () => {
  let finalizedSimulationId = "";
  let finalizedResult: ExperimentResult | undefined;

  const tools = createResearchOrchestrationTools(
    {
      link: () => undefined,
      buildSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
      buildRankedSubgraph: () => ({ rootIds: [], nodes: [], edges: [] }),
    } as never,
    {
      recordSimulationResult: () => createRun("run-reporting"),
    } as never,
    {
      finalize: (simulationId: string, result: ExperimentResult) => {
        finalizedSimulationId = simulationId;
        finalizedResult = result;
        return result;
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    () => "session-1",
  );

  const result = createResult();
  const output = await getTool(tools, "team_record_simulation").execute({
    run_id: "run-1",
    simulation_id: "sim-99",
    result,
  });

  assert.equal(finalizedSimulationId, "sim-99");
  assert.equal(finalizedResult?.outcomeStatus, "keep");
  assert.equal(JSON.parse(output).run.id, "run-reporting");
  assert.equal(JSON.parse(output).result.outcomeStatus, "keep");
});
