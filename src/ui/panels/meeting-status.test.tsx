import test from "node:test";
import assert from "node:assert/strict";
import { MeetingStatusPanel } from "./meeting-status.js";
import type { MeetingSessionRecord } from "../../research/contracts.js";

function createMeeting(overrides: Partial<MeetingSessionRecord> = {}): MeetingSessionRecord {
  return {
    meetingId: "mtg_test001",
    proposalId: "cp_test001",
    state: "round-2",
    currentRound: 2,
    mandatoryAgents: ["store-agent", "research-agent"],
    conditionalAgents: ["cli-agent"],
    observerAgents: ["ui-agent"],
    respondedAgents: ["store-agent"],
    absentAgents: [],
    keyPositions: [
      {
        agentId: "store-agent",
        moduleId: "store",
        position: "support",
        vote: "approve",
        keyPoints: ["마이그레이션 준비됨"],
      },
    ],
    conflictPoints: [],
    followUpActions: [],
    scheduledAt: Date.now() - 60_000,
    startedAt: Date.now() - 30_000,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Render tests (component must not throw) ─────────────────────────────────

test("MeetingStatusPanel renders null meeting without throwing", () => {
  // Component render doesn't throw when meeting is null
  assert.doesNotThrow(() => {
    MeetingStatusPanel({ meeting: null });
  });
});

test("MeetingStatusPanel renders active meeting without throwing", () => {
  assert.doesNotThrow(() => {
    MeetingStatusPanel({ meeting: createMeeting() });
  });
});

test("MeetingStatusPanel renders with proposalTitle", () => {
  assert.doesNotThrow(() => {
    MeetingStatusPanel({
      meeting: createMeeting(),
      proposalTitle: "migrations.ts 변경",
    });
  });
});

test("MeetingStatusPanel renders with changeState", () => {
  assert.doesNotThrow(() => {
    MeetingStatusPanel({
      meeting: null,
      changeState: "impact-analyzed",
    });
  });
});

test("MeetingStatusPanel renders completed meeting with consensus", () => {
  const meeting = createMeeting({
    state: "completed",
    currentRound: 5,
    consensusType: "conditionally-approved",
    respondedAgents: ["store-agent", "research-agent", "cli-agent"],
    completedAt: Date.now(),
  });
  assert.doesNotThrow(() => {
    MeetingStatusPanel({ meeting });
  });
});

test("MeetingStatusPanel renders meeting with absent agents", () => {
  const meeting = createMeeting({
    absentAgents: ["cli-agent"],
  });
  assert.doesNotThrow(() => {
    MeetingStatusPanel({ meeting });
  });
});

test("MeetingStatusPanel renders meeting with conflicts", () => {
  const meeting = createMeeting({
    conflictPoints: [
      {
        conflictId: "cf_001",
        conflictType: "interface-conflict",
        description: "store ↔ research 인터페이스 충돌",
        involvedAgents: ["store-agent", "research-agent"],
        proposedResolutions: ["조건부 승인"],
      },
    ],
  });
  assert.doesNotThrow(() => {
    MeetingStatusPanel({ meeting });
  });
});

test("MeetingStatusPanel renders failed meeting", () => {
  const meeting = createMeeting({
    state: "failed",
    absentAgents: ["store-agent", "research-agent"],
  });
  assert.doesNotThrow(() => {
    MeetingStatusPanel({ meeting });
  });
});
