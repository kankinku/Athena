import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

const ANSI_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are intentional here.
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const ASCII_RULE = "-".repeat(40);

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

function buildTerminalOptions(width: number): Record<string, unknown> {
  return {
    firstHeading: (text: string) => text,
    heading: (text: string) => text,
    strong: (text: string) => text,
    em: (text: string) => text,
    codespan: (code: string) => `\`${code}\``,
    code: (code: string) => `${ASCII_RULE}\n${code}\n${ASCII_RULE}`,
    listitem: (text: string) => `- ${text}`,
    hr: () => ASCII_RULE,
    link: (href: string, _title: string, text: string) =>
      text && text !== href ? `${text} (${href})` : href,
    blockquote: (text: string) => `> ${text}`,
    width,
    tableOptions: {
      chars: {
        top: "-",
        "top-mid": "+",
        "top-left": "+",
        "top-right": "+",
        bottom: "-",
        "bottom-mid": "+",
        "bottom-left": "+",
        "bottom-right": "+",
        left: "|",
        "left-mid": "+",
        mid: "-",
        "mid-mid": "+",
        right: "|",
        "right-mid": "+",
        middle: "|",
      },
      wordWrap: true,
      wrapOnWordBoundary: true,
    },
    reflowText: true,
    showSectionPrefix: false,
    tab: 2,
  };
}

let cachedWidth = 0;
let cachedMarked: Marked | null = null;

function getMarked(width: number): Marked {
  if (cachedMarked && cachedWidth === width) {
    return cachedMarked;
  }

  cachedWidth = width;
  cachedMarked = new Marked();
  cachedMarked.use(markedTerminal(buildTerminalOptions(width)) as Parameters<Marked["use"]>[0]);
  return cachedMarked;
}

export function renderMarkdown(input: string, width?: number): string {
  if (!input) {
    return "";
  }

  const targetWidth = width ?? process.stdout.columns ?? 80;
  const marked = getMarked(targetWidth);
  const rendered = marked.parse(input) as string;
  return stripAnsi(rendered).replace(/\n+$/, "");
}
