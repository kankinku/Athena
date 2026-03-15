import test from "node:test";
import assert from "node:assert/strict";
import { ResearchStatusPanel } from "./research-status.js";
import type { IngestionSourceRecord, TeamRunRecord } from "../../research/contracts.js";

function createRun(overrides: Partial<TeamRunRecord> = {}): TeamRunRecord {
  return {
    id: "run-1",
    sessionId: "session-1",
    goal: " Benchmark the current training loop and propose a safe improvement ",
    currentStage: "planning",
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
    iterationCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createSource(overrides: Partial<IngestionSourceRecord> = {}): IngestionSourceRecord {
  return {
    sourceId: "source-1",
    sourceType: "docs",
    title: "Scaling guide",
    status: "ingested",
    claimCount: 3,
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
      {
        canonicalClaimId: "canonical-2",
        semanticKey: "gradient-clipping-stability",
        statement: "Gradient clipping can improve stability.",
        normalizedStatement: "gradient clipping can improve stability",
        sourceClaimIds: ["claim-2"],
        evidenceIds: ["evidence-2"],
        supportTags: ["docs"],
        contradictionTags: [],
        sourceIds: ["source-1"],
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function hasProps(value: unknown): value is { props?: { children?: unknown } } {
  return typeof value === "object" && value !== null && "props" in value;
}

function extractText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((item) => extractText(item)).join("");
  }
  if (hasProps(node)) {
    return extractText(node.props?.children);
  }
  return "";
}

test("ResearchStatusPanel renders an empty-state message when no run exists", () => {
  const element = ResearchStatusPanel({ run: null, securityMode: "enforce", width: 80 });
  const text = extractText(element);

  assert.match(text, /RESEARCH/i);
  assert.match(text, /no active run/i);
  assert.match(text, /SEC/);
  assert.match(text, /enforce/);
});

test("ResearchStatusPanel renders run metadata and trims goal whitespace", () => {
  const element = ResearchStatusPanel({ run: createRun(), securityMode: "enforce", width: 80 });
  const text = extractText(element);

  assert.match(text, /RUN/);
  assert.match(text, /run-1/);
  assert.match(text, /STATE/);
  assert.match(text, /running/);
  assert.match(text, /MODE/);
  assert.match(text, /supervised-auto/);
  assert.match(text, /SEC/);
  assert.match(text, /enforce/);
  assert.match(text, /GOAL/);
  assert.doesNotMatch(text, /^\s|\s$/);
  assert.match(text, /Benchmark the current training loop and propose a safe improvement/);
});

test("ResearchStatusPanel renders ingestion summary when a source is present", () => {
  const element = ResearchStatusPanel({
    run: createRun(),
    source: createSource(),
    securityMode: "audit",
    width: 80,
  });
  const text = extractText(element);

  assert.match(text, /INGEST/);
  assert.match(text, /3\/2/);
  assert.match(text, /audit/);
});

test("ResearchStatusPanel still renders failed workflow state and failed source summary", () => {
  const element = ResearchStatusPanel({
    run: createRun({ workflowState: "failed" }),
    source: createSource({ status: "failed", claimCount: 0, canonicalClaims: [] }),
    securityMode: "enforce",
    width: 80,
  });
  const text = extractText(element);

  assert.match(text, /failed/);
  assert.match(text, /0\/0/);
});

test("ResearchStatusPanel renders a compact autonomous policy summary", () => {
  const element = ResearchStatusPanel({
    run: createRun({
      automationPolicy: {
        mode: "fully-autonomous",
        requireProposalApproval: false,
        requireExperimentApproval: false,
        requireRevisitApproval: false,
        maxAutoExperiments: 2,
        autonomyPolicy: {
          maxRiskTier: "safe",
          maxRetryCount: 1,
          maxWallClockMinutes: 45,
          requireRollbackPlan: true,
        },
      },
    }),
    securityMode: "enforce",
    width: 100,
  });
  const text = extractText(element);

  assert.match(text, /fully-autonomous/);
  assert.match(text, /AUTO/);
  assert.match(text, /risk=safe/);
  assert.match(text, /retry<=1/);
  assert.match(text, /wall<=45m/);
});
