import test from "node:test";
import assert from "node:assert/strict";

import { buildCanonicalClaims, createCandidatePackFromSource, createIngestionSource, inferContradictionTags, inferSupportTags } from "./ingestion.js";
import { normalizeClaimStatement } from "./claim-graph.js";

test("buildCanonicalClaims merges duplicate source claims into one canonical claim", () => {
  const source = createIngestionSource({
    sourceType: "manual",
    title: "Research note",
  });

  const pack = createCandidatePackFromSource({
    source,
    problemArea: "training stability",
    methods: ["Gradient Checkpointing"],
    claims: [
      {
        claimId: "claim-a",
        statement: "Gradient checkpointing reduces peak memory during training.",
        confidence: 0.8,
        freshnessScore: 0.7,
      },
      {
        claimId: "claim-b",
        statement: "The gradient checkpointing reduces peak memory during training!",
        confidence: 0.6,
        freshnessScore: 0.5,
      },
    ],
  });

  assert.equal(pack.canonicalClaims?.length, 1);
  assert.equal(pack.claims[0]?.canonicalClaimId, pack.claims[1]?.canonicalClaimId);
  assert.equal(pack.canonicalClaims?.[0]?.sourceClaimIds.length, 2);
  assert.equal(pack.canonicalClaims?.[0]?.confidence, 0.7);
  assert.equal(pack.canonicalClaims?.[0]?.freshnessScore, 0.6);
});

test("buildCanonicalClaims preserves distinct canonical claims for different semantics", () => {
  const canonicalClaims = buildCanonicalClaims([
    {
      claimId: "claim-a",
      sourceClaimId: "claim-a",
      canonicalClaimId: "claim-1",
      semanticKey: "memory",
      normalizedStatement: "checkpointing reduces memory",
      statement: "Checkpointing reduces memory.",
      confidence: 0.8,
      freshnessScore: 0.7,
      sourceId: "source-1",
      supportTags: ["memory"],
      contradictionTags: [],
    },
    {
      claimId: "claim-b",
      sourceClaimId: "claim-b",
      canonicalClaimId: "claim-2",
      semanticKey: "latency",
      normalizedStatement: "checkpointing slows throughput",
      statement: "Checkpointing slows throughput.",
      confidence: 0.4,
      freshnessScore: 0.3,
      sourceId: "source-1",
      supportTags: ["latency"],
      contradictionTags: ["counter_evidence"],
    },
  ]);

  assert.equal(canonicalClaims.length, 2);
});

test("normalizeClaimStatement collapses punctuation and demonstratives safely", () => {
  assert.equal(
    normalizeClaimStatement("This checkpointing's throughput -- improves!"),
    "checkpointings throughput improves",
  );
});

test("inferSupportTags detects broader evidence and observability language", () => {
  const tags = inferSupportTags("Measured benchmark telemetry shows faster runtime and clearer metrics.");

  assert.ok(tags.includes("latency"));
  assert.ok(tags.includes("observability"));
  assert.ok(tags.includes("evidence"));
});

test("inferContradictionTags does not treat generic negation as automatic contradiction", () => {
  assert.deepEqual(inferContradictionTags("Not all runs need checkpointing for small models."), []);
  assert.deepEqual(inferContradictionTags("However, the run regressed and became unstable."), ["counter_evidence"]);
  assert.deepEqual(inferContradictionTags("The change did not improve throughput in repeated tests."), ["counter_evidence"]);
});
