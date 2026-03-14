import { spawn } from "node:child_process";
import { renderMarkdown } from "./markdown.js";
import type { Message } from "./types.js";

type ClipboardWriter = (text: string) => Promise<void>;

let overrideClipboardWriter: ClipboardWriter | null = null;

export function setClipboardWriterForTest(writer: ClipboardWriter | null): void {
  overrideClipboardWriter = writer;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (overrideClipboardWriter) {
    await overrideClipboardWriter(text);
    return;
  }

  const command =
    process.platform === "win32"
      ? "clip.exe"
      : process.platform === "darwin"
        ? "pbcopy"
        : "xclip";

  const args =
    process.platform === "linux"
      ? ["-selection", "clipboard"]
      : [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "pipe"],
      shell: false,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
    });

    child.stdin.write(text);
    child.stdin.end();
  });
}

export function buildCopyText(messages: Message[], scope: "last" | "all" = "last"): string {
  if (messages.length === 0) {
    return "";
  }

  if (scope === "all") {
    return messages
      .map((message) => formatMessageForCopy(message))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const target = latestAssistant ?? messages[messages.length - 1];
  return formatMessageForCopy(target).trim();
}

function formatMessageForCopy(message: Message): string {
  switch (message.role) {
    case "assistant":
      return renderMarkdown(message.content);
    case "user":
      return `> ${message.content}`;
    case "system":
      return `[system]\n${message.content}`;
    case "error":
      return `[error]\n${message.content}`;
    case "tool":
      return formatToolMessage(message);
    default:
      return message.content;
  }
}

function formatToolMessage(message: Message): string {
  if (!message.tool) {
    return "";
  }

  const args = Object.entries(message.tool.args)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");

  const result = message.tool.result ? `\nresult:\n${message.tool.result}` : "";
  return `[tool:${message.tool.name}]\n${args}${result}`;
}
