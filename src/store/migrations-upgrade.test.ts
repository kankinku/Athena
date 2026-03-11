import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

import { runMigrations } from "./migrations.js";

test("runMigrations upgrades a pre-workflow research schema to the latest research schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-migration-upgrade-"));
  const dbPath = join(dir, "athena.db");
  const db = new Database(dbPath);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_version (
        version INTEGER PRIMARY KEY
      );

      CREATE TABLE team_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        current_stage TEXT NOT NULL,
        status TEXT NOT NULL,
        budget_json TEXT,
        latest_output_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE ingestion_sources (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        status TEXT NOT NULL,
        extracted_candidate_id TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claim_count INTEGER NOT NULL DEFAULT 0,
        linked_proposal_count INTEGER NOT NULL DEFAULT 0,
        freshness_score REAL,
        evidence_confidence REAL,
        method_tags_json TEXT,
        claims_json TEXT,
        canonical_claims_json TEXT
      );

      INSERT INTO _schema_version (version) VALUES (9);
    `);

    runMigrations(db);

    const teamRunColumns = db.prepare("PRAGMA table_info(team_runs)").all() as Array<{ name: string }>;
    const ingestionColumns = db.prepare("PRAGMA table_info(ingestion_sources)").all() as Array<{ name: string }>;

    const schemaVersion = db.prepare("SELECT MAX(version) AS version FROM _schema_version").get() as { version: number };
    assert.equal(schemaVersion.version, 12);

    assert.ok(teamRunColumns.some((column) => column.name === "workflow_state"));
    assert.ok(teamRunColumns.some((column) => column.name === "automation_policy_json"));
    assert.ok(teamRunColumns.some((column) => column.name === "checkpoint_policy_json"));
    assert.ok(teamRunColumns.some((column) => column.name === "retry_policy_json"));
    assert.ok(teamRunColumns.some((column) => column.name === "timeout_policy_json"));
    assert.ok(teamRunColumns.some((column) => column.name === "automation_state_json"));

    assert.ok(ingestionColumns.some((column) => column.name === "canonical_claims_json"));

    const workflowTransitionsExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workflow_transitions'").get() as { name: string } | undefined;
    const automationCheckpointsExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automation_checkpoints'").get() as { name: string } | undefined;
    const improvementProposalsExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'improvement_proposals'").get() as { name: string } | undefined;
    const improvementEvaluationsExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'improvement_evaluations'").get() as { name: string } | undefined;

    assert.equal(workflowTransitionsExists?.name, "workflow_transitions");
    assert.equal(automationCheckpointsExists?.name, "automation_checkpoints");
    assert.equal(improvementProposalsExists?.name, "improvement_proposals");
    assert.equal(improvementEvaluationsExists?.name, "improvement_evaluations");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
