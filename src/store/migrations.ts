import type Database from "better-sqlite3";

interface Migration {
  version: number;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        token_count INTEGER,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        command TEXT NOT NULL,
        pid INTEGER,
        log_path TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        exit_code INTEGER,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        value REAL NOT NULL,
        step INTEGER,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_task_name
        ON metrics(task_id, metric_name, timestamp);

      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        auth_method TEXT NOT NULL,
        key_path TEXT,
        labels TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        expression TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sleep_reason TEXT,
        context_snapshot_id TEXT,
        poll_interval_ms INTEGER,
        deadline INTEGER,
        satisfied_leaves TEXT,
        last_evaluated_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        satisfied_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS _schema_version (
        version INTEGER PRIMARY KEY
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE INDEX IF NOT EXISTS idx_messages_session
        ON messages(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_name_ts
        ON metrics(metric_name, timestamp);

      CREATE TABLE IF NOT EXISTS memory_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        gist TEXT NOT NULL,
        content TEXT,
        is_dir INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_session_path
        ON memory_nodes(session_id, path);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE metrics ADD COLUMN agent_id TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_metrics_agent
        ON metrics(agent_id, metric_name, timestamp);

      ALTER TABLE sessions ADD COLUMN agent_id TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_sessions_agent
        ON sessions(agent_id, last_active_at);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE INDEX IF NOT EXISTS idx_metrics_agent_task
        ON metrics(agent_id, task_id, metric_name, timestamp);
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE sessions ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS memory_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        relationship TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, source_path, target_path, relationship)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_edges_source
        ON memory_edges(session_id, source_path, relationship);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_target
        ON memory_edges(session_id, target_path, relationship);

      CREATE TABLE IF NOT EXISTS team_runs (
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
      CREATE INDEX IF NOT EXISTS idx_team_runs_session
        ON team_runs(session_id, updated_at);

      CREATE TABLE IF NOT EXISTS proposal_briefs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_proposal_briefs_session
        ON proposal_briefs(session_id, status, updated_at);

      CREATE TABLE IF NOT EXISTS simulation_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        task_key TEXT,
        status TEXT NOT NULL,
        charter_json TEXT NOT NULL,
        budget_json TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_simulation_runs_session
        ON simulation_runs(session_id, proposal_id, updated_at);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS proposal_scorecards (
        proposal_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        weighted_score REAL NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_proposal_scorecards_session
        ON proposal_scorecards(session_id, updated_at);

      CREATE TABLE IF NOT EXISTS decision_records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        simulation_id TEXT,
        decision_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        summary TEXT NOT NULL,
        reason_tags_json TEXT NOT NULL,
        evidence_links_json TEXT NOT NULL,
        supersedes_decision_id TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_decision_records_session
        ON decision_records(session_id, proposal_id, created_at);

      CREATE TABLE IF NOT EXISTS reconsideration_triggers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_condition TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reconsideration_triggers_decision
        ON reconsideration_triggers(session_id, decision_id, status);

      CREATE TABLE IF NOT EXISTS experiment_lineage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        experiment_id TEXT,
        related_experiment_id TEXT,
        relation_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_experiment_lineage_session
        ON experiment_lineage(session_id, proposal_id, created_at);

      CREATE TABLE IF NOT EXISTS ingestion_sources (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        status TEXT NOT NULL,
        extracted_candidate_id TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ingestion_sources_session
        ON ingestion_sources(session_id, status, updated_at);
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE decision_records ADD COLUMN drift_json TEXT;
      ALTER TABLE decision_records ADD COLUMN calibration_json TEXT;

      ALTER TABLE reconsideration_triggers ADD COLUMN satisfied_at INTEGER;
      ALTER TABLE reconsideration_triggers ADD COLUMN evidence_links_json TEXT;

      ALTER TABLE experiment_lineage ADD COLUMN superseded_by_experiment_id TEXT;

      ALTER TABLE ingestion_sources ADD COLUMN claim_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ingestion_sources ADD COLUMN linked_proposal_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ingestion_sources ADD COLUMN freshness_score REAL;
      ALTER TABLE ingestion_sources ADD COLUMN evidence_confidence REAL;
      ALTER TABLE ingestion_sources ADD COLUMN method_tags_json TEXT;
       ALTER TABLE ingestion_sources ADD COLUMN claims_json TEXT;
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE ingestion_sources ADD COLUMN canonical_claims_json TEXT;
    `,
  },
  {
    version: 10,
    sql: `
      ALTER TABLE team_runs ADD COLUMN workflow_state TEXT NOT NULL DEFAULT 'draft';

      CREATE TABLE IF NOT EXISTS workflow_transitions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        rollback_of_transition_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_transitions_run
        ON workflow_transitions(session_id, run_id, created_at);
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE team_runs ADD COLUMN automation_policy_json TEXT;
      ALTER TABLE team_runs ADD COLUMN checkpoint_policy_json TEXT;
      ALTER TABLE team_runs ADD COLUMN retry_policy_json TEXT;
      ALTER TABLE team_runs ADD COLUMN timeout_policy_json TEXT;
      ALTER TABLE team_runs ADD COLUMN automation_state_json TEXT;

      CREATE TABLE IF NOT EXISTS automation_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        workflow_state TEXT NOT NULL,
        stage TEXT NOT NULL,
        reason TEXT NOT NULL,
        snapshot_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automation_checkpoints_run
        ON automation_checkpoints(session_id, run_id, created_at);
    `,
  },
  {
    version: 12,
    sql: `
      CREATE TABLE IF NOT EXISTS improvement_proposals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        proposal_id TEXT,
        experiment_id TEXT,
        title TEXT NOT NULL,
        target_area TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_improvement_proposals_run
        ON improvement_proposals(session_id, run_id, updated_at);

      CREATE TABLE IF NOT EXISTS improvement_evaluations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        improvement_id TEXT,
        run_id TEXT NOT NULL,
        experiment_id TEXT,
        outcome TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_improvement_evaluations_run
        ON improvement_evaluations(session_id, run_id, created_at);
    `,
  },
  {
    version: 13,
    sql: `
      ALTER TABLE simulation_runs ADD COLUMN log_path TEXT;
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const currentVersion =
    (
      db.prepare("SELECT MAX(version) as v FROM _schema_version").get() as
        | { v: number | null }
        | undefined
    )?.v ?? 0;

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO _schema_version (version) VALUES (?)").run(
          migration.version,
        );
      })();
    }
  }
}
