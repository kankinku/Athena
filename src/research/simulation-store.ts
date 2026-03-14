import { nanoid } from "nanoid";
import { getDb } from "../store/database.js";
import type {
  ExperimentBudget,
  ExperimentCharter,
  ExperimentResult,
} from "./contracts.js";

export interface SimulationRunRecord {
  id: string;
  sessionId: string;
  proposalId: string;
  taskKey?: string;
  logPath?: string;
  status: string;
  charter: ExperimentCharter;
  budget?: ExperimentBudget;
  result?: ExperimentResult;
  createdAt: number;
  updatedAt: number;
}

export class SimulationStore {
  listRecentSimulationRuns(sessionId: string, limit = 5): SimulationRunRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM simulation_runs
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    ).all(sessionId, limit) as Record<string, unknown>[];
    return rows.map(mapSimulationRun);
  }

  listRunningSimulationRuns(sessionId: string): SimulationRunRecord[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM simulation_runs
       WHERE session_id = ? AND status = 'running'
       ORDER BY updated_at DESC`,
    ).all(sessionId) as Record<string, unknown>[];
    return rows.map(mapSimulationRun);
  }

  createSimulationRun(
    sessionId: string,
    proposalId: string,
    charter: ExperimentCharter,
  ): SimulationRunRecord {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();
    db.prepare(
      `INSERT INTO simulation_runs (id, session_id, proposal_id, task_key, log_path, status, charter_json, budget_json, result_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      sessionId,
      proposalId,
      null,
      null,
      "pending",
      JSON.stringify(charter),
      charter.budget ? JSON.stringify(charter.budget) : null,
      null,
      now,
      now,
    );

    return {
      id,
      sessionId,
      proposalId,
      logPath: undefined,
      status: "pending",
      charter,
      budget: charter.budget,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateSimulationRun(
    id: string,
    updates: {
      taskKey?: string;
      logPath?: string;
      status?: string;
      result?: ExperimentResult;
    },
  ): SimulationRunRecord | null {
    const current = this.getSimulationRun(id);
    if (!current) return null;
    const next: SimulationRunRecord = {
      ...current,
      taskKey: updates.taskKey ?? current.taskKey,
      logPath: updates.logPath ?? current.logPath,
      status: updates.status ?? current.status,
      result: updates.result ?? current.result,
      updatedAt: Date.now(),
    };
    const db = getDb();
    db.prepare(
      `UPDATE simulation_runs
       SET task_key = ?, log_path = ?, status = ?, result_json = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      next.taskKey ?? null,
      next.logPath ?? null,
      next.status,
      next.result ? JSON.stringify(next.result) : null,
      next.updatedAt,
      id,
    );
    return next;
  }

  getSimulationRun(id: string): SimulationRunRecord | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM simulation_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapSimulationRun(row) : null;
  }
}

function mapSimulationRun(row: Record<string, unknown>): SimulationRunRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    proposalId: row.proposal_id as string,
    taskKey: (row.task_key as string | null) ?? undefined,
    logPath: (row.log_path as string | null) ?? undefined,
    status: row.status as string,
    charter: JSON.parse(row.charter_json as string) as ExperimentCharter,
    budget: row.budget_json ? (JSON.parse(row.budget_json as string) as ExperimentBudget) : undefined,
    result: row.result_json ? (JSON.parse(row.result_json as string) as ExperimentResult) : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}
