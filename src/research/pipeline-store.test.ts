import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("PipelineStore: save, load, getById, listActive, updateState", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-pipeline-store-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { ChangeProposalStore }, { MeetingStore }, { PipelineStore }] = await Promise.all([
      import("../store/database.js"),
      import("./change-proposal-store.js"),
      import("./meeting-store.js"),
      import("./pipeline-store.js"),
    ]);
    const proposalStore = new ChangeProposalStore();
    const meetingStore = new MeetingStore();
    const store = new PipelineStore(meetingStore);
    const now = Date.now();

    proposalStore.save({
      proposalId: "prop_1",
      sessionId: "sess_1",
      title: "Pipeline proposal",
      summary: "",
      requestedChange: "",
      changedPaths: [],
      expectedEffect: "",
      riskAssumptions: [],
      targetModules: [],
      createdBy: "user",
      directlyAffectedModules: [],
      indirectlyAffectedModules: [],
      observerModules: [],
      requiredAgents: [],
      meetingRequired: false,
      requiredTests: [],
      rollbackConditions: [],
      featureFlagRequired: false,
      status: "draft",
      workflowState: "draft",
      createdAt: now,
      updatedAt: now,
    });

    meetingStore.saveMeetingSession({
      meetingId: "meeting_1",
      proposalId: "prop_1",
      state: "completed",
      currentRound: 1,
      mandatoryAgents: [],
      conditionalAgents: [],
      observerAgents: [],
      respondedAgents: [],
      absentAgents: [],
      keyPositions: [],
      conflictPoints: [],
      consensusType: "approved",
      executionPlanId: "plan_1",
      followUpActions: [],
      scheduledAt: now,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    meetingStore.saveExecutionPlan({
      executionPlanId: "plan_1",
      proposalId: "prop_1",
      meetingId: "meeting_1",
      taskAssignments: [],
      requiredTests: [],
      rollbackPlan: "git restore -- .",
      featureFlags: [],
      mergeGates: {},
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    meetingStore.saveVerificationResult({
      verificationId: "verify_1",
      proposalId: "prop_1",
      executionPlanId: "plan_1",
      testResults: [],
      overallOutcome: "passed",
      remeetingRequired: false,
      verifiedAt: now,
      createdAt: now,
    });

    const ctx = {
      pipelineId: "pipe_1",
      proposalId: "prop_1",
      sessionId: "sess_1",
      currentState: "draft" as const,
      stages: [{ stage: "impact" as const, status: "running" as const, startedAt: Date.now() }],
      meetingId: "meeting_1",
      executionPlan: meetingStore.getExecutionPlan("plan_1") ?? undefined,
      verificationResult: meetingStore.getVerificationResult("verify_1") ?? undefined,
      auditTrail: [],
    };

    // save + load
    store.save(ctx);
    const loaded = store.load("prop_1");
    assert.ok(loaded);
    assert.equal(loaded.pipelineId, "pipe_1");
    assert.equal(loaded.currentState, "draft");
    assert.equal(loaded.meetingResult?.meetingId, "meeting_1");
    assert.equal(loaded.executionPlan?.executionPlanId, "plan_1");
    assert.equal(loaded.verificationResult?.verificationId, "verify_1");

    // getById
    const byId = store.getById("pipe_1");
    assert.ok(byId);
    assert.equal(byId.proposalId, "prop_1");
    assert.equal(byId.executionPlan?.executionPlanId, "plan_1");

    // listActive (non-terminal)
    const active = store.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0]?.verificationResult?.verificationId, "verify_1");

    // updateState to terminal
    store.updateState("pipe_1", "merged");
    const updated = store.getById("pipe_1");
    assert.ok(updated);
    assert.equal(updated.currentState, "merged");

    // listActive should be empty now
    const afterMerge = store.listActive();
    assert.equal(afterMerge.length, 0);

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("PipelineStore: upsert updates existing pipeline", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-pipeline-upsert-"));
  process.env.ATHENA_HOME = home;

  try {
    const [{ closeDb }, { ChangeProposalStore }, { PipelineStore }] = await Promise.all([
      import("../store/database.js"),
      import("./change-proposal-store.js"),
      import("./pipeline-store.js"),
    ]);
    const proposalStore = new ChangeProposalStore();
    const store = new PipelineStore();
    const now = Date.now();

    proposalStore.save({
      proposalId: "prop_u",
      sessionId: "sess_u",
      title: "Upsert proposal",
      summary: "",
      requestedChange: "",
      changedPaths: [],
      expectedEffect: "",
      riskAssumptions: [],
      targetModules: [],
      createdBy: "user",
      directlyAffectedModules: [],
      indirectlyAffectedModules: [],
      observerModules: [],
      requiredAgents: [],
      meetingRequired: false,
      requiredTests: [],
      rollbackConditions: [],
      featureFlagRequired: false,
      status: "draft",
      workflowState: "draft",
      createdAt: now,
      updatedAt: now,
    });

    const ctx = {
      pipelineId: "pipe_u",
      proposalId: "prop_u",
      sessionId: "sess_u",
      currentState: "draft" as const,
      stages: [],
      auditTrail: [],
    };

    store.save(ctx);
    store.save({ ...ctx, currentState: "agents-summoned" as const });

    const loaded = store.load("prop_u");
    assert.ok(loaded);
    assert.equal(loaded.currentState, "agents-summoned");

    closeDb();
  } finally {
    const { closeDb } = await import("../store/database.js");
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
