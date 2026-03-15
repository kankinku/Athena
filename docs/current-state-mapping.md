# 현재 상태 매핑 (Current State Mapping)

이 문서는 기존 Athena (v0.3 ML 연구 에이전트)의 기능과 구조를 새 목표(모듈 협의 시스템)에 어떻게 대응시키는지 정의한다.

---

## 1. 핵심 객체 재정의

| 기존 객체 | 기존 의미 | 새 의미 | 변경 수준 |
|-----------|-----------|---------|-----------|
| `proposal` (`ProposalBrief`) | ML 실험 개선 제안 | **change proposal** — 코드베이스에 적용할 변경 요청 | 확장 필요 |
| `claim` (`CanonicalClaim`) | 연구 근거 주장 | **impact claim** — 모듈이 변경 영향을 받는다는 주장 | 확장 필요 |
| `decision` (`DecisionRecord`) | 실험 채택/거절 결정 | **consensus result** — 에이전트 회의의 합의 결과 | 확장 필요 |
| `revisit` (`ReconsiderationTrigger`) | 새 증거에 의한 재검토 | **re-meeting trigger** — 검증 실패에 의한 재협의 조건 | 의미 유지 + 확장 |
| `report` (reporting.ts) | 실험 결과 리포트 | **meeting/execution report** — 협의 과정 + 실행 결과 | 구조 변경 필요 |
| `TeamRunRecord` | 연구 실행 단위 | **proposal lifecycle record** — change proposal의 전체 생명주기 | 확장 필요 |
| `ImprovementProposalRecord` | 시스템 자기개선 제안 | **module autoresearch record** — 모듈별 자율 개선 기록 | 의미 확장 |

---

## 2. 재사용 가능한 컴포넌트 vs. 수정 필요 컴포넌트

### 재사용 가능 (변경 없음)

| 컴포넌트 | 위치 | 재사용 이유 |
|----------|------|-------------|
| SQLite 퍼시스턴스 레이어 | `src/store/database.ts` | DB 접근 패턴 동일 |
| Migration 시스템 | `src/store/migrations.ts` | 추가 마이그레이션으로 확장 가능 |
| Effect 기반 CLI 프레임워크 | `src/cli/index.ts` | 새 커맨드 추가만 필요 |
| Ink/React TUI 인프라 | `src/ui/layout.tsx` | 새 패널 추가만 필요 |
| 보안 정책 레이어 | `src/security/policy.ts` | 실행 게이트에 직접 활용 |
| 액션 저널 | `src/research/action-journal-store.ts` | 감사 로그로 재활용 |
| 리스 시스템 | `src/research/run-lease-store.ts` | 실행 중인 회의 잠금에 활용 |
| 워크플로 전환 기록 | `src/research/workflow-store.ts` | 상태 전환 히스토리 재활용 |

### 수정 필요 (의미 또는 필드 확장)

| 컴포넌트 | 위치 | 수정 내용 |
|----------|------|-----------|
| `ProposalBrief` 타입 | `src/research/contracts.ts` | `changed_paths`, `directly_affected_modules`, `required_agents` 필드 추가 |
| `DecisionRecord` 타입 | `src/research/contracts.ts` | `meeting_session_id`, `agent_positions`, `consensus_type` 필드 추가 |
| `ResearchWorkflowState` | `src/research/contracts.ts` | 새 상태로 교체 (아래 참조) |
| `proposal-store.ts` | `src/research/proposal-store.ts` | 새 필드 저장/조회 지원 |
| `decision-engine.ts` | `src/research/decision-engine.ts` | 합의 판단 로직으로 대체 |
| `reporting.ts` | `src/research/reporting.ts` | 회의 아티팩트 포함하도록 수정 |
| `athena research` CLI | `src/cli/research.ts` | 새 커맨드 추가 (meeting, summon, agree 등) |
| `research-status.tsx` | `src/ui/panels/research-status.tsx` | 회의 상태, 소집된 에이전트 표시 |

### 신규 구축 필요

| 컴포넌트 | 위치 | 설명 |
|----------|------|------|
| 모듈 레지스트리 | `config/module-registry.yaml` | 모듈-에이전트 소유권 정의 |
| 영향도 그래프 | `src/impact/graph-builder.ts` | 모듈 의존성 그래프 구축 |
| 영향도 분석기 | `src/impact/impact-analyzer.ts` | 변경 파일 → 영향 모듈 계산 |
| 회의 세션 객체 | `src/research/contracts.ts` | `MeetingSession`, `AgentPosition`, `ApprovalCondition` |
| 회의 저장소 | `src/research/meeting-store.ts` | 회의 기록 CRUD |
| 실행 게이트 | `src/research/execution-gate.ts` | 합의 → 실행 변환 + 게이트 검사 |
| 재협의 트리거 | `src/research/remeeting-trigger.ts` | 테스트 실패 → 재협의 연결 |

---

## 3. 새 워크플로 상태

기존 상태와 새 상태의 대응:

```
기존:
draft → ready → approved → running → evaluating → reported
                                          ↘ revisit_due
                                          ↘ failed

새:
draft → impact-analyzed → agents-summoned → in-meeting → agreed → executing → verifying → completed
                                                              ↘ remeeting ←── (검증 실패)
                                                              ↘ on-hold  (합의 불가)
                                                              ↘ rejected (거절)
                                          ↘ failed (에이전트 미응답/오류)
```

### 상태별 의미

| 상태 | 의미 | 이전 대응 |
|------|------|-----------|
| `draft` | change proposal 작성 중 | `draft` (동일) |
| `impact-analyzed` | 영향 모듈 분석 완료 | `ready` (유사) |
| `agents-summoned` | 관련 에이전트 소집됨 | (신규) |
| `in-meeting` | 에이전트 회의 진행 중 | (신규) |
| `agreed` | 합의 도달, 실행 계획 확정 | `approved` (유사) |
| `executing` | 모듈 오너들이 실행 중 | `running` (유사) |
| `verifying` | 통합 테스트 검증 중 | `evaluating` (유사) |
| `completed` | 변경 완료 + 검증 통과 | `reported` (유사) |
| `remeeting` | 검증 실패로 재협의 | `revisit_due` (유사) |
| `on-hold` | 합의 불가로 보류 | (신규) |
| `rejected` | 거절됨 | (신규) |
| `failed` | 오류/타임아웃 | `failed` (동일) |

---

## 4. DB 재사용 전략

### 기존 테이블 재활용

| 테이블 | 재사용 방식 |
|--------|-------------|
| `team_runs` | change proposal lifecycle 레코드로 재활용. `workflow_state` 컬럼이 이미 있음 |
| `proposal_briefs` | change proposal로 재활용. 새 필드 추가 마이그레이션 필요 |
| `decision_records` | consensus result로 재활용. `meeting_session_id` 필드 추가 필요 |
| `reconsideration_triggers` | re-meeting trigger로 재활용. 의미 그대로 사용 가능 |
| `workflow_transitions` | 상태 전환 히스토리 그대로 재사용 |
| `research_action_journal` | 실행 감사 로그로 재사용 |
| `research_incidents` | 실행 중 인시던트 기록으로 재사용 |

### 신규 테이블 필요

| 테이블 | 목적 |
|--------|------|
| `meeting_sessions` | 에이전트 회의 세션 기록 |
| `agent_positions` | 회의에서 에이전트별 발언/입장 기록 |
| `approval_conditions` | 조건부 승인의 조건 항목 |
| `module_impact_records` | 변경별 영향 모듈 분석 결과 캐시 |
| `execution_plans` | 합의에서 생성된 실행 계획 |
| `verification_results` | 검증 결과와 재협의 트리거 연결 |

---

## 5. CLI 커맨드 재정의

### 재사용 커맨드

| 기존 커맨드 | 새 의미 | 변경 필요 |
|-------------|---------|-----------|
| `athena research runs` | change proposal 목록 | 컬럼명 변경 |
| `athena research proposals` | change proposal 상세 | 새 필드 추가 |
| `athena research decisions` | consensus result 조회 | 새 필드 추가 |
| `athena research next-actions` | 다음 운영자 액션 | 내용 변경 |
| `athena report` | 협의/실행 리포트 | 구조 변경 |

### 신규 커맨드 (추가 필요)

| 커맨드 | 기능 |
|--------|------|
| `athena proposal create` | 새 change proposal 생성 |
| `athena impact analyze --paths <...>` | 변경 파일 → 영향 모듈 분석 |
| `athena meeting status <proposal-id>` | 회의 진행 상태 조회 |
| `athena meeting transcript <meeting-id>` | 회의 전문 조회 |
| `athena agent summon <proposal-id>` | 에이전트 수동 소집 |
| `athena agree <proposal-id>` | 운영자 최종 승인 |
| `athena execute <proposal-id>` | 실행 시작 |
| `athena verify <proposal-id>` | 검증 실행 |

---

## 6. 유지할 기능 vs. 제거할 기능

### 유지

- SQLite 퍼시스턴스 + migration 시스템
- Effect 기반 CLI 프레임워크
- Ink/React TUI + 패널 구조
- 보안 정책 레이어 (`src/security/policy.ts`)
- 자동화 정책 (`AutomationPolicy`) 구조
- 액션 저널 + 리스 시스템 (감사 로그용)
- 원격 실행 인프라 (`src/remote/`)

### 제거/대체

- `decision-engine.ts`의 ML 스코어링 로직 → 에이전트 발언 기반 합의 판단으로 대체
- `simulation-runner.ts`의 실험 실행 로직 → 실행 게이트 + 모듈별 autoresearch로 대체
- `ingestion-service.ts`의 논문 수집 로직 → 코드 변경 영향도 분석으로 대체
- `team-orchestrator.ts`의 ML 팀 오케스트레이션 → 에이전트 회의 오케스트레이터로 대체

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-03-15 | 초안 작성 |
