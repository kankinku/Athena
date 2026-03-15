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
  {
    version: 14,
    sql: `
      CREATE TABLE IF NOT EXISTS security_decisions (
        id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject TEXT NOT NULL,
        verdict TEXT NOT NULL,
        reason TEXT NOT NULL,
        matched_pattern TEXT,
        intent TEXT,
        actor_role TEXT,
        session_id TEXT,
        run_id TEXT,
        machine_id TEXT,
        tool_name TEXT,
        tool_family TEXT,
        network_access INTEGER,
        destructive INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_security_decisions_created
        ON security_decisions(created_at);
      CREATE INDEX IF NOT EXISTS idx_security_decisions_session
        ON security_decisions(session_id, run_id, created_at);
    `,
  },
  {
    version: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS research_action_journal (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        state TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        lease_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT,
        result_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        heartbeat_at INTEGER,
        UNIQUE(session_id, run_id, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_research_action_journal_run
        ON research_action_journal(session_id, run_id, updated_at);

      CREATE TABLE IF NOT EXISTS research_run_leases (
        lease_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        released_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_research_run_leases_session
        ON research_run_leases(session_id, status, heartbeat_at);

      CREATE TABLE IF NOT EXISTS research_incidents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        proposal_id TEXT,
        experiment_id TEXT,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT,
        status TEXT NOT NULL,
        action_required INTEGER NOT NULL DEFAULT 0,
        related_action_id TEXT,
        related_decision_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_incidents_session
        ON research_incidents(session_id, status, severity, updated_at);
    `,
  },
  {
    version: 16,
    sql: `
      ALTER TABLE ingestion_sources ADD COLUMN evidence_health_json TEXT;
    `,
  },
  {
    version: 17,
    sql: `
      ALTER TABLE ingestion_sources ADD COLUMN source_digest TEXT;
      ALTER TABLE ingestion_sources ADD COLUMN source_excerpt TEXT;
    `,
  },
  {
    version: 18,
    sql: `
      CREATE TABLE research_action_journal_v2 (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        state TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        lease_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT,
        result_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        heartbeat_at INTEGER
      );
      INSERT INTO research_action_journal_v2 (
        id, session_id, run_id, action_type, state, dedupe_key, lease_id, summary,
        payload_json, result_json, error, created_at, updated_at, heartbeat_at
      )
      SELECT
        id, session_id, run_id, action_type, state, dedupe_key, lease_id, summary,
        payload_json, result_json, error, created_at, updated_at, heartbeat_at
      FROM research_action_journal;
      DROP TABLE research_action_journal;
      ALTER TABLE research_action_journal_v2 RENAME TO research_action_journal;
      CREATE INDEX IF NOT EXISTS idx_research_action_journal_run
        ON research_action_journal(session_id, run_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_research_action_journal_lookup
        ON research_action_journal(session_id, run_id, dedupe_key, created_at DESC);
    `,
  },
  {
    version: 19,
    sql: `
      ALTER TABLE security_decisions ADD COLUMN actor_id TEXT;
      ALTER TABLE security_decisions ADD COLUMN actor_tier TEXT;
      ALTER TABLE security_decisions ADD COLUMN action_class TEXT;
    `,
  },

  // ─── v0.4: Module-Based Change Management System ──────────────────────────
  {
    version: 20,
    sql: `
      -- Extend proposal_briefs with change management fields
      ALTER TABLE proposal_briefs ADD COLUMN change_workflow_state TEXT NOT NULL DEFAULT 'draft';
      ALTER TABLE proposal_briefs ADD COLUMN changed_paths_json TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN directly_affected_modules_json TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN indirectly_affected_modules_json TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN observer_modules_json TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN required_agents_json TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN meeting_required INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE proposal_briefs ADD COLUMN meeting_session_id TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN execution_plan_id TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN required_tests_json TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN contract_checks_json TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN rollback_conditions_json TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN feature_flag_required INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE proposal_briefs ADD COLUMN feature_flag_name TEXT;
      ALTER TABLE proposal_briefs ADD COLUMN created_by TEXT NOT NULL DEFAULT 'user';

      -- Agent meeting sessions
      CREATE TABLE IF NOT EXISTS meeting_sessions (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'scheduled',
        current_round INTEGER NOT NULL DEFAULT 1,
        mandatory_agents_json TEXT NOT NULL DEFAULT '[]',
        conditional_agents_json TEXT NOT NULL DEFAULT '[]',
        observer_agents_json TEXT NOT NULL DEFAULT '[]',
        responded_agents_json TEXT NOT NULL DEFAULT '[]',
        absent_agents_json TEXT NOT NULL DEFAULT '[]',
        key_positions_json TEXT,
        conflict_points_json TEXT,
        consensus_type TEXT,
        execution_plan_id TEXT,
        follow_up_actions_json TEXT,
        scheduled_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (proposal_id) REFERENCES proposal_briefs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_meeting_sessions_proposal
        ON meeting_sessions(proposal_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_meeting_sessions_state
        ON meeting_sessions(state, updated_at);

      -- Agent position records (statements during meetings)
      CREATE TABLE IF NOT EXISTS agent_positions (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        position TEXT NOT NULL,
        impact TEXT NOT NULL DEFAULT '',
        risk TEXT NOT NULL DEFAULT '',
        required_changes_json TEXT NOT NULL DEFAULT '[]',
        vote TEXT,
        approval_condition TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meeting_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_positions_meeting
        ON agent_positions(meeting_id, round, agent_id);

      -- Approval conditions (for conditionally-approved consensus)
      CREATE TABLE IF NOT EXISTS approval_conditions (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        required_by TEXT NOT NULL,
        condition_text TEXT NOT NULL,
        verification_method TEXT NOT NULL,
        verified_by TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        verified_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meeting_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_approval_conditions_meeting
        ON approval_conditions(meeting_id, status);

      -- Execution plans (generated from meeting consensus)
      CREATE TABLE IF NOT EXISTS execution_plans (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        task_assignments_json TEXT NOT NULL DEFAULT '[]',
        required_tests_json TEXT NOT NULL DEFAULT '[]',
        rollback_plan TEXT NOT NULL DEFAULT '',
        feature_flags_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (proposal_id) REFERENCES proposal_briefs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_execution_plans_proposal
        ON execution_plans(proposal_id, status);

      -- Verification results (post-execution test outcomes)
      CREATE TABLE IF NOT EXISTS verification_results (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        execution_plan_id TEXT NOT NULL,
        test_results_json TEXT NOT NULL DEFAULT '[]',
        overall_outcome TEXT NOT NULL,
        remeeting_required INTEGER NOT NULL DEFAULT 0,
        remeeting_reason TEXT,
        verified_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (proposal_id) REFERENCES proposal_briefs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_verification_results_proposal
        ON verification_results(proposal_id, verified_at);

      -- Module impact cache (ImpactAnalyzer results per proposal)
      CREATE TABLE IF NOT EXISTS module_impact_records (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        changed_paths_json TEXT NOT NULL,
        impact_result_json TEXT NOT NULL,
        analyzer_version TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (proposal_id) REFERENCES proposal_briefs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_module_impact_records_proposal
        ON module_impact_records(proposal_id, created_at);
    `,
  },

  // ─── v0.4.1: Audit Events + Pipeline Persistence ─────────────────────────
  {
    version: 21,
    sql: `
      -- Audit events for full pipeline traceability
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        actor TEXT NOT NULL DEFAULT 'system',
        action TEXT NOT NULL DEFAULT '',
        proposal_id TEXT,
        meeting_id TEXT,
        agent_id TEXT,
        module_id TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        severity TEXT NOT NULL DEFAULT 'info',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_entity
        ON audit_events(entity_type, entity_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_events_type
        ON audit_events(event_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_events_proposal
        ON audit_events(proposal_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_events_created
        ON audit_events(created_at);

      -- Pipeline run persistence for resume support
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        pipeline_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        session_id TEXT,
        current_state TEXT NOT NULL DEFAULT 'draft',
        current_stage TEXT,
        meeting_id TEXT,
        execution_plan_id TEXT,
        verification_id TEXT,
        impact_result_json TEXT,
        stages_json TEXT NOT NULL DEFAULT '[]',
        options_json TEXT NOT NULL DEFAULT '{}',
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (proposal_id) REFERENCES proposal_briefs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_proposal
        ON pipeline_runs(proposal_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_state
        ON pipeline_runs(current_state, updated_at);
    `,
  },

  // ─── v0.4.2: Interface Contracts + Budget Tracking ────────────────────────
  {
    version: 22,
    sql: `
      -- Interface contracts for 1st-class interface management
      CREATE TABLE IF NOT EXISTS interface_contracts (
        contract_id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        interface_name TEXT NOT NULL,
        interface_type TEXT NOT NULL DEFAULT 'function',
        source_file TEXT NOT NULL,
        signature TEXT,
        dependent_modules_json TEXT NOT NULL DEFAULT '[]',
        breaking_change_risk TEXT NOT NULL DEFAULT 'low',
        version TEXT NOT NULL DEFAULT '1.0.0',
        last_changed_at INTEGER,
        last_verified_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_interface_contracts_module
        ON interface_contracts(module_id);
      CREATE INDEX IF NOT EXISTS idx_interface_contracts_name
        ON interface_contracts(interface_name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_interface_contracts_unique
        ON interface_contracts(module_id, interface_name);

      -- Budget tracking for task execution enforcement
      CREATE TABLE IF NOT EXISTS budget_tracking (
        task_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        max_wall_clock_minutes INTEGER NOT NULL DEFAULT 60,
        max_retries INTEGER NOT NULL DEFAULT 3,
        max_files_changed INTEGER NOT NULL DEFAULT 20,
        max_cost_usd REAL NOT NULL DEFAULT 10.0,
        elapsed_minutes REAL NOT NULL DEFAULT 0,
        retries_used INTEGER NOT NULL DEFAULT 0,
        files_changed INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        files_changed_list_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        exceeded_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_budget_tracking_proposal
        ON budget_tracking(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_budget_tracking_status
        ON budget_tracking(status);
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
