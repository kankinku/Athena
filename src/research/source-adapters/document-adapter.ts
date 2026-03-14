import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { extractText, getDocumentProxy, getMeta } from "unpdf";

interface DocumentAdapterOptions {
  assertReadablePath?: (path: string) => void;
}

export async function resolveDocumentInput(
  value: string,
  explicitTitle?: string,
  options: DocumentAdapterOptions = {},
): Promise<{ title: string; text: string; notes?: string }> {
  options.assertReadablePath?.(value);
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
      text: html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
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
