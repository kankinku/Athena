import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIOAuth } from "./oauth.js";

type MockFetch = typeof fetch;

function createJsonResponse(status: number, json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("OpenAIOAuth.refresh exchanges refresh token for new tokens", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return createJsonResponse(200, {
      access_token: "access-new",
      refresh_token: "refresh-new",
      expires_in: 3600,
    });
  }) as MockFetch;

  try {
    const oauth = new OpenAIOAuth({} as never);
    const before = Date.now();
    const result = await oauth.refresh("refresh-old");

    assert.equal(requestUrl, "https://auth.openai.com/oauth/token");
    assert.equal(requestInit?.method, "POST");
    assert.match(String(requestInit?.body), /grant_type/);
    assert.match(String(requestInit?.body), /refresh_token/);
    assert.equal(result.accessToken, "access-new");
    assert.equal(result.refreshToken, "refresh-new");
    assert.ok(result.expiresAt >= before + 3_500_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAIOAuth.refresh throws when the token endpoint returns an error", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => new Response("invalid_grant", { status: 401 })) as MockFetch;

  try {
    const oauth = new OpenAIOAuth({} as never);
    await assert.rejects(() => oauth.refresh("bad-refresh-token"), /Token refresh failed: 401 invalid_grant/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
