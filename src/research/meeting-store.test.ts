import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("MeetingStore persists and retrieves meeting sessions with all fields", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-meeting-store-"));
  process.env.ATHENA_HOME = home;

  const [{ MeetingStore }, { closeDb }] = await Promise.all([
    import("./meeting-store.js"),
    import("../store/database.js"),
  ]);

  try {
    const store = new MeetingStore();
    const now = Date.now();

    // FK 충족: proposal_briefs에 먼저 레코드 생성
    const db = (await import("../store/database.js")).getDb();
    db.prepare(
      "INSERT INTO proposal_briefs (id, session_id, title, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("cp_test_001", "s1", "Test", "draft", "{}", now, now);

    // Create meeting
    const session = store.saveMeetingSession({
      meetingId: "mtg_test_persist",
      proposalId: "cp_test_001",
      state: "scheduled",
      currentRound: 1,
      mandatoryAgents: ["store-agent", "research-agent"],
      conditionalAgents: ["cli-agent"],
      observerAgents: ["ui-agent"],
      respondedAgents: [],
      absentAgents: [],
      keyPositions: [],
      conflictPoints: [],
      followUpActions: [],
      scheduledAt: now,
      createdAt: now,
      updatedAt: now,
    });

    assert.equal(session.meetingId, "mtg_test_persist");
    assert.equal(session.state, "scheduled");

    // Read back
    const read = store.getMeetingSession("mtg_test_persist");
    assert.ok(read);
    assert.equal(read.proposalId, "cp_test_001");
    assert.deepEqual(read.mandatoryAgents, ["store-agent", "research-agent"]);
    assert.deepEqual(read.conditionalAgents, ["cli-agent"]);
    assert.deepEqual(read.observerAgents, ["ui-agent"]);

    // Update state
    const updated = store.updateMeetingState("mtg_test_persist", "round-2", {
      currentRound: 2,
      startedAt: now + 1000,
      respondedAgents: ["store-agent"],
    });
    assert.ok(updated);
    assert.equal(updated.state, "round-2");
    assert.equal(updated.currentRound, 2);
    assert.deepEqual(updated.respondedAgents, ["store-agent"]);

    // By proposal
    const byProposal = store.getMeetingByProposal("cp_test_001");
    assert.ok(byProposal);
    assert.equal(byProposal.meetingId, "mtg_test_persist");

    // Active meetings
    const active = store.listActiveMeetings();
    assert.ok(active.length >= 1);

    // Complete meeting
    const completed = store.updateMeetingState("mtg_test_persist", "completed", {
      currentRound: 5,
      consensusType: "approved",
      completedAt: now + 5000,
    });
    assert.ok(completed);
    assert.equal(completed.consensusType, "approved");

    // No longer in active list
    const activeAfter = store.listActiveMeetings();
    assert.ok(!activeAfter.some((m) => m.meetingId === "mtg_test_persist"));
  } finally {
    (await import("../store/database.js")).closeDb();
    rmSync(home, { recursive: true, force: true });
  }
});

test("MeetingStore persists agent positions per round", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-meeting-positions-"));
  process.env.ATHENA_HOME = home;

  const [{ MeetingStore }, { closeDb }] = await Promise.all([
    import("./meeting-store.js"),
    import("../store/database.js"),
  ]);

  try {
    const store = new MeetingStore();
    const now = Date.now();

    // FK 충족
    const db = (await import("../store/database.js")).getDb();
    db.prepare(
      "INSERT INTO proposal_briefs (id, session_id, title, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("cp_pos_001", "s1", "Test", "draft", "{}", now, now);

    // Create meeting first
    store.saveMeetingSession({
      meetingId: "mtg_pos_test",
      proposalId: "cp_pos_001",
      state: "round-2",
      currentRound: 2,
      mandatoryAgents: ["store-agent"],
      conditionalAgents: [],
      observerAgents: [],
      respondedAgents: [],
      absentAgents: [],
      keyPositions: [],
      conflictPoints: [],
      followUpActions: [],
      scheduledAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Save agent position
    store.saveAgentPosition({
      positionId: "pos_round2_store",
      meetingId: "mtg_pos_test",
      agentId: "store-agent",
      moduleId: "store",
      round: 2,
      position: "support",
      impact: "마이그레이션 호환 확인됨",
      risk: "low",
      requiredChanges: ["테스트 추가 필요"],
      vote: "approve",
      approvalCondition: undefined,
      notes: "v20 마이그레이션 준비 완료",
      createdAt: now,
    });

    // List by meeting
    const positions = store.listAgentPositions("mtg_pos_test");
    assert.equal(positions.length, 1);
    assert.equal(positions[0].position, "support");
    assert.equal(positions[0].vote, "approve");
    assert.deepEqual(positions[0].requiredChanges, ["테스트 추가 필요"]);

    // Get specific
    const specific = store.getAgentPosition("mtg_pos_test", "store-agent", 2);
    assert.ok(specific);
    assert.equal(specific.impact, "마이그레이션 호환 확인됨");

    // List by round
    const round2 = store.listAgentPositions("mtg_pos_test", 2);
    assert.equal(round2.length, 1);

    const round3 = store.listAgentPositions("mtg_pos_test", 3);
    assert.equal(round3.length, 0);
  } finally {
    (await import("../store/database.js")).closeDb();
    rmSync(home, { recursive: true, force: true });
  }
});

test("MeetingStore persists approval conditions and tracks status", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-meeting-conditions-"));
  process.env.ATHENA_HOME = home;

  const [{ MeetingStore }, { closeDb }] = await Promise.all([
    import("./meeting-store.js"),
    import("../store/database.js"),
  ]);

  try {
    const store = new MeetingStore();
    const now = Date.now();

    // FK 충족
    const db = (await import("../store/database.js")).getDb();
    db.prepare(
      "INSERT INTO proposal_briefs (id, session_id, title, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("cp_cond_001", "s1", "Test", "draft", "{}", now, now);

    // Create meeting
    store.saveMeetingSession({
      meetingId: "mtg_cond_test",
      proposalId: "cp_cond_001",
      state: "completed",
      currentRound: 5,
      mandatoryAgents: ["research-agent"],
      conditionalAgents: [],
      observerAgents: [],
      respondedAgents: ["research-agent"],
      absentAgents: [],
      keyPositions: [],
      conflictPoints: [],
      consensusType: "conditionally-approved",
      followUpActions: [],
      scheduledAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Save conditions
    store.saveApprovalCondition({
      conditionId: "cond_001",
      meetingId: "mtg_cond_test",
      proposalId: "cp_cond_001",
      requiredBy: "research-agent",
      conditionText: "MeetingStore 구현 완료",
      verificationMethod: "tsc --noEmit 통과",
      status: "pending",
      createdAt: now,
    });

    store.saveApprovalCondition({
      conditionId: "cond_002",
      meetingId: "mtg_cond_test",
      proposalId: "cp_cond_001",
      requiredBy: "store-agent",
      conditionText: "마이그레이션 테스트 통과",
      verificationMethod: "npm run test -- src/store/migrations-v20*",
      status: "pending",
      createdAt: now,
    });

    // List pending
    const pending = store.listPendingConditions("cp_cond_001");
    assert.equal(pending.length, 2);

    // Verify one
    const verified = store.updateApprovalCondition("cond_002", {
      status: "verified",
      verifiedBy: "operator",
      verifiedAt: now + 1000,
    });
    assert.ok(verified);
    assert.equal(verified.status, "verified");

    // Still one pending
    const stillPending = store.listPendingConditions("cp_cond_001");
    assert.equal(stillPending.length, 1);
    assert.equal(stillPending[0].conditionId, "cond_001");
  } finally {
    (await import("../store/database.js")).closeDb();
    rmSync(home, { recursive: true, force: true });
  }
});

test("MeetingStore persists execution plans and verification results", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-meeting-execution-"));
  process.env.ATHENA_HOME = home;

  const [{ MeetingStore }, { closeDb }] = await Promise.all([
    import("./meeting-store.js"),
    import("../store/database.js"),
  ]);

  try {
    const store = new MeetingStore();
    const now = Date.now();

    // FK 충족
    const db = (await import("../store/database.js")).getDb();
    db.prepare(
      "INSERT INTO proposal_briefs (id, session_id, title, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("cp_exec_001", "s1", "Test", "draft", "{}", now, now);

    // Save execution plan
    const plan = store.saveExecutionPlan({
      executionPlanId: "plan_test_001",
      proposalId: "cp_exec_001",
      meetingId: "mtg_exec_001",
      taskAssignments: [
        { agentId: "store-agent", moduleId: "store", tasks: ["마이그레이션 적용"], dependsOnAgents: [] },
      ],
      requiredTests: ["src/store/migrations-upgrade.test.ts"],
      rollbackPlan: "git reset --hard HEAD~1",
      featureFlags: [],
      mergeGates: {},
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    assert.equal(plan.executionPlanId, "plan_test_001");

    // Get by proposal
    const byProposal = store.getExecutionPlanByProposal("cp_exec_001");
    assert.ok(byProposal);
    assert.equal(byProposal.taskAssignments.length, 1);

    // Update status
    const started = store.updateExecutionPlanStatus("plan_test_001", "in-progress", { startedAt: now + 1000 });
    assert.ok(started);
    assert.equal(started.status, "in-progress");

    // Save verification result
    store.saveVerificationResult({
      verificationId: "ver_test_001",
      proposalId: "cp_exec_001",
      executionPlanId: "plan_test_001",
      testResults: [
        { testId: "migration-test", testCommand: "npm run test", outcome: "passed", ownerModule: "store", durationMs: 500 },
      ],
      overallOutcome: "passed",
      remeetingRequired: false,
      verifiedAt: now + 2000,
      createdAt: now + 2000,
    });

    const verResults = store.listVerificationResults("cp_exec_001");
    assert.equal(verResults.length, 1);
    assert.equal(verResults[0].overallOutcome, "passed");
    assert.equal(verResults[0].remeetingRequired, false);
  } finally {
    (await import("../store/database.js")).closeDb();
    rmSync(home, { recursive: true, force: true });
  }
});
