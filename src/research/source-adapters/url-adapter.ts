import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export async function resolveUrlInput(
  value: string,
  explicitTitle?: string,
): Promise<{ title: string; url?: string; text: string; notes?: string }> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported ingestion URL scheme: ${url.protocol}`);
  }
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
