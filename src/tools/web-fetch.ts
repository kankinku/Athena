import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { lookup } from "node:dns/promises";
import type { ToolDefinition } from "../providers/types.js";
import type { SecurityManager } from "../security/policy.js";
import { formatError } from "../ui/format.js";

const MAX_REDIRECTS = 5;

/**
 * SSRF 방어 — 프라이빗/내부 네트워크 호스트를 차단한다.
 * localhost, 루프백, RFC1918, 링크로컬, 클라우드 메타데이터 주소를 거부.
 */
function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "[::1]") return true;

  // IPv4 직접 검사
  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, aStr, bStr] = ipv4;
    const a = Number(aStr);
    const b = Number(bStr);
    if (a === 127) return true;                         // 127.0.0.0/8  loopback
    if (a === 10) return true;                          // 10.0.0.0/8   RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12 RFC1918
    if (a === 192 && b === 168) return true;            // 192.168.0.0/16 RFC1918
    if (a === 169 && b === 254) return true;            // 169.254.0.0/16 link-local + cloud metadata
    if (a === 0) return true;                           // 0.0.0.0/8
  }

  return false;
}

function assertNotPrivate(parsed: URL): void {
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`Blocked: ${parsed.hostname} is a private/internal address (SSRF protection)`);
  }
}

async function assertNotPrivateResolved(hostname: string): Promise<void> {
  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    return;
  }

  for (const { address: addr } of resolved) {
    if (isPrivateHost(addr)) {
      throw new Error(`Blocked: ${hostname} resolves to private address ${addr} (DNS rebinding protection)`);
    }
  }
}

export function createWebFetchTool(securityManager?: SecurityManager): ToolDefinition {
  return {
    name: "web_fetch",
    description:
      "Fetch a URL and return the page content as readable text. Handles HTML (extracts article content), PDFs (extracts text), and plain text. Use this to read documentation, papers, blog posts, or any web page.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
        max_length: {
          type: "number",
          description: "Max characters to return (default: 20000)",
        },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const url = args.url as string;
      const maxLength = (args.max_length as number) ?? 20000;

      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          return JSON.stringify({
            error: `Unsupported URL protocol: ${parsedUrl.protocol}`,
          });
        }

        // SSRF 방어: 초기 URL의 호스트가 프라이빗 네트워크가 아닌지 확인
        assertNotPrivate(parsedUrl);
        await assertNotPrivateResolved(parsedUrl.hostname);

        securityManager?.assertCommandAllowed(`fetch ${parsedUrl.toString()}`, {
          actorRole: "agent",
          machineId: "local",
          toolName: "web_fetch",
          toolFamily: "research-orchestration",
          networkAccess: true,
        });

        // 리다이렉트를 수동으로 따라가며 각 hop의 호스트를 검증
        let currentUrl = url;
        let resp: Response | undefined;
        for (let i = 0; i <= MAX_REDIRECTS; i++) {
          resp = await fetch(currentUrl, {
            headers: {
              "User-Agent": "Athena-ML-Agent/1.0",
              Accept: "text/html,application/xhtml+xml,application/pdf,text/plain,application/json",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(30_000),
          });

          if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get("location");
            if (!location) break;
            const redirectTarget = new URL(location, currentUrl);
            if (redirectTarget.protocol !== "http:" && redirectTarget.protocol !== "https:") {
              return JSON.stringify({ error: `Redirect to unsupported protocol: ${redirectTarget.protocol}` });
            }
            assertNotPrivate(redirectTarget);
            await assertNotPrivateResolved(redirectTarget.hostname);
            currentUrl = redirectTarget.toString();
            if (i === MAX_REDIRECTS) {
              return JSON.stringify({ error: `Too many redirects (max ${MAX_REDIRECTS})` });
            }
            continue;
          }
          break;
        }

        if (!resp || !resp.ok) {
          const status = resp?.status ?? 0;
          const statusText = resp?.statusText ?? "No response";
          return JSON.stringify({ error: `HTTP ${status}: ${statusText}` });
        }

        const contentType = resp.headers.get("content-type") ?? "";
        let title: string | undefined;
        let text: string;

        if (contentType.includes("application/pdf") || url.endsWith(".pdf")) {
          const buffer = new Uint8Array(await resp.arrayBuffer());
          const { extractText } = await import("unpdf");
          const result = await extractText(buffer);
          text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
        } else if (contentType.includes("text/html") || contentType.includes("xhtml")) {
          const html = await resp.text();
          const parsed = extractArticle(html, url);
          title = parsed.title;
          text = parsed.text;
        } else {
          text = await resp.text();
        }

        const truncated = text.length > maxLength;
        const content = truncated ? text.slice(0, maxLength) : text;

        return JSON.stringify({
          url,
          title,
          content_type: contentType.split(";")[0],
          length: text.length,
          truncated,
          content,
        });
      } catch (err) {
        return JSON.stringify({
          error: formatError(err),
        });
      }
    },
  };
}

function extractArticle(html: string, url: string): { title?: string; text: string } {
  const { document } = parseHTML(html);
  const reader = new Readability(document as any);
  const article = reader.parse();

  if (article?.textContent) {
    // Clean up readability output — collapse excessive whitespace
    const text = article.textContent
      .split("\n")
      .map((line: string) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return { title: article.title ?? undefined, text };
  }

  // Fallback: basic tag stripping if readability can't extract
  return { text: fallbackHtmlToText(html) };
}

function fallbackHtmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<head[\s\S]*?<\/head>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
