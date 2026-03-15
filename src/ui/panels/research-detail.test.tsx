import test from "node:test";
import assert from "node:assert/strict";
import { ResearchDetailPanel } from "./research-detail.js";
import type { IterationCycleRecord, ProposalBrief } from "../../research/contracts.js";

function createIteration(overrides: Partial<IterationCycleRecord> = {}): IterationCycleRecord {
  return {
    cycleId: "cycle-1",
    runId: "run-1",
    sessionId: "session-1",
    iterationIndex: 1,
    entryState: "revisit_due",
    exitState: "running",
    reason: "reconsideration_trigger_satisfied",
    reasonDetail: "Reconsideration trigger met",
    evidenceLinks: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function createProposal(overrides: Partial<ProposalBrief> = {}): ProposalBrief {
  return {
    proposalId: "prop-1",
    title: "Optimize training loop throughput",
    summary: "Batch size tuning for faster iteration",
    targetModules: ["training"],
    expectedGain: "15% throughput",
    expectedRisk: "minimal",
    codeChangeScope: ["src/training/loop.ts"],
    status: "candidate",
    experimentBudget: { maxIterations: 3, maxCostUsd: 10 },
    stopConditions: ["regression > 5%"],
    reconsiderConditions: ["new evidence"],
    claimIds: ["claim-1"],
    claimSupport: {
      claimIds: ["claim-1"],
      sourceCoverage: 0.8,
      evidenceStrength: 0.75,
      freshnessScore: 0.9,
      contradictionPressure: 0.1,
      unresolvedClaims: [],
    },
    scorecard: {
      proposalId: "prop-1",
      merit: 0.8,
      risk: 0.2,
      decisionScore: 0.78,
      weightedScore: 0.75,
      axisScores: {
        expected_gain: 0.7,
        evidence_strength: 0.75,
        evidence_freshness: 0.9,
        contradiction_pressure: 0.1,
        memory_risk: 0.2,
        stability_risk: 0.1,
        integration_cost: 0.3,
        rollback_difficulty: 0.2,
        observability_readiness: 0.6,
      },
      evaluatorSummaries: [],
      disagreementFlags: [],
      scoreVersion: "1",
    },
    ...overrides,
  };
}

// Minimal recursive text extraction (same as research-status.test.tsx)
function extractText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((item) => extractText(item)).join("");
  if (hasProps(node)) return extractText(node.props?.children);
  return "";
}

function hasProps(value: unknown): value is { props?: { children?: unknown } } {
  return typeof value === "object" && value !== null && "props" in value;
}

test("ResearchDetailPanel returns null when no data", () => {
  const element = ResearchDetailPanel({ iterations: [], proposals: [], width: 80 });
  assert.equal(element, null);
});

test("ResearchDetailPanel renders iteration cycles", () => {
  const element = ResearchDetailPanel({
    iterations: [
      createIteration({ cycleId: "c-1", iterationIndex: 1, reason: "reconsideration_trigger_satisfied" }),
      createIteration({ cycleId: "c-2", iterationIndex: 2, reason: "simulation_regression" }),
    ],
    proposals: [],
    width: 80,
  });
  const text = extractText(element);

  assert.match(text, /ITERATIONS \(2\)/);
  assert.match(text, /#1/);
  assert.match(text, /#2/);
  assert.match(text, /reconsider/);
  assert.match(text, /regression/);
  assert.match(text, /revisit_due/);
  assert.match(text, /running/);
});

test("ResearchDetailPanel renders proposals with scores", () => {
  const element = ResearchDetailPanel({
    iterations: [],
    proposals: [
      createProposal({ proposalId: "p-1", status: "ready_for_experiment", title: "First proposal" }),
      createProposal({ proposalId: "p-2", status: "revisit_due", title: "Second proposal" }),
    ],
    width: 80,
  });
  const text = extractText(element);

  assert.match(text, /PROPOSALS \(2\)/);
  assert.match(text, /ready_for_exp/);
  assert.match(text, /revisit_due/);
  assert.match(text, /0\.78/);
  assert.match(text, /0\.75/);
  assert.match(text, /First proposal/);
});

test("ResearchDetailPanel renders both iterations and proposals together", () => {
  const element = ResearchDetailPanel({
    iterations: [createIteration()],
    proposals: [createProposal()],
    width: 80,
  });
  const text = extractText(element);

  assert.match(text, /ITERATIONS/);
  assert.match(text, /PROPOSALS/);
});
