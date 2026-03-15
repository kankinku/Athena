import test from "node:test";
import assert from "node:assert/strict";
import { ToolApprovalGate } from "./tool-approval.js";
import type { ToolApprovalRequest } from "./tool-approval.js";

function makeRequest(overrides: Partial<ToolApprovalRequest> = {}): ToolApprovalRequest {
  return {
    toolName: "read_file",
    toolFamily: "filesystem",
    actorRole: "agent",
    actorId: "store-agent",
    ...overrides,
  };
}

test("ToolApprovalGate classifies read_file as safe", () => {
  const gate = new ToolApprovalGate();
  const result = gate.evaluate(makeRequest({ toolName: "read_file" }));
  assert.equal(result.approved, true);
  assert.equal(result.riskLevel, "safe");
});

test("ToolApprovalGate classifies write_file as reviewable", () => {
  const gate = new ToolApprovalGate();
  assert.equal(gate.classifyRisk(makeRequest({ toolName: "write_file" })), "reviewable");
});

test("ToolApprovalGate auto-approves safe tools for agents", () => {
  const gate = new ToolApprovalGate();
  const result = gate.evaluate(makeRequest({ toolName: "memory_read" }));
  assert.equal(result.approved, true);
  assert.equal(result.requiresOperatorApproval, false);
});

test("ToolApprovalGate requires approval for reviewable tools with agent_worker tier", () => {
  const gate = new ToolApprovalGate();
  const result = gate.evaluate(makeRequest({
    toolName: "write_file",
    actorTier: "agent_worker",
  }));
  assert.equal(result.approved, false);
  assert.equal(result.requiresOperatorApproval, true);
});

test("ToolApprovalGate allows operator to use any tool", () => {
  const gate = new ToolApprovalGate();
  const result = gate.evaluate(makeRequest({
    toolName: "remote_exec",
    actorRole: "operator",
  }));
  assert.equal(result.approved, true);
  assert.equal(result.requiresOperatorApproval, false);
});

test("ToolApprovalGate blocks network access when policy disallows", () => {
  const gate = new ToolApprovalGate({ allowNetworkAccess: false });
  const result = gate.evaluate(makeRequest({
    toolName: "remote_exec",
    networkAccess: true,
  }));
  assert.equal(result.approved, false);
  assert.ok(result.reason.includes("Network access"));
});

test("ToolApprovalGate blocks destructive actions when policy disallows", () => {
  const gate = new ToolApprovalGate({ allowDestructiveActions: false });
  // remote_exec(reviewable) + destructive → forbidden, so blocked before capability check
  const result = gate.evaluate(makeRequest({
    toolName: "remote_exec",
    destructive: true,
  }));
  assert.equal(result.approved, false);
  // May be "forbidden" (risk escalation) or "Destructive" (capability check)
  assert.ok(result.reason.includes("forbidden") || result.reason.includes("Destructive"));
});

test("ToolApprovalGate blocks tool families not in allowed list", () => {
  const gate = new ToolApprovalGate({ allowedToolCategories: ["research-orchestration"] });
  const result = gate.evaluate(makeRequest({
    toolName: "remote_exec",
    toolFamily: "shell",
  }));
  assert.equal(result.approved, false);
  assert.ok(result.reason.includes("shell"));
});

test("ToolApprovalGate blocks write paths outside allowed roots", () => {
  const gate = new ToolApprovalGate({
    allowedWritePathRoots: ["^src/research/"],
  });
  const result = gate.evaluate(makeRequest({
    toolName: "write_file",
    targetPaths: ["src/store/migrations.ts"],
  }));
  assert.equal(result.approved, false);
  assert.ok(result.reason.includes("out of allowed write scope"));
});

test("ToolApprovalGate allows write within scope", () => {
  const gate = new ToolApprovalGate({
    allowedWritePathRoots: ["^src/research/"],
  });
  const result = gate.evaluate(makeRequest({
    toolName: "write_file",
    targetPaths: ["src/research/meeting-store.ts"],
  }));
  // No actorTier=agent_worker, so auto-approved within capability
  assert.equal(result.approved, true);
});

test("ToolApprovalGate escalates destructive safe to reviewable", () => {
  const gate = new ToolApprovalGate();
  const risk = gate.classifyRisk(makeRequest({
    toolName: "read_file",
    destructive: true,
  }));
  assert.equal(risk, "reviewable");
});

test("ToolApprovalGate system role can use safe tools only", () => {
  const gate = new ToolApprovalGate();
  const safeResult = gate.evaluate(makeRequest({ toolName: "memory_read", actorRole: "system" }));
  assert.equal(safeResult.approved, true);

  const reviewResult = gate.evaluate(makeRequest({ toolName: "write_file", actorRole: "system" }));
  assert.equal(reviewResult.approved, false);
  assert.equal(reviewResult.requiresOperatorApproval, true);
});
