import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import type {
  CanonicalClaim,
  CitationSpan,
  ExtractedClaim,
  IngestionSourceRecord,
  ResearchCandidatePack,
  SourceAttribution,
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

export function updateIngestionSourceContent(
  source: IngestionSourceRecord,
  content: string,
): IngestionSourceRecord {
  return {
    ...source,
    sourceDigest: createHash("sha1").update(content).digest("hex").slice(0, 16),
    sourceExcerpt: truncateText(content, 280),
    updatedAt: Date.now(),
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
          citationSpans: dedupeCitationSpans([...(current.citationSpans ?? []), ...(claim.citationSpans ?? [])]),
          sourceAttributions: dedupeSourceAttributions([...(current.sourceAttributions ?? []), ...(claim.sourceAttributions ?? [])]),
          supportCount: (current.supportCount ?? 0) + (isSupportClaim(claim) ? 1 : 0),
          contradictionCount: (current.contradictionCount ?? 0) + (isContradictionClaim(claim) ? 1 : 0),
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
          citationSpans: [...(claim.citationSpans ?? [])],
          sourceAttributions: [...(claim.sourceAttributions ?? [])],
          supportCount: isSupportClaim(claim) ? 1 : 0,
          contradictionCount: isContradictionClaim(claim) ? 1 : 0,
        };
    canonicalMap.set(canonicalClaimId, next);
  }

  return [...canonicalMap.values()];
}

export function inferSupportTags(statement: string): string[] {
  const lower = normalizeClaimStatement(statement);
  const tags: string[] = [];
  if (/(memory|oom|ram|vram|activation)/.test(lower)) tags.push("memory");
  if (/(latency|throughput|wall clock|runtime|speed|faster|slower)/.test(lower)) tags.push("latency");
  if (/(rollback|revert|recovery|undo)/.test(lower)) tags.push("rollback");
  if (/(observe|monitor|trace|telemetry|metric|alert)/.test(lower)) tags.push("observability");
  if (/(evidence|benchmark|measure|measured|validated|experiment)/.test(lower)) tags.push("evidence");
  return dedupe(tags);
}

export function inferContradictionTags(statement: string): string[] {
  const lower = normalizeClaimStatement(statement);
  const tags: string[] = [];
  if (/(however|but|although|despite)/.test(lower)) tags.push("counter_evidence");
  if (/(regress|worse|slower|unstable|instability|fails|failure|crash)/.test(lower)) tags.push("counter_evidence");
  if (/(no evidence|not supported|does not improve|did not improve|not reproducible|unable to reproduce)/.test(lower)) {
    tags.push("counter_evidence");
  }
  return dedupe(tags);
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
  const citationSpans = claim.citationSpans ?? buildCitationSpans(claim.statement, claim.rationaleSpans);
  const sourceAttributions = claim.sourceAttributions ?? buildSourceAttributions(source, citationSpans);
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
    citationSpans,
    sourceAttributions,
    disposition: claim.disposition ?? inferDisposition(supportTags, contradictionTags),
  };
}

function buildCitationSpans(statement: string, rationaleSpans?: string[]): CitationSpan[] {
  const spans = (rationaleSpans && rationaleSpans.length > 0 ? rationaleSpans : [statement])
    .filter(isNonEmptyString)
    .map((text, index) => ({
      text,
      start: index === 0 ? 0 : statement.indexOf(text),
      end: index === 0 ? statement.length : statement.indexOf(text) + text.length,
      locator: `span:${index + 1}`,
    }))
    .map((span) => ({
      ...span,
      start: Math.max(0, span.start),
      end: Math.max(span.start, span.end),
    }));
  return dedupeCitationSpans(spans);
}

function buildSourceAttributions(
  source: IngestionSourceRecord,
  citationSpans: CitationSpan[],
): SourceAttribution[] {
  if (citationSpans.length === 0) {
    return [{ sourceId: source.sourceId, title: source.title, url: source.url }];
  }
  return citationSpans.map((span) => ({
    sourceId: source.sourceId,
    title: source.title,
    url: source.url,
    locator: span.locator,
  }));
}

function inferDisposition(
  supportTags: string[],
  contradictionTags: string[],
): ExtractedClaim["disposition"] {
  if (supportTags.length > 0 && contradictionTags.length > 0) return "mixed";
  if (contradictionTags.length > 0) return "contradiction";
  return "support";
}

function isSupportClaim(claim: ExtractedClaim): boolean {
  return (claim.disposition ?? inferDisposition(claim.supportTags ?? [], claim.contradictionTags ?? [])) !== "contradiction";
}

function isContradictionClaim(claim: ExtractedClaim): boolean {
  return (claim.disposition ?? inferDisposition(claim.supportTags ?? [], claim.contradictionTags ?? [])) !== "support";
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function dedupeCitationSpans(items: CitationSpan[]): CitationSpan[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.text}:${item.start}:${item.end}:${item.locator ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeSourceAttributions(items: SourceAttribution[]): SourceAttribution[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.sourceId}:${item.title}:${item.url ?? ""}:${item.locator ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}...`;
}
