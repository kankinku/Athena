import { createHash } from "node:crypto";

export const CLAIM_GRAPH_RELATIONSHIPS = {
  citesClaim: "cites_claim",
  containsClaim: "contains_claim",
  canonicalizedAs: "canonicalized_as",
  supportedBy: "supported_by",
  proposesMethod: "proposes_method",
  hasCounterEvidence: "has_counter_evidence",
  collectionOutput: "collection_output",
  planningOutput: "planning_output",
  evaluatedBy: "evaluated_by",
  derivedFrom: "derived_from",
  validatedBy: "validated_by",
  simulationOutput: "simulation_output",
  decisionRecord: "decision_record",
  decisionOutput: "decision_output",
  revisitSupportedBy: "revisit_supported_by",
} as const;

export type ClaimGraphRelationship =
  (typeof CLAIM_GRAPH_RELATIONSHIPS)[keyof typeof CLAIM_GRAPH_RELATIONSHIPS];

export function normalizeClaimStatement(statement: string): string {
  return statement
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/\b(this|that|these|those)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMethodTag(method?: string): string | undefined {
  if (!method) return undefined;
  const normalized = method
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

export function buildClaimSemanticKey(input: {
  statement: string;
  methodTag?: string;
  problemArea?: string;
}): string {
  const parts = [
    normalizeClaimStatement(input.statement),
    normalizeMethodTag(input.methodTag),
    input.problemArea?.trim().toLowerCase(),
  ].filter(Boolean);
  return parts.join("::");
}

export function buildCanonicalClaimId(input: {
  statement: string;
  methodTag?: string;
  problemArea?: string;
}): string {
  const semanticKey = buildClaimSemanticKey(input);
  const digest = createHash("sha1").update(semanticKey).digest("hex").slice(0, 16);
  return `claim-${digest}`;
}

export function buildCanonicalClaimPath(claimId: string): string {
  return claimId.startsWith("/research/claims/") ? claimId : `/research/claims/${claimId}`;
}

export function buildSourceClaimPath(candidateId: string, sourceClaimId: string): string {
  return `/research/candidates/${candidateId}/claims/${sourceClaimId}`;
}

export function resolveCanonicalClaimReference(claimReference: string): string {
  return claimReference.startsWith("/")
    ? claimReference
    : buildCanonicalClaimPath(claimReference);
}
