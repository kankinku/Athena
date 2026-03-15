import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

/** Maximum HTML payload size to prevent memory exhaustion (5 MB) */
const MAX_HTML_BYTES = 5 * 1024 * 1024;
/** Minimum extracted text length to consider a page useful */
const MIN_TEXT_LENGTH = 50;
/** Request timeout in milliseconds */
const FETCH_TIMEOUT_MS = 30_000;

export interface UrlIngestionDiagnostics {
  fetchedBytes: number;
  extractedChars: number;
  readabilityUsed: boolean;
  contentType: string;
  warnings: string[];
}

export async function resolveUrlInput(
  value: string,
  explicitTitle?: string,
): Promise<{ title: string; url?: string; text: string; notes?: string; diagnostics?: UrlIngestionDiagnostics }> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported ingestion URL scheme: ${url.protocol}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(value, {
      signal: controller.signal,
      headers: { "Accept": "text/html, application/xhtml+xml, text/plain" },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "unknown";
  if (!isTextualContentType(contentType)) {
    throw new Error(`Unsupported content type for claim extraction: ${contentType}`);
  }

  const rawBytes = await readResponseWithLimit(response, MAX_HTML_BYTES);
  const html = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);

  const warnings: string[] = [];
  if (rawBytes.byteLength >= MAX_HTML_BYTES) {
    warnings.push(`response truncated at ${MAX_HTML_BYTES} bytes`);
  }

  const parsed = extractReadableHtml(html, value);

  if (parsed.text.length < MIN_TEXT_LENGTH) {
    warnings.push(`extracted text very short (${parsed.text.length} chars)`);
  }

  const diagnostics: UrlIngestionDiagnostics = {
    fetchedBytes: rawBytes.byteLength,
    extractedChars: parsed.text.length,
    readabilityUsed: parsed.readabilityUsed,
    contentType,
    warnings,
  };

  const notesParts = [
    `url ingestion (${parsed.text.length} chars)`,
    ...(warnings.length > 0 ? [`warnings: ${warnings.join("; ")}`] : []),
  ];

  return {
    title: explicitTitle ?? parsed.title ?? value,
    url: value,
    text: parsed.text,
    notes: notesParts.join(" | "),
    diagnostics,
  };
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  while (totalSize < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalSize += value.byteLength;
  }
  reader.cancel().catch(() => { /* best effort */ });
  const result = new Uint8Array(Math.min(totalSize, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const copyLen = Math.min(chunk.byteLength, maxBytes - offset);
    result.set(chunk.subarray(0, copyLen), offset);
    offset += copyLen;
    if (offset >= maxBytes) break;
  }
  return result;
}

function isTextualContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  return /text\/|html|xml|json/.test(lower);
}

function extractReadableHtml(html: string, url: string): { title?: string; text: string; readabilityUsed: boolean } {
  const { document } = parseHTML(html);
  const reader = new Readability(document as unknown as Document, { keepClasses: false });
  const article = reader.parse();
  const pageTitle = String(document.title ?? "");
  if (article?.textContent?.trim()) {
    return { title: article.title ?? (pageTitle || url), text: article.textContent.trim(), readabilityUsed: true };
  }

  const text = document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return { title: pageTitle || url, text, readabilityUsed: false };
}
