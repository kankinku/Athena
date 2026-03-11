import { nanoid } from "nanoid";
import type { ExtractedClaim, IngestionSourceRecord, ResearchCandidatePack } from "./contracts.js";

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
  const normalizedMethods = dedupe((input.methods ?? []).map(normalizeMethodTag).filter(Boolean));
  const claims = input.claims.map((claim) => normalizeClaim(claim, input.source, normalizedMethods[0]));
  return {
    candidateId: `candidate-${input.source.sourceId}`,
    sourceId: input.source.sourceId,
    problemArea: input.problemArea,
    documents: input.source.url ? [input.source.url] : [input.source.title],
    claims,
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

function normalizeClaim(
  claim: ExtractedClaim,
  source: IngestionSourceRecord,
  methodTag?: string,
): ExtractedClaim {
  const supportTags = inferSupportTags(claim.statement);
  const contradictionTags = inferContradictionTags(claim.statement);
  return {
    ...claim,
    sourceId: claim.sourceId ?? source.sourceId,
    source: claim.source ?? source.title,
    methodTag: claim.methodTag ?? methodTag,
    supportTags,
    contradictionTags,
  };
}

function normalizeMethodTag(method: string): string {
  return method
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function average(values: Array<number | undefined>): number | undefined {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (valid.length === 0) return undefined;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
