import { nanoid } from "nanoid";
import type {
  CanonicalClaim,
  ExtractedClaim,
  IngestionSourceRecord,
  ResearchCandidatePack,
} from "./contracts.js";
import {
  buildCanonicalClaimId,
  buildClaimSemanticKey,
  normalizeClaimStatement,
  normalizeMethodTag,
} from "./claim-graph.js";

export function createIngestionSource(input: {
  sourceType: IngestionSourceRecord["sourceType"];
  title: string;
  url?: string;
  notes?: string;
}): IngestionSourceRecord {
  const now = Date.now();
  return {
    sourceId: nanoid(),
    sourceType: input.sourceType,
    title: input.title,
    url: input.url,
    status: "pending",
    notes: input.notes,
    claimCount: 0,
    linkedProposalCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createCandidatePackFromSource(input: {
  source: IngestionSourceRecord;
  problemArea: string;
  claims: ResearchCandidatePack["claims"];
  methods?: string[];
  counterEvidence?: string[];
  openQuestions?: string[];
}): ResearchCandidatePack {
  const normalizedMethods = dedupe((input.methods ?? []).map(normalizeMethodTag).filter(isNonEmptyString));
  const claims = input.claims.map((claim) => normalizeClaim(claim, input.source, input.problemArea, normalizedMethods[0]));
  const canonicalClaims = buildCanonicalClaims(claims);
  return {
    candidateId: `candidate-${input.source.sourceId}`,
    sourceId: input.source.sourceId,
    problemArea: input.problemArea,
    documents: input.source.url ? [input.source.url] : [input.source.title],
    claims,
    canonicalClaims,
    methods: input.methods ?? [],
    normalizedMethods,
    counterEvidence: input.counterEvidence ?? [],
    noveltyScore: undefined,
    freshnessScore: average(claims.map((claim) => claim.freshnessScore)),
    evidenceConfidence: average(claims.map((claim) => claim.confidence)),
    contradictions: input.counterEvidence ?? [],
    openQuestions: input.openQuestions ?? [],
  };
}

export function buildCanonicalClaims(claims: ExtractedClaim[]): CanonicalClaim[] {
  const canonicalMap = new Map<string, CanonicalClaim>();

  for (const claim of claims) {
    const canonicalClaimId = claim.canonicalClaimId ?? buildCanonicalClaimId({
      statement: claim.statement,
      methodTag: claim.methodTag,
    });
    const semanticKey = claim.semanticKey ?? buildClaimSemanticKey({
      statement: claim.statement,
      methodTag: claim.methodTag,
    });
    const normalizedStatement = claim.normalizedStatement ?? normalizeClaimStatement(claim.statement);
    const current = canonicalMap.get(canonicalClaimId);
    const next: CanonicalClaim = current
      ? {
          ...current,
          sourceClaimIds: dedupe([...current.sourceClaimIds, claim.sourceClaimId ?? claim.claimId]),
          evidenceIds: dedupe([...current.evidenceIds, ...(claim.evidenceIds ?? [])]),
          supportTags: dedupe([...current.supportTags, ...(claim.supportTags ?? [])]),
          contradictionTags: dedupe([...current.contradictionTags, ...(claim.contradictionTags ?? [])]),
          sourceIds: dedupe([...current.sourceIds, ...(claim.sourceId ? [claim.sourceId] : [])]),
          confidence: averageDefined([current.confidence, claim.confidence]),
          freshnessScore: averageDefined([current.freshnessScore, claim.freshnessScore]),
        }
      : {
          canonicalClaimId,
          semanticKey,
          statement: claim.statement,
          normalizedStatement,
          primaryMethodTag: claim.methodTag,
          sourceClaimIds: [claim.sourceClaimId ?? claim.claimId],
          evidenceIds: [...(claim.evidenceIds ?? [])],
          supportTags: [...(claim.supportTags ?? [])],
          contradictionTags: [...(claim.contradictionTags ?? [])],
          confidence: claim.confidence,
          freshnessScore: claim.freshnessScore,
          sourceIds: claim.sourceId ? [claim.sourceId] : [],
        };
    canonicalMap.set(canonicalClaimId, next);
  }

  return [...canonicalMap.values()];
}

function normalizeClaim(
  claim: ExtractedClaim,
  source: IngestionSourceRecord,
  problemArea: string,
  methodTag?: string,
): ExtractedClaim {
  const normalizedMethodTag = claim.methodTag ?? methodTag;
  const supportTags = dedupe([...(claim.supportTags ?? []), ...inferSupportTags(claim.statement)]);
  const contradictionTags = dedupe([...(claim.contradictionTags ?? []), ...inferContradictionTags(claim.statement)]);
  const normalizedStatement = normalizeClaimStatement(claim.statement);
  const semanticKey = buildClaimSemanticKey({
    statement: claim.statement,
    methodTag: normalizedMethodTag,
    problemArea,
  });
  const canonicalClaimId = buildCanonicalClaimId({
    statement: claim.statement,
    methodTag: normalizedMethodTag,
    problemArea,
  });
  return {
    ...claim,
    sourceClaimId: claim.sourceClaimId ?? claim.claimId,
    canonicalClaimId,
    semanticKey,
    normalizedStatement,
    sourceId: claim.sourceId ?? source.sourceId,
    source: claim.source ?? source.title,
    methodTag: normalizedMethodTag,
    supportTags,
    contradictionTags,
  };
}

function inferSupportTags(statement: string): string[] {
  const lower = statement.toLowerCase();
  const tags: string[] = [];
  if (lower.includes("memory")) tags.push("memory");
  if (lower.includes("latency") || lower.includes("throughput")) tags.push("latency");
  if (lower.includes("rollback")) tags.push("rollback");
  if (lower.includes("observe") || lower.includes("monitor")) tags.push("observability");
  return tags;
}

function inferContradictionTags(statement: string): string[] {
  const lower = statement.toLowerCase();
  const tags: string[] = [];
  if (/(not|however|but|regress|worse|increase wall-clock|slower)/.test(lower)) tags.push("counter_evidence");
  return tags;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  return average(values);
}

function average(values: Array<number | undefined>): number | undefined {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (valid.length === 0) return undefined;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
