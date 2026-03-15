/**
 * interface-contract-store.ts
 *
 * 모듈 간 공용 인터페이스 계약의 DB 영속화 및 CRUD.
 * InterfaceContract를 1급 객체로 관리하여 영향 분석과 breaking change 감지를 강화한다.
 */

import { getDb } from "../store/database.js";
import type { InterfaceContract, BreakingChangeResult } from "./contracts.js";

interface ContractRow {
  contract_id: string;
  module_id: string;
  interface_name: string;
  interface_type: string;
  source_file: string;
  signature: string | null;
  dependent_modules_json: string;
  breaking_change_risk: string;
  version: string;
  last_changed_at: number | null;
  last_verified_at: number | null;
  created_at: number;
  updated_at: number;
}

export class InterfaceContractStore {
  /**
   * 인터페이스 계약을 등록하거나 업데이트한다 (upsert).
   */
  register(contract: InterfaceContract): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO interface_contracts (
         contract_id, module_id, interface_name, interface_type,
         source_file, signature, dependent_modules_json,
         breaking_change_risk, version, last_changed_at, last_verified_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(contract_id) DO UPDATE SET
         interface_name = excluded.interface_name,
         interface_type = excluded.interface_type,
         source_file = excluded.source_file,
         signature = excluded.signature,
         dependent_modules_json = excluded.dependent_modules_json,
         breaking_change_risk = excluded.breaking_change_risk,
         version = excluded.version,
         last_changed_at = excluded.last_changed_at,
         last_verified_at = excluded.last_verified_at,
         updated_at = excluded.updated_at`,
    ).run(
      contract.contractId,
      contract.moduleId,
      contract.interfaceName,
      contract.interfaceType,
      contract.sourceFile,
      contract.signature ?? null,
      JSON.stringify(contract.dependentModules),
      contract.breakingChangeRisk,
      contract.version,
      contract.lastChangedAt ?? null,
      contract.lastVerifiedAt ?? null,
      now,
      now,
    );
  }

  /**
   * 여러 계약을 한 트랜잭션으로 일괄 등록한다.
   */
  registerBatch(contracts: InterfaceContract[]): void {
    const db = getDb();
    const tx = db.transaction(() => {
      for (const c of contracts) {
        this.register(c);
      }
    });
    tx();
  }

  /**
   * contractId로 계약을 조회한다.
   */
  get(contractId: string): InterfaceContract | null {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM interface_contracts WHERE contract_id = ?")
      .get(contractId) as ContractRow | undefined;
    return row ? rowToContract(row) : null;
  }

  /**
   * 모듈이 소유한 인터페이스 계약 목록.
   */
  listByModule(moduleId: string): InterfaceContract[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM interface_contracts WHERE module_id = ? ORDER BY interface_name")
      .all(moduleId) as ContractRow[];
    return rows.map(rowToContract);
  }

  /**
   * 특정 인터페이스를 소비하는(의존하는) 모듈 목록.
   */
  listConsumers(contractId: string): string[] {
    const contract = this.get(contractId);
    return contract?.dependentModules ?? [];
  }

  /**
   * 모듈 이름으로 해당 모듈이 의존하는 인터페이스 계약들을 조회한다.
   */
  listDependenciesOf(moduleId: string): InterfaceContract[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM interface_contracts WHERE dependent_modules_json LIKE ?")
      .all(`%"${moduleId}"%`) as ContractRow[];
    return rows.map(rowToContract);
  }

  /**
   * 인터페이스 변경이 breaking change인지 판단한다.
   * 새 시그니처와 기존 시그니처를 비교한다.
   */
  checkBreakingChange(
    contractId: string,
    newSignature: string,
    newVersion: string,
  ): BreakingChangeResult {
    const contract = this.get(contractId);
    if (!contract) {
      return {
        isBreaking: false,
        reason: "Contract not found — treating as new",
        affectedConsumers: [],
        riskLevel: "low",
      };
    }

    const oldSig = contract.signature ?? "";
    const sigChanged = oldSig !== newSignature;

    if (!sigChanged) {
      return {
        isBreaking: false,
        reason: "Signature unchanged",
        affectedConsumers: [],
        riskLevel: "low",
      };
    }

    // 시그니처가 변경된 경우 — 의존 모듈 수와 risk 레벨로 판단
    const consumers = contract.dependentModules;
    const isBreaking = consumers.length > 0;
    const riskLevel = consumers.length >= 3
      ? "critical"
      : consumers.length >= 1
        ? contract.breakingChangeRisk === "high" ? "critical" : "high"
        : "medium";

    return {
      isBreaking,
      reason: `Signature changed: "${oldSig}" → "${newSignature}", ${consumers.length} consumer(s) affected`,
      affectedConsumers: consumers,
      riskLevel,
    };
  }

  /**
   * 계약의 검증 시각을 업데이트한다.
   */
  markVerified(contractId: string): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      "UPDATE interface_contracts SET last_verified_at = ?, updated_at = ? WHERE contract_id = ?",
    ).run(now, now, contractId);
  }

  /**
   * 계약의 시그니처/버전을 업데이트하고 변경 시각을 기록한다.
   */
  updateSignature(contractId: string, signature: string, version: string): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `UPDATE interface_contracts
       SET signature = ?, version = ?, last_changed_at = ?, updated_at = ?
       WHERE contract_id = ?`,
    ).run(signature, version, now, now, contractId);
  }

  /**
   * 전체 인터페이스 계약 목록.
   */
  listAll(): InterfaceContract[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM interface_contracts ORDER BY module_id, interface_name")
      .all() as ContractRow[];
    return rows.map(rowToContract);
  }

  /**
   * 계약을 삭제한다.
   */
  delete(contractId: string): void {
    const db = getDb();
    db.prepare("DELETE FROM interface_contracts WHERE contract_id = ?").run(contractId);
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function rowToContract(row: ContractRow): InterfaceContract {
  return {
    contractId: row.contract_id,
    moduleId: row.module_id,
    interfaceName: row.interface_name,
    interfaceType: row.interface_type as InterfaceContract["interfaceType"],
    sourceFile: row.source_file,
    signature: row.signature ?? undefined,
    dependentModules: JSON.parse(row.dependent_modules_json),
    breakingChangeRisk: row.breaking_change_risk as InterfaceContract["breakingChangeRisk"],
    version: row.version,
    lastChangedAt: row.last_changed_at ?? undefined,
    lastVerifiedAt: row.last_verified_at ?? undefined,
  };
}
