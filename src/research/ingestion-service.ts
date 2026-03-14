import type { TeamOrchestrator } from "./team-orchestrator.js";
import type { TeamStore } from "./team-store.js";
import type { EvidenceHealthSummary, ExtractedClaim, IngestionSourceRecord, ResearchCandidatePack, TeamRunRecord } from "./contracts.js";
import { buildCanonicalClaims, createCandidatePackFromSource, createIngestionSource, updateIngestionSourceContent } from "./ingestion.js";
import type { SecurityManager } from "../security/policy.js";
import { resolveDocumentInput } from "./source-adapters/document-adapter.js";
import { resolveRepoSnapshotInput } from "./source-adapters/repo-snapshot-adapter.js";
import { resolveTextInput } from "./source-adapters/text-adapter.js";
import { resolveUrlInput } from "./source-adapters/url-adapter.js";

export interface IngestionRequest {
  inputType: "url" | "document" | "text" | "repo";
  value: string;
  sessionId: string;
  problemArea: string;
  runId?: string;
  title?: string;
  sourceType?: IngestionSourceRecord["sourceType"];
}

export interface IngestionResult {
  run: TeamRunRecord;
  source: IngestionSourceRecord;
  pack: ResearchCandidatePack;
  rawText: string;
}

export class IngestionService {
  constructor(
    private teamStore: TeamStore,
    private teamOrchestrator: TeamOrchestrator,
    private securityManager?: SecurityManager,
  ) {}

  async ingest(request: IngestionRequest): Promise<IngestionResult> {
    const resolved = await resolveInput(request, this.securityManager);
    const draftedSource = updateIngestionSourceContent(createIngestionSource({
      sourceType: request.sourceType ?? inferSourceType(request.inputType),
      title: resolved.title,
      url: resolved.url,
      notes: resolved.notes,
    }), resolved.text);
    const existing = this.findExistingSource(request.sessionId, draftedSource);
    const source = existing
      ? {
          ...existing,
          sourceType: draftedSource.sourceType,
          title: draftedSource.title,
          url: draftedSource.url,
          notes: draftedSource.notes,
          sourceDigest: draftedSource.sourceDigest,
          sourceExcerpt: draftedSource.sourceExcerpt,
          updatedAt: draftedSource.updatedAt,
        }
      : draftedSource;

    this.teamStore.saveIngestionSource(request.sessionId, source);

    const claims = extractClaimsFromText(resolved.text, source, request.problemArea);
    const pack = createCandidatePackFromSource({
      source,
      problemArea: request.problemArea,
      claims,
      methods: inferMethods(resolved.text),
      counterEvidence: claims.filter((claim) => claim.disposition !== "support").map((claim) => claim.statement),
      openQuestions: inferOpenQuestions(resolved.text),
    });
    const mergedExtractedClaims = mergeExtractedClaims(existing?.extractedClaims ?? [], pack.claims);
    const mergedCanonicalClaims = buildCanonicalClaims([
      ...(existing?.extractedClaims ?? []),
      ...mergedExtractedClaims,
    ]);
    const evidenceHealth = buildEvidenceHealthFromClaims(mergedExtractedClaims, mergedCanonicalClaims);
    const persistedSource: IngestionSourceRecord = {
      ...source,
      status: "ingested",
      claimCount: mergedExtractedClaims.length,
      freshnessScore: evidenceHealth.freshnessScore,
      evidenceConfidence: evidenceHealth.evidenceStrength,
      extractedClaims: mergedExtractedClaims,
      canonicalClaims: mergedCanonicalClaims,
      evidenceHealth,
      updatedAt: Date.now(),
    };

    const run = this.ensureRun(request.sessionId, request.runId, source.title, request.problemArea);
    const updatedRun = this.teamOrchestrator.recordCollectionPack(run.id, pack) ?? run;
    this.teamStore.saveIngestionSource(request.sessionId, persistedSource);
    const refreshedSource = this.teamStore.listIngestionSources(request.sessionId).find((item) => item.sourceId === source.sourceId) ?? persistedSource;

    return {
      run: updatedRun,
      source: refreshedSource,
      pack,
      rawText: resolved.text,
    };
  }

  private ensureRun(sessionId: string, runId: string | undefined, title: string, problemArea: string): TeamRunRecord {
    if (runId) {
      const existing = this.teamStore.getTeamRunForSession(sessionId, runId);
      if (existing) return existing;
    }

    const active = this.teamStore.listRecentTeamRuns(sessionId, 20).find((run) => run.status === "active");
    if (active) return active;

    return this.teamOrchestrator.startRunForSession(sessionId, `Ingest ${title} for ${problemArea}`);
  }

  private findExistingSource(sessionId: string, source: IngestionSourceRecord): IngestionSourceRecord | undefined {
    return this.teamStore.listIngestionSources(sessionId).find((candidate) =>
      (source.sourceDigest && candidate.sourceDigest === source.sourceDigest)
      || (source.url && candidate.url === source.url)
    );
  }
}

async function resolveInput(
  request: IngestionRequest,
  securityManager?: SecurityManager,
): Promise<{ title: string; url?: string; text: string; notes?: string }> {
  const context = {
    actorRole: "operator" as const,
    sessionId: request.sessionId,
    runId: request.runId,
    machineId: "local",
    toolName: "ingestion_extract_source",
    toolFamily: "research-orchestration" as const,
  };

  if (request.inputType === "text") {
    return resolveTextInput(request.value, request.title);
  }

  if (request.inputType === "url") {
    securityManager?.assertCommandAllowed(`fetch ${request.value}`, {
      ...context,
      networkAccess: true,
    });
    return resolveUrlInput(request.value, request.title);
  }

  securityManager?.assertPathAllowed(request.value, "read", context);
  if (request.inputType === "repo") {
    return resolveRepoSnapshotInput(request.value, request.title, {
      assertReadablePath: (path) => securityManager?.assertPathAllowed(path, "read", context),
    });
  }

  return resolveDocumentInput(request.value, request.title, {
    assertReadablePath: (path) => securityManager?.assertPathAllowed(path, "read", context),
  });
}

function extractClaimsFromText(
  text: string,
  source: IngestionSourceRecord,
  problemArea: string,
): ExtractedClaim[] {
  const sentences = splitSentenceRecords(text)
    .filter((record) => isClaimCandidate(record.text));

  const picked = sentences
    .map((record) => ({ ...record, score: scoreSentence(record.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index);

  const selected = picked.length > 0
    ? picked
    : splitParagraphRecords(text)
        .slice(0, 3)
        .map((record) => ({
          ...record,
          score: 1,
        }));

  return selected.map((record, index) => {
    const supportTags = inferSupportTagsFromSentence(record.text, problemArea);
    const contradictionTags = inferContradictionTagsFromSentence(record.text, problemArea);
    const disposition = contradictionTags.length > 0 && supportTags.length === 0
      ? "contradiction"
      : contradictionTags.length > 0
        ? "mixed"
        : "support";
    const locator = `sentence:${record.index + 1}`;
    return {
      claimId: `${source.sourceId}-claim-${index + 1}`,
      statement: record.text,
      source: source.title,
      sourceId: source.sourceId,
      confidence: scoreConfidence(record.text),
      freshnessScore: scoreFreshness(record.text, source.createdAt),
      supportTags,
      contradictionTags,
      rationaleSpans: [record.text],
      citationSpans: [{ text: record.text, start: record.start, end: record.end, locator }],
      sourceAttributions: [{ sourceId: source.sourceId, title: source.title, url: source.url, locator }],
      evidenceIds: [`${source.sourceId}-evidence-${index + 1}`],
      disposition,
    };
  });
}

interface TextSegmentRecord {
  text: string;
  index: number;
  start: number;
  end: number;
}

function splitParagraphRecords(text: string): TextSegmentRecord[] {
  return findSegmentRecords(
    text,
    text
      .replace(/\r/g, "\n")
      .split(/\n{2,}/)
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => value.length >= 35 && value.length <= 320),
  );
}

function splitSentenceRecords(text: string): TextSegmentRecord[] {
  const records: TextSegmentRecord[] = [];
  const matcher = /[^.!?\n]+(?:[.!?]+|$)/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = matcher.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (trimmed.length < 35 || trimmed.length > 320) continue;
    const leading = raw.search(/\S/);
    const trimmedEnd = raw.trimEnd();
    const trailingOffset = raw.lastIndexOf(trimmedEnd) + trimmedEnd.length;
    const start = match.index + Math.max(0, leading);
    const end = match.index + trailingOffset;
    records.push({ text: trimmed, index, start, end });
    index += 1;
  }
  return records;
}

function findSegmentRecords(text: string, segments: string[]): TextSegmentRecord[] {
  const records: TextSegmentRecord[] = [];
  let cursor = 0;
  for (const [index, segment] of segments.entries()) {
    const start = text.indexOf(segment, cursor);
    if (start < 0) continue;
    const end = start + segment.length;
    records.push({ text: segment, index, start, end });
    cursor = end;
  }
  return records;
}

function isClaimCandidate(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  if (lower.length < 35) return false;
  if (!/[a-z]/i.test(lower)) return false;
  return /(improves?|reduces?|increases?|decreases?|causes?|leads to|results in|shows?|measured|benchmark|faster|slower|stable|unstable|regress|memory|latency|throughput|accuracy|loss|evidence|reproduc)/.test(lower)
    || /\d+(\.\d+)?%/.test(lower)
    || /\d+(\.\d+)?x/.test(lower);
}

function scoreSentence(sentence: string): number {
  const lower = sentence.toLowerCase();
  let score = 0;
  if (/(measured|benchmark|experiment|validated|observed)/.test(lower)) score += 3;
  if (/(improves?|reduces?|increases?|decreases?|faster|slower|regress|stable|unstable)/.test(lower)) score += 2;
  if (/\d/.test(lower)) score += 1;
  if (/(memory|latency|throughput|accuracy|loss|cost|rollback|telemetry|monitor)/.test(lower)) score += 2;
  if (/(however|but|despite|did not|not reproducible|unable to reproduce|worse)/.test(lower)) score += 2;
  return score;
}

function scoreConfidence(sentence: string): number {
  const lower = sentence.toLowerCase();
  let confidence = 0.45;
  if (/\d/.test(lower)) confidence += 0.15;
  if (/(measured|benchmark|experiment|validated|observed|repeated)/.test(lower)) confidence += 0.2;
  if (/(however|but|despite|did not|not reproducible|unable to reproduce)/.test(lower)) confidence += 0.05;
  return Math.min(0.95, Number(confidence.toFixed(2)));
}

function scoreFreshness(sentence: string, createdAt: number): number {
  const yearMatch = sentence.match(/20(1\d|2\d|3\d|4\d|5\d)/g);
  if (yearMatch && yearMatch.length > 0) {
    const newestYear = Math.max(...yearMatch.map((value) => Number(value)));
    const delta = Math.max(0, new Date().getFullYear() - newestYear);
    return Math.max(0.2, Number((1 - Math.min(delta, 6) / 8).toFixed(2)));
  }
  const ageDays = Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60 * 24));
  return Math.max(0.45, Number((1 - Math.min(ageDays, 365) / 730).toFixed(2)));
}

function inferSupportTagsFromSentence(sentence: string, problemArea: string): string[] {
  const lower = `${sentence} ${problemArea}`.toLowerCase();
  const tags = new Set<string>();
  if (/(memory|oom|ram|vram|activation)/.test(lower)) tags.add("memory");
  if (/(latency|throughput|runtime|wall clock|speed|faster|slower)/.test(lower)) tags.add("latency");
  if (/(rollback|revert|safe|safer|recovery)/.test(lower)) tags.add("rollback");
  if (/(observe|monitor|telemetry|metric|trace|logging)/.test(lower)) tags.add("observability");
  if (/(benchmark|measured|experiment|validated|repeated|evidence)/.test(lower)) tags.add("evidence");
  return [...tags];
}

function inferContradictionTagsFromSentence(sentence: string, problemArea: string): string[] {
  const lower = `${sentence} ${problemArea}`.toLowerCase();
  const tags = new Set<string>();
  if (/(however|but|despite|although)/.test(lower)) tags.add("counter_evidence");
  if (/(did not|does not|not reproducible|unable to reproduce|worse|slower|regress|unstable|fails|failure|crash)/.test(lower)) tags.add("counter_evidence");
  return [...tags];
}

function inferMethods(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) ?? [];
  return [...new Set(matches.filter((item) => item.length >= 6))].slice(0, 6);
}

function inferOpenQuestions(text: string): string[] {
  const sentences = splitSentenceRecords(text).map((record) => record.text);
  return sentences.filter((sentence) => /\?$|open question|unknown|unclear|future work/i.test(sentence)).slice(0, 5);
}

function inferSourceType(inputType: IngestionRequest["inputType"]): IngestionSourceRecord["sourceType"] {
  if (inputType === "url") return "docs";
  if (inputType === "repo") return "repo";
  if (inputType === "document") return "paper";
  return "manual";
}

function mergeExtractedClaims(
  existing: ExtractedClaim[],
  incoming: ExtractedClaim[],
): ExtractedClaim[] {
  const merged = new Map<string, ExtractedClaim>();
  for (const claim of [...existing, ...incoming]) {
    const key = `${claim.normalizedStatement ?? claim.statement.toLowerCase()}:${claim.sourceId ?? ""}:${claim.citationSpans?.[0]?.locator ?? ""}`;
    merged.set(key, claim);
  }
  return [...merged.values()];
}

function buildEvidenceHealthFromClaims(
  claims: ExtractedClaim[],
  canonicalClaims: ResearchCandidatePack["canonicalClaims"] = [],
): EvidenceHealthSummary {
  const contradictionCount = claims.filter((claim) => claim.disposition !== "support").length;
  const evidenceStrength = average(claims.map((claim) => claim.confidence));
  const freshnessScore = average(claims.map((claim) => claim.freshnessScore));
  const modelConfidence = average(canonicalClaims?.map((claim) => claim.confidence) ?? []);
  const coverageGaps = [
    ...(claims.some((claim) => (claim.citationSpans?.length ?? 0) === 0) ? ["missing_citations"] : []),
    ...(claims.some((claim) => (claim.sourceAttributions?.length ?? 0) === 0) ? ["missing_source_attribution"] : []),
    ...(contradictionCount > 0 ? ["contradiction_present"] : []),
  ];

  return {
    sourceCount: new Set(claims.map((claim) => claim.sourceId).filter(Boolean)).size,
    claimCount: claims.length,
    canonicalClaimCount: canonicalClaims?.length ?? 0,
    contradictionCount,
    uncoveredClaimCount: claims.filter((claim) => !claim.sourceId).length,
    freshnessScore,
    evidenceStrength,
    modelConfidence,
    confidenceSeparation: Number(Math.abs(modelConfidence - evidenceStrength).toFixed(2)),
    coverageGaps,
  };
}

function average(values: Array<number | undefined>): number {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (valid.length === 0) return 0;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2));
}
