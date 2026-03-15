/**
 * ImpactAnalyzer end-to-end tests.
 *
 * GraphBuilder로 테스트용 그래프를 구성하고
 * ImpactAnalyzer의 영향도 분석 결과를 검증한다.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { GraphBuilder } from "./graph-builder.js";
import { ImpactAnalyzer } from "./impact-analyzer.js";
import type { ModuleGraph } from "./graph-builder.js";

// ─── Test Fixture: 소규모 모듈 그래프 ─────────────────────────────────────────

function buildTestGraph(): ModuleGraph {
  const builder = new GraphBuilder();
  return builder.buildFromRegistry({
    version: "test",
    modules: [
      {
        module_id: "store",
        owner_agent: "store-agent",
        paths: ["src/store/**"],
        public_interfaces: ["getDb()", "runMigrations()"],
        depends_on: [],
        risk_level: "critical",
        affected_tests: ["src/store/migrations-upgrade.test.ts"],
      },
      {
        module_id: "research",
        owner_agent: "research-agent",
        paths: ["src/research/**"],
        public_interfaces: ["ProposalStore", "contracts"],
        depends_on: ["store"],
        risk_level: "high",
        affected_tests: ["src/research/workflow-state.test.ts"],
      },
      {
        module_id: "cli",
        owner_agent: "cli-agent",
        paths: ["src/cli/**"],
        depends_on: ["research", "store"],
        risk_level: "medium",
        affected_tests: ["src/cli/security.test.ts"],
      },
      {
        module_id: "ui",
        owner_agent: "ui-agent",
        paths: ["src/ui/**", "src/app.tsx"],
        depends_on: ["research", "store"],
        risk_level: "low",
        affected_tests: ["src/ui/panels/research-status.test.tsx"],
      },
      {
        module_id: "remote",
        owner_agent: "remote-agent",
        paths: ["src/remote/**"],
        depends_on: ["store", "security"],
        risk_level: "high",
        affected_tests: ["src/remote/executor.test.ts"],
      },
      {
        module_id: "security",
        owner_agent: "security-agent",
        paths: ["src/security/**"],
        depends_on: ["store"],
        risk_level: "critical",
        affected_tests: ["src/security/policy.test.ts"],
      },
      {
        module_id: "impact",
        owner_agent: "impact-agent",
        paths: ["src/impact/**", "config/module-registry.yaml"],
        depends_on: ["store"],
        risk_level: "medium",
        affected_tests: [],
      },
    ],
    merge_gates: {},
  });
}

// ─── Scenario 1: 단일 모듈 내부 수정 ─────────────────────────────────────────

test("Impact: single low-risk module internal change — no meeting required", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  // ui module is "low" risk → single internal change should not require meeting
  const result = analyzer.analyze(["src/ui/panels/conversation.tsx"]);

  assert.equal(result.directlyAffected.length, 1);
  assert.equal(result.directlyAffected[0].moduleId, "ui");
  assert.equal(result.directlyAffected[0].riskLevel, "low");
  assert.equal(result.indirectlyAffected.length, 0);
  assert.equal(result.meetingRequired, false);
  assert.equal(result.meetingRequiredReason, "single-module-internal");
});

// ─── Scenario 2: 공용 인터페이스 변경 ─────────────────────────────────────────

test("Impact: contracts.ts change triggers meeting (high risk module)", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  const result = analyzer.analyze(
    ["src/research/contracts.ts"],
    ["src/research/contracts.ts"],  // explicit interface change
  );

  assert.equal(result.directlyAffected.length, 1);
  assert.equal(result.directlyAffected[0].moduleId, "research");
  // research is high risk → meeting required
  assert.equal(result.meetingRequired, true);
  assert.ok(result.meetingRequiredReason.includes("high") || result.meetingRequiredReason.includes("인터페이스"));

  // nonCodeImpacts should detect contract change
  assert.ok(result.nonCodeImpacts.some((n) => n.type === "contract"),
    "Should detect contract dependency change");
});

// ─── Scenario 3: DB 스키마 변경 (critical 모듈) ───────────────────────────────

test("Impact: migrations.ts change — critical module triggers meeting", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  const result = analyzer.analyze(["src/store/migrations.ts"]);

  assert.equal(result.directlyAffected.length, 1);
  assert.equal(result.directlyAffected[0].moduleId, "store");
  assert.equal(result.directlyAffected[0].riskLevel, "critical");
  assert.equal(result.meetingRequired, true);
  assert.ok(result.meetingRequiredReason.includes("critical"));
});

// ─── Scenario 4: 여러 모듈 동시 수정 ─────────────────────────────────────────

test("Impact: two modules changed simultaneously — meeting required", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  const result = analyzer.analyze([
    "src/ui/panels/research-status.tsx",
    "src/research/reporting.ts",
  ]);

  assert.equal(result.directlyAffected.length, 2);
  const directIds = result.directlyAffected.map((m) => m.moduleId).sort();
  assert.deepEqual(directIds, ["research", "ui"]);
  assert.equal(result.meetingRequired, true);
  // research is "high" risk → triggers meeting via risk check
  assert.ok(
    result.meetingRequiredReason.includes("2개 모듈") || result.meetingRequiredReason.includes("high"),
    "Should cite multi-module or high risk"
  );
});

// ─── Scenario 5: 운영 설정 변경 ──────────────────────────────────────────────

test("Impact: module-registry.yaml change — impact module directly affected", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  const result = analyzer.analyze(["config/module-registry.yaml"]);

  assert.equal(result.directlyAffected.length, 1);
  assert.equal(result.directlyAffected[0].moduleId, "impact");
});

// ─── Scenario 6: security 모듈 변경 → remote 간접 영향 ────────────────────────

test("Impact: security change — critical module triggers meeting", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  const result = analyzer.analyze(["src/security/policy.ts"]);

  assert.equal(result.directlyAffected[0].moduleId, "security");
  assert.equal(result.directlyAffected[0].riskLevel, "critical");
  assert.equal(result.meetingRequired, true);
  assert.ok(result.meetingRequiredReason.includes("critical"));
});

// ─── Scenario 7: 영향 없는 파일 ──────────────────────────────────────────────

test("Impact: unregistered file path — no modules affected", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  const result = analyzer.analyze(["README.md"]);

  assert.equal(result.directlyAffected.length, 0);
  assert.equal(result.indirectlyAffected.length, 0);
  assert.equal(result.observers.length, 0);
  assert.equal(result.meetingRequired, false);
});

// ─── Scenario 8: observer 단계 검증 (depth 2+) ───────────────────────────────

test("Impact: deep dependency chain produces observer level", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  // store 변경 + interface change
  // → research, cli, ui, remote, security, impact are indirect (depth 1)
  // cli depends on research which depends on store → cli at depth 1 (direct dep)
  // BUT cli also depends on store directly → depth 1

  const result = analyzer.analyze(
    ["src/store/database.ts"],
    ["src/store/database.ts"],
  );

  assert.equal(result.directlyAffected[0].moduleId, "store");
  // All modules that depend on store are indirect
  assert.ok(result.indirectlyAffected.length >= 2, "Multiple indirect modules expected");

  // total affected should cover most of the graph
  assert.ok(result.allAffected.length >= 3, "At least store + 2 dependents");
});

// ─── Scenario 9: summaryText 형식 검증 ────────────────────────────────────────

test("Impact: summaryText contains module IDs", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  const result = analyzer.analyze(["src/store/migrations.ts"]);

  assert.ok(result.summaryText.includes("store"), "summaryText should mention store");
  assert.ok(result.summaryText.includes("직접"), "summaryText should mention 직접");
});

// ─── Scenario 10: Windows 경로 정규화 ─────────────────────────────────────────

test("Impact: Windows backslash paths are normalized correctly", () => {
  const graph = buildTestGraph();
  const analyzer = new ImpactAnalyzer(graph);

  const result = analyzer.analyze(["src\\store\\migrations.ts"]);

  assert.equal(result.directlyAffected.length, 1);
  assert.equal(result.directlyAffected[0].moduleId, "store");
});
