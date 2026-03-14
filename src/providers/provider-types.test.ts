import test from "node:test";
import assert from "node:assert/strict";
import { ToolParameterSchema } from "./types.js";
import { TransientError, isTransient, sleep } from "./retry.js";
import { parseSSELines } from "./sse.js";
import { AuthManager } from "./auth/auth-manager.js";
import { ClaudeProvider } from "./claude/provider.js";
import { OpenAIProvider } from "./openai/provider.js";
import { SessionStore } from "../store/session-store.js";

// ToolParameterSchema

test("ToolParameterSchema validates a correct tool parameter shape", () => {
  const result = ToolParameterSchema.safeParse({
    type: "object",
    properties: {
      name: { type: "string", description: "The name" },
      count: { type: "number" },
    },
    required: ["name"],
  });
  assert.ok(result.success, "valid schema should parse successfully");
});

test("ToolParameterSchema accepts empty properties and no required", () => {
  const result = ToolParameterSchema.safeParse({
    type: "object",
    properties: {},
  });
  assert.ok(result.success);
});

test("ToolParameterSchema rejects when type is not object", () => {
  const result = ToolParameterSchema.safeParse({
    type: "array",
    properties: {},
  });
  assert.ok(!result.success, "type: 'array' should be rejected");
});

// TransientError / isTransient

test("TransientError is identified by isTransient", () => {
  const err = new TransientError("timeout");
  assert.ok(isTransient(err));
  assert.equal(err.name, "TransientError");
  assert.equal(err.message, "timeout");
});

test("TransientError is an instance of Error", () => {
  const err = new TransientError("test");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof TransientError);
});

test("isTransient returns false for non-TransientError values", () => {
  assert.equal(isTransient(new Error("generic")), false);
  assert.equal(isTransient(new TypeError("type")), false);
  assert.equal(isTransient("string error"), false);
  assert.equal(isTransient(null), false);
  assert.equal(isTransient(undefined), false);
  assert.equal(isTransient(42), false);
});

// sleep

test("sleep resolves after the specified delay", async () => {
  const start = Date.now();
  await sleep(50);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 40, `Expected at least 40ms, got ${elapsed}ms`);
});

// parseSSELines

function createMockResponse(body: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream);
}

test("parseSSELines yields parsed JSON objects from SSE data lines", async () => {
  const body = [
    'data: {"type":"text","text":"hello"}',
    'data: {"type":"done"}',
    "",
  ].join("\n");

  const events: unknown[] = [];
  for await (const event of parseSSELines(createMockResponse(body))) {
    events.push(event);
  }

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { type: "text", text: "hello" });
  assert.deepEqual(events[1], { type: "done" });
});

test("parseSSELines skips [DONE] sentinel", async () => {
  const body = [
    'data: {"type":"text","text":"hi"}',
    "data: [DONE]",
    "",
  ].join("\n");

  const events: unknown[] = [];
  for await (const event of parseSSELines(createMockResponse(body))) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: "text", text: "hi" });
});

test("parseSSELines ignores comment lines, event lines, and malformed JSON", async () => {
  const body = [
    ": comment line",
    "event: ping",
    "data: {invalid json",
    'data: {"valid":true}',
    "",
  ].join("\n");

  const events: unknown[] = [];
  for await (const event of parseSSELines(createMockResponse(body))) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { valid: true });
});

test("parseSSELines handles empty data field", async () => {
  const body = ["data: ", 'data: {"ok":1}', ""].join("\n");

  const events: unknown[] = [];
  for await (const event of parseSSELines(createMockResponse(body))) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { ok: 1 });
});

test("parseSSELines throws on missing body", async () => {
  const noBodyResp = { body: null } as unknown as Response;
  await assert.rejects(async () => {
    for await (const _ of parseSSELines(noBodyResp)) {
      /* should throw before yielding */
    }
  }, /No response body/);
});

function createTestManager(): AuthManager {
  const manager = new AuthManager();
  const tokenStore = manager.tokenStore as unknown as { save: () => void };
  tokenStore.save = () => {};
  return manager;
}

test("providers expose explicit capability metadata", () => {
  const authManager = createTestManager();
  const sessionStore = new SessionStore("capability-tests");
  const claude = new ClaudeProvider(authManager, "cli", sessionStore);
  const openai = new OpenAIProvider(authManager, sessionStore);

  assert.deepEqual(claude.capabilities.authModes, ["cli", "api_key"]);
  assert.equal(claude.capabilities.attachmentSupport, "auth-mode-dependent");
  assert.equal(claude.capabilities.builtinWebSearch, true);
  assert.equal(claude.capabilities.sessionPersistence, "hybrid");

  assert.deepEqual(openai.capabilities.authModes, ["oauth"]);
  assert.equal(openai.capabilities.attachmentSupport, "full");
  assert.equal(openai.capabilities.builtinWebSearch, true);
  assert.equal(openai.capabilities.sessionPersistence, "local");
});

test("provider capability notes document attachment behavior differences", () => {
  const authManager = createTestManager();
  const sessionStore = new SessionStore("capability-notes");
  const claude = new ClaudeProvider(authManager, "cli", sessionStore);
  const openai = new OpenAIProvider(authManager, sessionStore);

  assert.ok(claude.capabilities.notes?.some((note) => note.includes("does not accept file attachments")));
  assert.ok(openai.capabilities.notes?.some((note) => note.includes("local history")));
});
