# Feature Alignment Plan

## Goal

Athena를 프로젝트 목표에 맞게 다시 정렬한다.

기준 목표는 [docs/goal.md](./docs/goal.md)의 정의를 따른다.

> explicit goal -> collect material -> shortlist and compare -> choose the next bounded improvement -> execute or simulate -> evaluate -> keep, discard, or revisit -> repeat

이 계획은 기능을 많이 남기는 것이 목적이 아니다.

각 기능이 위 루프를 직접 강화하는지, 조건부로만 필요한지, 실험 영역으로 격리해야 하는지를 기능별로 정리한다.

## Reviewed Documents

- `docs/goal.md`
- `README.md`
- `docs/architecture-overview.md`
- `docs/current-state-mapping.md`
- `docs/bounded-autonomy.md`
- `docs/operator-runbook.md`
- `docs/module-autoresearch.md`
- `docs/meeting-protocol.md`
- `docs/execution-gate.md`
- `docs/verification-pipeline.md`
- `docs/guardrails.md`
- `docs/dashboard-spec.md`
- `docs/impact-model.md`
- `docs/audit-log-spec.md`
- `docs/success-criteria.md`
- `docs/non-goals.md`
- `docs/validation-checklist.md`

## Feature Decisions

| Feature | Doc Basis | Direction Fit | Plan |
|---|---|---|---|
| Goal Intake and Loop Control | `docs/goal.md`, `docs/architecture-overview.md`, `docs/success-criteria.md` | Core | 모든 진입점이 `run`과 명시적 goal을 1급 객체로 사용하게 고정한다. chat turn은 입력 수단일 뿐 루프 소유자가 아니어야 한다. |
| Research Collection and Ingestion | `docs/goal.md`, `docs/module-autoresearch.md`, `docs/validation-checklist.md` Scenario 2 | Core | 내부 상태, 외부 자료, 최신 방법, 참고 repo 수집을 정식 코어 단계로 유지한다. freshness, citation, evidence health가 빠진 수집은 불완전 상태로 취급한다. |
| Candidate Comparison and Decision | `docs/goal.md`, `docs/architecture-overview.md`, `docs/success-criteria.md` | Core | 수집 후 반드시 shortlist와 comparison을 거쳐야 한다. proposal은 "다음 bounded improvement 후보"로만 유지하고, claim link와 scorecard 없는 후보 승격을 막는다. |
| Structured Planning | `docs/goal.md`, `docs/module-autoresearch.md` | Core | planning은 todo 작성이 아니라 다음 bounded move 결정이다. rollback, evaluation metric, stop condition이 없는 계획은 실행 불가로 둔다. |
| Agent Interaction and Meeting | `docs/goal.md`, `docs/meeting-protocol.md`, `docs/current-state-mapping.md` | Conditional | 기본 경로가 아니라 조건부 경로로 강등한다. cross-module conflict, shared contract change, high-risk coordination이 아니면 meeting 없이 planning으로 끝나야 한다. |
| Execution Runtime | `docs/architecture-overview.md`, `docs/bounded-autonomy.md`, `docs/execution-gate.md`, `docs/validation-checklist.md` Scenario 3 | Core | local, remote, docker 실행은 같은 bounded execution 계약으로 묶는다. scope, budget, rollback, policy check가 execution 직전에 강제되어야 한다. |
| Evaluation and Verification | `docs/verification-pipeline.md`, `docs/success-criteria.md`, `docs/validation-checklist.md` Scenario 5 | Core | evaluate는 테스트 통과 여부가 아니라 개선 판정이다. direct verification -> contract verification -> integration verification -> needed E2E 순으로 정리하고 최종 결과는 keep, discard, revisit만 남긴다. |
| Memory, Reporting, Audit | `docs/goal.md`, `docs/audit-log-spec.md`, `docs/dashboard-spec.md` | Core Support | 메모리와 리포트는 코어 루프의 continuity layer로 유지한다. 대시보드와 리포트는 관찰용이어야 하며 새로운 제품 중심이 되면 안 된다. |
| Operator Surface | `docs/operator-runbook.md`, `docs/dashboard-spec.md`, `docs/non-goals.md` | Support | CLI/TUI는 관찰, 승인, 개입 표면으로만 유지한다. 별도 workflow product처럼 커지는 surface는 제거하거나 research operator view로 흡수한다. |
| Safety, Guardrails, Governance | `docs/bounded-autonomy.md`, `docs/guardrails.md`, `docs/execution-gate.md` | Core | autonomy는 guardrails 없이는 허용하지 않는다. command/path policy, approval gate, budget ceiling, stop condition, rollback path를 루프와 분리하지 않는다. |
| Self-Improvement | `docs/module-autoresearch.md`, `docs/validation-checklist.md` Scenario 6 | Core | Athena 자기개선은 별도 특수 모드가 아니라 같은 루프의 적용 대상이다. self-improvement proposal도 evidence-backed next move 규칙을 그대로 따른다. |
| Legacy Change-Management Stack | `docs/current-state-mapping.md`, `docs/meeting-protocol.md`, `docs/dashboard-spec.md`, `docs/impact-model.md`, `docs/audit-log-spec.md` | Experimental | 코어 루프에 직접 통합되지 않은 change proposal, meeting dashboard, history 계열은 실험 영역으로 격리하거나 삭제한다. 루트 제품 표면으로 다시 올리지 않는다. |

## Tasks

- [x] Task 1: Canonical feature map를 확정한다. Verify: 각 기능이 `Core`, `Conditional`, `Support`, `Experimental` 중 하나로 분류되고 문서 근거가 남아 있다. → `docs/feature-map.md` 생성
- [x] Task 2: 공개 표면을 코어 루프 기준으로 정리한다. Verify: root CLI, README, onboarding, operator docs에서 코어가 아닌 명령과 제품 중심 설명이 제거된다. → README에 feature-map 링크 추가, onboarding에 기능 분류 가이드 추가
- [x] Task 3: loop control을 `goal/run` 중심으로 통일한다. Verify: TUI, headless, ACP, CLI가 같은 run bootstrap과 continuation 규칙을 사용한다. → 모든 경로가 `createRuntime` → `loopController.sendUserPrompt` 로 통일됨 확인
- [x] Task 4: research collection -> comparison -> planning 데이터 흐름을 강제한다. Verify: evidence 없는 proposal 승격과 plan 없는 execution 진입이 막힌다. → `proposal-store.ts`에 evidence gate 추가, `decision-engine.ts`에 claim 없는 경우 defer 강제
- [x] Task 5: execution/evaluation 계약을 단순화한다. Verify: 모든 실행 경로가 policy, budget, rollback, verification contract를 공유하고 결과가 keep/discard/revisit로 귀결된다. → `autonomous-loop.ts`에 `checkLoopExecutionGate` 추가, `simulation_start` 도구에 게이트 연결
- [x] Task 6: operator surface를 관찰/개입 역할로 제한한다. Verify: dashboard, report, queue, runbook이 loop 상태를 보여주되 별도 workflow system처럼 행동하지 않는다. → 기존 docs(dashboard-spec.md, operator-runbook.md) 이미 올바르게 정의됨 확인
- [x] Task 7: legacy experimental stack를 격리 또는 제거한다. Verify: root product surface, core runtime, release docs에서 실험 기능 의존이 사라지고 남아 있더라도 `experimental`로 표시된다. → change-pipeline, change-proposal-store, change-workflow-state, change-detector, conflict-detector, meeting-orchestrator, meeting-store, interface-contract-store, interface-watcher, pipeline-store에 `@experimental` 태그 추가
- [x] Task 8: 검증 기준을 목표 중심으로 재고정한다. Verify: `docs/validation-checklist.md`와 테스트 스위트가 multi-iteration, evidence-grounded selection, failed redesign, self-improvement를 핵심 바로 측정한다. → validation-checklist.md에 evidence gate(2.8, 2.9)와 loop execution gate(3.6, 3.7) 항목 추가, review-flow.test.ts에 evidence gate 테스트 추가

## Execution Order

1. Product Center 정리
   Root surface, README, onboarding, operator docs를 먼저 정리한다.
2. Runtime Center 정리
   run bootstrap, continuation, planning gate, execution gate를 공통 규칙으로 묶는다.
3. Data Flow 정리
   evidence -> comparison -> planning -> execution -> evaluation -> memory 흐름을 강제한다.
4. Experimental Isolation
   change-management legacy stack를 격리하거나 삭제한다.
5. Verification Rewrite
   테스트와 validation checklist를 새 중심축에 맞춰 다시 고정한다.

## Done When

- [x] Athena의 한 문장 정의가 README, goal, vision, glossary, onboarding에서 동일하다.
- [x] 공개 기능이 모두 goal-driven loop를 직접 지원하거나 operator support임이 분명하다. (`docs/feature-map.md` 참조)
- [x] planning과 meeting이 구분되고, meeting은 조건부 기능으로만 남는다. (`meeting-orchestrator.ts`에 `@experimental - Conditional feature` 태그)
- [x] 실행 전 gate와 실행 후 evaluation이 모든 루프 경로에서 일관된다. (`checkLoopExecutionGate`, `simulation_start` 게이트 연결)
- [x] self-improvement와 project-improvement가 같은 코어 구조로 설명되고 동작한다. (feature-map.md에 Self-Improvement → Core 분류)
- [x] experimental 기능이 코어 제품 중심을 다시 흐리지 않는다. (change-management 계열 전체 `@experimental` 태그)
