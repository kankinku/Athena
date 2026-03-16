# Feature Map

이 문서는 Athena의 모든 기능을 `Core`, `Conditional`, `Support`, `Experimental` 중 하나로 분류하고 문서 근거를 남긴다.

분류 기준은 `docs/goal.md`의 Decision Rule을 따른다:

> If a proposed feature does not improve at least one of these, it is not core:
> goal alignment, evidence quality, bounded execution, evaluation quality

---

## Core — 코어 루프 직접 구현

이 기능들은 `goal → collect → compare → plan → execute → evaluate → keep/discard/revisit → repeat` 루프를 직접 구성한다.
없으면 루프 자체가 성립하지 않는다.

| 기능 | 구성 파일 | 문서 근거 |
|------|----------|---------|
| **Goal Intake & Loop Control** | `core/orchestrator.ts`, `research/team-orchestrator.ts`, `research/runtime-loop-controller.ts`, `research/autonomous-loop.ts`, `research/workflow-state.ts` | `docs/goal.md`, `docs/architecture-overview.md`, `docs/success-criteria.md` |
| **Research Collection & Ingestion** | `research/ingestion-service.ts`, `research/ingestion-store.ts`, `research/source-adapters/` | `docs/goal.md`, `docs/module-autoresearch.md`, `docs/validation-checklist.md` Scenario 2 |
| **Claim Extraction & Evidence Graph** | `research/claim-graph.ts`, `research/ingestion.ts` | `docs/goal.md`, `docs/validation-checklist.md` Scenario 2 |
| **Candidate Comparison & Scoring** | `research/decision-engine.ts`, `research/proposal-store.ts` | `docs/goal.md`, `docs/architecture-overview.md`, `docs/success-criteria.md` |
| **Structured Planning** | `research/team-orchestrator.ts`, `research/improvement-engine.ts` | `docs/goal.md`, `docs/module-autoresearch.md` |
| **Execution Runtime** | `remote/executor.ts`, `remote/connection-pool.ts`, `remote/docker-runtime.ts`, `research/simulation-runner.ts` | `docs/architecture-overview.md`, `docs/bounded-autonomy.md`, `docs/execution-gate.md`, `docs/validation-checklist.md` Scenario 3 |
| **Evaluation & Verification** | `research/verification-pipeline.ts`, `research/decision-store.ts`, `research/simulation-store.ts` | `docs/verification-pipeline.md`, `docs/success-criteria.md`, `docs/validation-checklist.md` Scenario 5 |
| **Memory & Continuity** | `memory/graph-memory.ts`, `research/team-store.ts`, `research/workflow-store.ts` | `docs/goal.md`, `docs/audit-log-spec.md` |
| **Safety & Guardrails** | `security/policy.ts`, `security/audit-store.ts`, `research/execution-gate.ts`, `research/budget-enforcer.ts` | `docs/bounded-autonomy.md`, `docs/guardrails.md`, `docs/execution-gate.md` |
| **Self-Improvement** | `research/improvement-engine.ts`, `research/improvement-store.ts`, `research/improvement-policy.ts`, `research/module-autoresearch.ts` | `docs/module-autoresearch.md`, `docs/validation-checklist.md` Scenario 6 |
| **Automation Policy & Recovery** | `research/automation-manager.ts`, `research/automation-store.ts`, `research/automation-safety.ts`, `research/recovery.ts` | `docs/bounded-autonomy.md`, `docs/operator-runbook.md` |

---

## Conditional — 조건부 경로

이 기능들은 코어 루프의 특정 조건(cross-module 충돌, 고위험 조정, shared contract 변경)에서만 필요하다.
없어도 대부분의 루프는 동작한다.

| 기능 | 구성 파일 | 조건 | 문서 근거 |
|------|----------|-----|---------|
| **Agent Meeting & Deliberation** | `research/meeting-orchestrator.ts`, `research/meeting-store.ts` | cross-module conflict, shared contract change, high-risk coordination 시에만 | `docs/goal.md`, `docs/meeting-protocol.md` |
| **Conflict Detection** | `research/conflict-detector.ts` | multi-agent coordination 필요 시 | `docs/meeting-protocol.md` |
| **Interface Watching** | `research/interface-watcher.ts`, `research/interface-contract-store.ts` | contract 변경 감지가 필요한 환경에서만 | `docs/architecture-overview.md` |

---

## Support — 관찰 및 운영자 지원

이 기능들은 코어 루프를 직접 구성하지 않지만, 루프를 관찰하고 개입하기 위해 필요하다.
별도 workflow system처럼 커지거나 루프 중심을 대체해서는 안 된다.

| 기능 | 구성 파일 | 문서 근거 |
|------|----------|---------|
| **CLI Operator Surface** | `cli/index.ts`, `cli/run.ts`, `cli/research.ts`, `cli/report.ts` | `docs/operator-runbook.md`, `docs/non-goals.md` |
| **TUI** | `ui/`, `app.tsx` — Research Status Panel, Research Detail Panel, Metrics Dashboard, Task List | `docs/dashboard-spec.md` |
| **Reporting** | `research/reporting.ts` | `docs/audit-log-spec.md`, `docs/dashboard-spec.md` |
| **Audit & Incident Log** | `research/audit-event-store.ts`, `research/incident-store.ts`, `research/action-journal-store.ts` | `docs/audit-log-spec.md` |
| **Metrics** | `metrics/store.ts`, `metrics/collector.ts`, `tools/show-metrics.ts`, `tools/compare-runs.ts` | `docs/architecture-overview.md` |
| **Session & Auth** | `cli/auth.ts`, `store/session-store.ts` | onboarding, runtime requirement |
| **Hub Integration** | `hub/client.ts`, `tools/hub.ts` | `docs/architecture-overview.md` |

---

## Experimental — 실험 영역

이 기능들은 현재 코어 루프에 직접 통합되지 않은 change-management 계열이다.
루트 제품 표면으로 올라와서는 안 되며, `experimental` 경계 안에서만 동작한다.
향후 코어 루프와 결합될 때만 Core로 승격될 수 있다.

| 기능 | 구성 파일 | 상태 | 문서 근거 |
|------|----------|------|---------|
| **Change Pipeline (12-plane orchestrator)** | `research/change-pipeline.ts` | Experimental — 코어 루프와 통합 안 됨 | `docs/current-state-mapping.md` |
| **Change Proposal Store** | `research/change-proposal-store.ts` | Experimental | `docs/current-state-mapping.md` |
| **Change Workflow State** | `research/change-workflow-state.ts` | Experimental | `docs/current-state-mapping.md` |
| **Change Detector** | `research/change-detector.ts` | Experimental | `docs/current-state-mapping.md` |
| **Pipeline Store** | `research/pipeline-store.ts` | Experimental | `docs/current-state-mapping.md` |
| **Impact Analysis** | `impact/` | Experimental — change-management에서 참조 | `docs/current-state-mapping.md` |
| **Git Integration (change-triggered)** | `research/git-integration.ts` | Experimental | `docs/current-state-mapping.md` |

---

## Classification Rules

- **Core**: 코어 루프 6단계(collect, compare, plan, execute, evaluate, repeat)를 직접 구성.
- **Conditional**: 코어 루프의 특정 조건 경로에서만 필요.
- **Support**: 루프 관찰, 운영자 개입, 지속성에 필요하지만 루프를 직접 구성하지 않음.
- **Experimental**: 현재 코어 루프와 직접 통합되지 않는 legacy 또는 미완성 서브시스템.

기능을 Experimental에서 Support나 Core로 승격하려면 `docs/goal.md`의 Decision Rule을 통과해야 한다.
