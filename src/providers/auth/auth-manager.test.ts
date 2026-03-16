import test from "node:test";
import assert from "node:assert/strict";
import { AuthManager } from "./auth-manager.js";

/**
 * Create an AuthManager safe for testing — file persistence is
 * disabled so the real ~/.athena/auth/auth.json is never touched.
 */
function createTestManager(): AuthManager {
  const manager = new AuthManager();
  const tokenStore = manager.tokenStore as unknown as { save: () => void; data: Record<string, unknown> };
  tokenStore.data = {};
  tokenStore.save = () => {};
  return manager;
}

// isAuthenticated

test("isAuthenticated returns false when no credentials are stored", () => {
  const manager = createTestManager();
  assert.equal(manager.isAuthenticated("openai"), false);
  assert.equal(manager.isAuthenticated("claude"), false);
});

test("isAuthenticated returns true after setting an API key", async () => {
  const manager = createTestManager();
  await manager.setApiKey("openai", "sk-test-key-123");
  assert.equal(manager.isAuthenticated("openai"), true);
  assert.equal(manager.isAuthenticated("claude"), false);
});

test("isAuthenticated returns true for OAuth with access or refresh token", async () => {
  const manager = createTestManager();
  await manager.setOAuthTokens("claude", "access-abc", "refresh-xyz", Date.now() + 3600_000);
  assert.equal(manager.isAuthenticated("claude"), true);
});

test("isAuthenticated returns true for OAuth with only refresh token", () => {
  const manager = createTestManager();
  const tokenStore = manager.tokenStore as unknown as {
    data: {
      openai?: {
        method: "oauth";
        provider: "openai";
        refreshToken: string;
      };
    };
  };
  tokenStore.data.openai = {
    method: "oauth",
    provider: "openai",
    refreshToken: "refresh-only",
  };
  assert.equal(manager.isAuthenticated("openai"), true);
});

// getCredentials

test("getCredentials returns null for unconfigured provider", async () => {
  const manager = createTestManager();
  const creds = await manager.getCredentials("openai");
  assert.equal(creds, null);
});

test("getCredentials returns stored API key credentials", async () => {
  const manager = createTestManager();
  await manager.setApiKey("openai", "sk-test-key");
  const creds = await manager.getCredentials("openai");
  assert.equal(creds?.method, "api_key");
  assert.equal(creds?.apiKey, "sk-test-key");
  assert.equal(creds?.provider, "openai");
});

test("getCredentials returns OAuth tokens when not expired", async () => {
  const manager = createTestManager();
  const futureExpiry = Date.now() + 3600_000;
  await manager.setOAuthTokens("claude", "access-abc", "refresh-xyz", futureExpiry);
  const creds = await manager.getCredentials("claude");
  assert.equal(creds?.method, "oauth");
  assert.equal(creds?.accessToken, "access-abc");
  assert.equal(creds?.refreshToken, "refresh-xyz");
});

test("getCredentials triggers refresh for expired OAuth tokens", async () => {
  const manager = createTestManager();
  let refreshCalled = false;

  manager.registerRefreshHandler("claude", async (refreshToken) => {
    refreshCalled = true;
    assert.equal(refreshToken, "refresh-old");
    return {
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAt: Date.now() + 7200_000,
    };
  });

  await manager.setOAuthTokens("claude", "access-old", "refresh-old", Date.now() - 60_000);
  const creds = await manager.getCredentials("claude");
  assert.ok(refreshCalled, "refresh handler should be invoked");
  assert.equal(creds?.accessToken, "access-new");
  assert.equal(creds?.refreshToken, "refresh-new");
});

test("getCredentials returns stale credentials when refresh handler throws", async () => {
  const manager = createTestManager();

  manager.registerRefreshHandler("openai", async () => {
    throw new Error("network error");
  });

  await manager.setOAuthTokens("openai", "access-stale", "refresh-stale", Date.now() - 60_000);
  const creds = await manager.getCredentials("openai");
  assert.equal(creds?.accessToken, "access-stale");
});

test("getCredentials returns stale credentials when no refresh handler registered", async () => {
  const manager = createTestManager();
  await manager.setOAuthTokens("openai", "access-stale", "refresh-stale", Date.now() - 60_000);
  const creds = await manager.getCredentials("openai");
  assert.equal(creds?.accessToken, "access-stale");
});

// TokenStore helpers

test("tokenStore.needsRefresh returns false for API key auth", async () => {
  const manager = createTestManager();
  await manager.setApiKey("openai", "sk-test");
  assert.equal(manager.tokenStore.needsRefresh("openai"), false);
});

test("tokenStore.needsRefresh returns true within 5-minute expiry window", async () => {
  const manager = createTestManager();
  // Expires in 2 min — inside the 5-min refresh window
  await manager.setOAuthTokens("claude", "a", "r", Date.now() + 2 * 60_000);
  assert.equal(manager.tokenStore.needsRefresh("claude"), true);
});

test("tokenStore.needsRefresh returns false when well before expiry", async () => {
  const manager = createTestManager();
  await manager.setOAuthTokens("claude", "a", "r", Date.now() + 30 * 60_000);
  assert.equal(manager.tokenStore.needsRefresh("claude"), false);
});

test("tokenStore.isExpired returns true when past expiry", async () => {
  const manager = createTestManager();
  await manager.setOAuthTokens("claude", "a", "r", Date.now() - 1000);
  assert.equal(manager.tokenStore.isExpired("claude"), true);
});

test("tokenStore.isExpired returns false before expiry", async () => {
  const manager = createTestManager();
  await manager.setOAuthTokens("claude", "a", "r", Date.now() + 3600_000);
  assert.equal(manager.tokenStore.isExpired("claude"), false);
});

test("tokenStore.clear removes provider credentials", async () => {
  const manager = createTestManager();
  await manager.setApiKey("openai", "sk-test");
  assert.equal(manager.isAuthenticated("openai"), true);

  manager.tokenStore.clear("openai");
  assert.equal(manager.isAuthenticated("openai"), false);
  assert.equal(await manager.getCredentials("openai"), null);
});
