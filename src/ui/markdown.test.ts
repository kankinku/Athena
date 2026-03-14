import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./markdown.js";

test("renderMarkdown returns copy-friendly ASCII output without ANSI escapes", () => {
  const rendered = renderMarkdown("# Title\n\n- one\n- two\n\n`code`", 80);

  assert.match(rendered, /Title/);
  assert.match(rendered, /- one/);
  assert.match(rendered, /- two/);
  assert.match(rendered, /`code`/);
  assert.doesNotMatch(rendered, /\x1b\[/);
});

test("renderMarkdown renders blockquotes and links as plain text", () => {
  const rendered = renderMarkdown("> quote\n\n[OpenAI](https://openai.com)", 80);

  assert.match(rendered, />\s+quote/);
  assert.match(rendered, /OpenAI \(https:\/\/openai\.com\)/);
});
