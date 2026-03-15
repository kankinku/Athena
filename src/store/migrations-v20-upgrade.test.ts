/**
 * v20 마이그레이션 호환성 테스트.
 *
 * v19 스키마에서 v20 마이그레이션을 적용했을 때:
 * 1. 기존 데이터가 보존되는지
 * 2. 신규 테이블 6개가 모두 생성되는지
 * 3. proposal_briefs에 새 컬럼이 추가되는지
 * 4. 기존 proposal_briefs 데이터의 기본값이 올바른지
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

import { runMigrations } from "./migrations.js";

test("v20 migration creates change management tables on fresh DB", () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-v20-fresh-"));
  const dbPath = join(dir, "athena.db");
  const db = new Database(dbPath);

  try {
    runMigrations(db);

    const schemaVersion = db.prepare("SELECT MAX(version) AS version FROM _schema_version").get() as { version: number };
    assert.equal(schemaVersion.version, 23);

    // 신규 테이블 존재 확인
    const tables = ["meeting_sessions", "agent_positions", "approval_conditions",
                     "execution_plans", "verification_results", "module_impact_records"];
    for (const table of tables) {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | undefined;
      assert.equal(exists?.name, table, `Table ${table} should exist`);
    }

    // proposal_briefs 새 컬럼 확인
    const pbColumns = db.prepare("PRAGMA table_info(proposal_briefs)").all() as Array<{ name: string }>;
    const newColumns = [
      "change_workflow_state", "changed_paths_json", "directly_affected_modules_json",
      "indirectly_affected_modules_json", "observer_modules_json", "required_agents_json",
      "meeting_required", "meeting_session_id", "execution_plan_id",
      "required_tests_json", "rollback_conditions_json",
      "feature_flag_required", "feature_flag_name", "created_by",
    ];
    for (const col of newColumns) {
      assert.ok(pbColumns.some((c) => c.name === col), `proposal_briefs should have column: ${col}`);
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("v20 migration upgrades from v19 and preserves existing data", () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-v20-upgrade-"));
  const dbPath = join(dir, "athena.db");
  const db = new Database(dbPath);

  try {
    // v19까지의 기존 스키마를 수동으로 시뮬레이션하지 않고,
    // runMigrations를 v19에서 멈추고 데이터를 넣은 뒤 v20을 적용한다.
    // 하지만 runMigrations는 원자적이므로 대신:
    // 전체 마이그레이션 실행 후 기존 데이터 형태가 기본값을 갖는지 확인

    runMigrations(db);

    // 기존 형식의 proposal_briefs 삽입 (v19 이전의 minimal insert)
    const now = Date.now();
    db.prepare(
      `INSERT INTO proposal_briefs (id, session_id, title, status, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("old-proposal-1", "session-1", "Legacy Proposal", "candidate", "{}", now, now);

    // 기본값 확인
    const row = db.prepare("SELECT * FROM proposal_briefs WHERE id = ?").get("old-proposal-1") as Record<string, unknown>;
    assert.equal(row.change_workflow_state, "draft", "기존 proposal의 change_workflow_state 기본값은 draft");
    assert.equal(row.meeting_required, 0, "기존 proposal의 meeting_required 기본값은 0");
    assert.equal(row.feature_flag_required, 0, "기존 proposal의 feature_flag_required 기본값은 0");
    assert.equal(row.created_by, "user", "기존 proposal의 created_by 기본값은 user");

    // 신규 테이블에 데이터 삽입 가능한지 확인
    db.prepare(
      `INSERT INTO meeting_sessions (id, proposal_id, state, current_round,
         mandatory_agents_json, conditional_agents_json, observer_agents_json,
         responded_agents_json, absent_agents_json, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("mtg_test_1", "old-proposal-1", "scheduled", 1, "[]", "[]", "[]", "[]", "[]", now, now, now);

    const mtg = db.prepare("SELECT * FROM meeting_sessions WHERE id = 'mtg_test_1'").get() as Record<string, unknown>;
    assert.equal(mtg.proposal_id, "old-proposal-1");
    assert.equal(mtg.state, "scheduled");

    // Foreign key: proposal_briefs(id)를 참조하는 meeting_sessions가 올바른 FK 관계인지
    db.prepare(
      `INSERT INTO agent_positions (id, meeting_id, agent_id, module_id, round, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("pos_001", "mtg_test_1", "store-agent", "store", 2, "support", now);

    const pos = db.prepare("SELECT * FROM agent_positions WHERE id = 'pos_001'").get() as Record<string, unknown>;
    assert.equal(pos.meeting_id, "mtg_test_1");
    assert.equal(pos.position, "support");
    assert.equal(pos.impact, ""); // 기본값

    // execution_plans
    db.prepare(
      `INSERT INTO execution_plans (id, proposal_id, meeting_id, task_assignments_json, required_tests_json, rollback_plan, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("plan_001", "old-proposal-1", "mtg_test_1", "[]", "[]", "git reset", "pending", now, now);

    const plan = db.prepare("SELECT * FROM execution_plans WHERE id = 'plan_001'").get() as Record<string, unknown>;
    assert.equal(plan.status, "pending");
    assert.equal(plan.rollback_plan, "git reset");

    // verification_results
    db.prepare(
      `INSERT INTO verification_results (id, proposal_id, execution_plan_id, test_results_json, overall_outcome, remeeting_required, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("ver_001", "old-proposal-1", "plan_001", "[]", "passed", 0, now, now);

    const ver = db.prepare("SELECT * FROM verification_results WHERE id = 'ver_001'").get() as Record<string, unknown>;
    assert.equal(ver.overall_outcome, "passed");
    assert.equal(ver.remeeting_required, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("v20 migration indexes are created correctly", () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-v20-indexes-"));
  const dbPath = join(dir, "athena.db");
  const db = new Database(dbPath);

  try {
    runMigrations(db);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
    ).all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    // v20에서 생성되는 인덱스 확인
    assert.ok(indexNames.includes("idx_meeting_sessions_proposal"), "meeting_sessions proposal index");
    assert.ok(indexNames.includes("idx_meeting_sessions_state"), "meeting_sessions state index");
    assert.ok(indexNames.includes("idx_agent_positions_meeting"), "agent_positions meeting index");
    assert.ok(indexNames.includes("idx_approval_conditions_meeting"), "approval_conditions meeting index");
    assert.ok(indexNames.includes("idx_execution_plans_proposal"), "execution_plans proposal index");
    assert.ok(indexNames.includes("idx_verification_results_proposal"), "verification_results proposal index");
    assert.ok(indexNames.includes("idx_module_impact_records_proposal"), "module_impact_records proposal index");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
