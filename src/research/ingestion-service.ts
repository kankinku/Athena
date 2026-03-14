import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { extractText, getDocumentProxy, getMeta } from "unpdf";
import type { TeamOrchestrator } from "./team-orchestrator.js";
import type { TeamStore } from "./team-store.js";
import type { ExtractedClaim, IngestionSourceRecord, ResearchCandidatePack, TeamRunRecord } from "./contracts.js";
import { createCandidatePackFromSource, createIngestionSource, updateIngestionSourceContent } from "./ingestion.js";

export interface IngestionRequest {
  inputType: "url" | "document" | "text";
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
  ) {}

  async ingest(request: IngestionRequest): Promise<IngestionResult> {
    const resolved = await resolveInput(request.inputType, request.value, request.title);
    const source = updateIngestionSourceContent(createIngestionSource({
      sourceType: request.sourceType ?? inferSourceType(request.inputType),
      title: resolved.title,
      url: resolved.url,
      notes: resolved.notes,
    }), resolved.text);

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

    const run = this.ensureRun(request.sessionId, request.runId, source.title, request.problemArea);
    const updatedRun = this.teamOrchestrator.recordCollectionPack(run.id, pack) ?? run;
    const refreshedSource = this.teamStore.listIngestionSources(request.sessionId).find((item) => item.sourceId === source.sourceId) ?? source;

    return {
      run: updatedRun,
      source: refreshedSource,
      pack,
      rawText: resolved.text,
    };
  }

  private ensureRun(sessionId: string, runId: string | undefined, title: string, problemArea: string): TeamRunRecord {
    if (runId) {
      const existing = this.teamStore.getTeamRun(runId);
      if (existing) return existing;
    }

    const active = this.teamStore.listRecentTeamRuns(sessionId, 20).find((run) => run.status === "active");
    if (active) return active;

    return this.teamOrchestrator.startRunForSession(sessionId, `Ingest ${title} for ${problemArea}`);
  }
}

async function resolveInput(
  inputType: IngestionRequest["inputType"],
  value: string,
  explicitTitle?: string,
): Promise<{ title: string; url?: string; text: string; notes?: string }> {
  if (inputType === "text") {
    const previewTitle = truncate(singleLine(value), 80);
    const title = explicitTitle ?? (previewTitle || "Manual text input");
    return { title, text: value, notes: `manual text (${value.length} chars)` };
  }

  if (inputType === "url") {
    const response = await fetch(value);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    const parsed = extractReadableHtml(html, value);
    return {
      title: explicitTitle ?? parsed.title ?? value,
      url: value,
      text: parsed.text,
      notes: `url ingestion (${parsed.text.length} chars)`,
    };
  }

  const buffer = await readFile(value);
  const extension = extname(value).toLowerCase();
  const title = explicitTitle ?? basename(value);

  if ([".txt", ".log", ".md", ".markdown"].includes(extension)) {
    const markdown = buffer.toString("utf8");
    const plainText = extension === ".txt" || extension === ".log"
      ? markdown
      : stripMarkdown(markdown);
    return {
      title,
      text: plainText,
      notes: `document ingestion (${extension.slice(1)} text)`,
    };
  }

  if ([".html", ".htm"].includes(extension)) {
    const html = buffer.toString("utf8");
    return {
      title,
      text: extractReadableHtml(html, value).text,
      notes: `document ingestion (${extension.slice(1)} html)`,
    };
  }

  if (extension === ".pdf") {
    const pdf = new Uint8Array(buffer);
    const document = await getDocumentProxy(pdf);
    const meta = await getMeta(pdf).catch(() => undefined);
    const extracted = await extractText(document, { mergePages: true });
    const pdfText = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    return {
      title: explicitTitle ?? meta?.info?.Title ?? title,
      text: pdfText,
      notes: "document ingestion (pdf)",
    };
  }

  throw new Error(`Unsupported ingestion document type: ${extension || "unknown"}`);
}

function extractReadableHtml(html: string, url: string): { title?: string; text: string } {
  const { document } = parseHTML(html);
  const reader = new Readability(document as unknown as Document, { keepClasses: false });
  const article = reader.parse();
  const pageTitle = String(document.title ?? "");
  if (article?.textContent?.trim()) {
    return { title: article.title ?? (pageTitle || url), text: article.textContent.trim() };
  }

  const text = document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return { title: pageTitle || url, text };
}

function extractClaimsFromText(
  text: string,
  source: IngestionSourceRecord,
  problemArea: string,
): ExtractedClaim[] {
  const sentences = splitSentences(text)
    .map((sentence, index) => buildSentenceRecord(text, sentence, index))
    .filter((record) => isClaimCandidate(record.text));

  const picked = sentences
    .map((record) => ({ ...record, score: scoreSentence(record.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index);

  const selected = picked.length > 0
    ? picked
    : splitParagraphs(text)
        .slice(0, 3)
        .map((paragraph, index) => ({
          text: paragraph,
          index,
          start: Math.max(0, text.indexOf(paragraph)),
          end: Math.max(0, text.indexOf(paragraph)) + paragraph.length,
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

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n{2,}/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 35 && value.length <= 320);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 35 && value.length <= 320);
}

function buildSentenceRecord(text: string, sentence: string, index: number): { text: string; index: number; start: number; end: number } {
  const start = text.indexOf(sentence);
  return {
    text: sentence,
    index,
    start: Math.max(0, start),
    end: Math.max(0, start) + sentence.length,
  };
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
  const sentences = splitSentences(text);
  return sentences.filter((sentence) => /\?$|open question|unknown|unclear|future work/i.test(sentence)).slice(0, 5);
}

function inferSourceType(inputType: IngestionRequest["inputType"]): IngestionSourceRecord["sourceType"] {
  if (inputType === "url") return "docs";
  if (inputType === "document") return "paper";
  return "manual";
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}...`;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\r/g, "")
    .trim();
}
