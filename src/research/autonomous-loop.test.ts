import test from "node:test";
import assert from "node:assert/strict";
import type { TeamRunRecord } from "./contracts.js";
import {
  buildAutonomousContinuationPrompt,
  shouldContinueAutonomously,
} from "./autonomous-loop.js";

function createRun(overrides: Partial<TeamRunRecord> = {}): TeamRunRecord {
  return {
    id: "run-1",
    sessionId: "session-1",
    goal: "Keep improving Athena until the next safe change is exhausted",
    currentStage: "collection",
    status: "active",
    workflowState: "running",
    automationPolicy: {
      mode: "supervised-auto",
      requireProposalApproval: false,
      requireExperimentApproval: false,
      requireRevisitApproval: false,
      maxAutoExperiments: 3,
    },
    checkpointPolicy: {
      intervalMinutes: 30,
      onWorkflowStates: ["running", "evaluating", "revisit_due"],
    },
    retryPolicy: {
      maxRetries: 2,
      retryOn: ["inconclusive"],
    },
    timeoutPolicy: {
      maxRunMinutes: 120,
      maxStageMinutes: 30,
    },
    automationState: {
      retryCount: 0,
      resumeCount: 0,
    },
    iterationCount: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

test("shouldContinueAutonomously returns true for an active autonomous research run", () => {
  assert.equal(
    shouldContinueAutonomously(createRun(), {
      isStreaming: false,
      isSleeping: false,
      monitorActive: false,
    }),
    true,
  );
});

test("shouldContinueAutonomously blocks continuation while busy or manual", () => {
  assert.equal(
    shouldContinueAutonomously(createRun({ automationPolicy: { ...createRun().automationPolicy, mode: "manual" } }), {
      isStreaming: false,
      isSleeping: false,
      monitorActive: false,
    }),
    false,
  );
  assert.equal(
    shouldContinueAutonomously(createRun(), {
      isStreaming: true,
      isSleeping: false,
      monitorActive: false,
    }),
    false,
  );
  assert.equal(
    shouldContinueAutonomously(createRun(), {
      isStreaming: false,
      isSleeping: true,
      monitorActive: false,
    }),
    false,
  );
  assert.equal(
    shouldContinueAutonomously(createRun(), {
      isStreaming: false,
      isSleeping: false,
      monitorActive: true,
    }),
    false,
  );
});

test("shouldContinueAutonomously pauses policy-gated revisit loops", () => {
  assert.equal(
    shouldContinueAutonomously(createRun({
      workflowState: "revisit_due",
      automationPolicy: {
        ...createRun().automationPolicy,
        requireRevisitApproval: true,
      },
      latestOutput: {
        automationBlock: {
          action: "revisit",
          reason: "revisit approval required by automation policy",
          at: Date.now(),
        },
      },
    }), {
      isStreaming: false,
      isSleeping: false,
      monitorActive: false,
    }),
    false,
  );
});

test("buildAutonomousContinuationPrompt includes the run state and anti-stop instructions", () => {
  const prompt = buildAutonomousContinuationPrompt(createRun({
    id: "run-loop",
    currentStage: "planning",
    workflowState: "revisit_due",
    iterationCount: 4,
  }));

  assert.match(prompt, /run-loop/);
  assert.match(prompt, /workflow_state=revisit_due/);
  assert.match(prompt, /stage=planning/);
  assert.match(prompt, /iteration=4/);
  assert.match(prompt, /Do not summarize/);
  assert.match(prompt, /start_monitor or sleep/);
});
