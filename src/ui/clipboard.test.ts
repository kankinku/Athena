import test from "node:test";
import assert from "node:assert/strict";
import { buildCopyText, copyTextToClipboard, setClipboardWriterForTest } from "./clipboard.js";
import type { Message } from "./types.js";

test("buildCopyText returns the latest assistant response as plain text by default", () => {
  const messages: Message[] = [
    { id: 1, role: "user", content: "hello" },
    { id: 2, role: "assistant", content: "# Title\n\n- one\n- two" },
  ];

  const text = buildCopyText(messages);

  assert.match(text, /Title/);
  assert.match(text, /- one/);
  assert.doesNotMatch(text, /\x1b\[/);
});

test("buildCopyText can flatten the full conversation", () => {
  const messages: Message[] = [
    { id: 1, role: "user", content: "hello" },
    { id: 2, role: "assistant", content: "answer" },
    {
      id: 3,
      role: "tool",
      content: "",
      tool: {
        callId: "tool-1",
        name: "read_file",
        args: { path: "README.md" },
        result: "ok",
      },
    },
  ];

  const text = buildCopyText(messages, "all");

  assert.match(text, /> hello/);
  assert.match(text, /answer/);
  assert.match(text, /\[tool:read_file\]/);
});

test("copyTextToClipboard delegates to the injected clipboard writer in tests", async () => {
  let copied = "";
  setClipboardWriterForTest(async (text) => {
    copied = text;
  });

  await copyTextToClipboard("copied text");

  assert.equal(copied, "copied text");
  setClipboardWriterForTest(null);
});
