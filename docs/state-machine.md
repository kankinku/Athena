# 상태 머신 (State Machine)

이 문서는 change proposal 생명주기의 상태 전환 규칙과 DB 마이그레이션 전략을 정의한다.

---

## 8.1 새 워크플로 상태 (ChangeWorkflowState)

```
draft
  │
  ▼ (ImpactAnalyzer 실행)
impact-analyzed
  │
  ▼ (AgentSummoner 실행)
agents-summoned
  │
  ▼ (MeetingSession 시작)
in-meeting
  │
  ├──▶ agreed ──▶ executing ──▶ verifying ──▶ completed
  │                                  │
  │                                  └──▶ remeeting ──▶ in-meeting (재개)
  │
  ├──▶ on-hold  (보류)
  └──▶ rejected (거절)
  
어느 상태에서든:
  └──▶ failed   (오류/타임아웃)
```

### 상태 전환 규칙

```typescript
// src/research/workflow-state.ts에 추가 예정
const VALID_CHANGE_WORKFLOW_TRANSITIONS: Record<ChangeWorkflowState, ChangeWorkflowState[]> = {
  draft:            ["impact-analyzed", "failed"],
  "impact-analyzed": ["agents-summoned", "draft", "failed"],
  "agents-summoned": ["in-meeting", "failed"],
  "in-meeting":     ["agreed", "on-hold", "rejected", "failed"],
  agreed:           ["executing", "on-hold", "failed"],
  executing:        ["verifying", "failed"],
  verifying:        ["completed", "remeeting", "failed"],
  completed:        [],
  remeeting:        ["in-meeting", "on-hold", "failed"],
  "on-hold":        ["draft", "in-meeting", "rejected", "failed"],
  rejected:         [],
  failed:           ["draft"],
};
```

---

## 8.2 기존 타입 확장 (contracts.ts)

다음 타입들이 `src/research/contracts.ts`에 추가되었다 (기존 타입은 변경 없음):

| 신규 타입 | 역할 |
|-----------|------|
| `ChangeWorkflowState` | change proposal 생명주기 상태 (12개) |
| `ChangeProposalStatus` | change proposal 세부 상태 (15개) |
| `MeetingState` | 회의 세션 상태 (10개) |
| `ConsensusType` | 합의 유형 (6개) |
| `AgentVote` | 에이전트 투표 값 (6개) |
| `AgentPositionStance` | 에이전트 입장 (4개) |
| `ConflictType` | 충돌 유형 (6개) |
| `AgentPositionRecord` | 에이전트 발언 기록 |
| `ConflictPoint` | 충돌 포인트 |
| `ApprovalConditionRecord` | 조건부 승인 조건 |
| `MeetingSessionRecord` | 에이전트 회의 세션 전체 |
| `ExecutionPlanRecord` | 합의 기반 실행 계획 |
| `VerificationResult` | 검증 결과 |
| `AffectedModuleRecord` | 영향받는 모듈 |

---

## 8.3 신규 DB 객체 (Migration v20)

### 새 컬럼 (proposal_briefs 테이블 확장)

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `change_workflow_state` | TEXT | ChangeWorkflowState 값 (기본: 'draft') |
| `changed_paths_json` | TEXT | 변경 파일 경로 JSON 배열 |
| `directly_affected_modules_json` | TEXT | 직접 영향 모듈 JSON |
| `indirectly_affected_modules_json` | TEXT | 간접 영향 모듈 JSON |
| `observer_modules_json` | TEXT | 참관 모듈 JSON |
| `required_agents_json` | TEXT | 필수 참석 에이전트 JSON 배열 |
| `meeting_required` | INTEGER | 회의 필요 여부 (0/1) |
| `meeting_session_id` | TEXT | 연결된 회의 세션 ID |
| `execution_plan_id` | TEXT | 연결된 실행 계획 ID |
| `required_tests_json` | TEXT | 필수 테스트 JSON |
| `rollback_conditions_json` | TEXT | 롤백 조건 JSON |
| `feature_flag_required` | INTEGER | 피처 플래그 필요 여부 |
| `created_by` | TEXT | 생성자 (기본: 'user') |

### 새 테이블

| 테이블 | 목적 |
|--------|------|
| `meeting_sessions` | 에이전트 회의 세션 기록 |
| `agent_positions` | 회의에서 에이전트별 발언/입장 기록 |
| `approval_conditions` | 조건부 승인의 조건 항목 |
| `execution_plans` | 합의에서 생성된 실행 계획 |
| `verification_results` | 검증 결과와 재협의 트리거 연결 |
| `module_impact_records` | ImpactAnalyzer 결과 캐시 |

---

## 8.4 CLI 커맨드 재정의

기존 커맨드와 새 커맨드의 대응:

### 재정의된 기존 커맨드

```bash
# 기존: research runs → 새: change proposals 목록
athena research runs
# 출력 컬럼 변경: stage → change_workflow_state, status → proposal_status

# 기존: research proposals → 새: change proposal 상세
athena research proposals [--state <state>]

# 기존: research decisions → 새: consensus results
athena research decisions [id]
```

### 신규 커맨드

```bash
# Change proposal 생성
athena proposal create --title "..." --paths "src/..." [--summary "..."]

# 영향도 분석
athena impact analyze --paths "src/store/migrations.ts,src/research/contracts.ts"

# 회의 상태 조회
athena meeting status <proposal-id>
athena meeting transcript <meeting-id>

# 에이전트 수동 소집
athena agent summon <proposal-id> [--agent <agent-id>]

# 운영자 승인
athena agree <proposal-id>          # 합의 최종 승인
athena execute <proposal-id>         # 실행 시작
athena verify <proposal-id>          # 검증 실행
athena rollback <proposal-id>        # 롤백
```

---

## 8.5 리포트 생성기 수정

`src/research/reporting.ts`는 이제 다음 회의 아티팩트를 포함할 수 있어야 한다:

```typescript
// 리포트 섹션 추가
interface ChangeManagementReport {
  // 기존
  runId: string;
  sessionId: string;

  // 신규
  changeProposals: ProposalBrief[];
  meetingSessions: MeetingSessionRecord[];
  executionPlans: ExecutionPlanRecord[];
  verificationResults: VerificationResult[];
  impactSummary: string;
}
```

---

## 8.6 마이그레이션 호환성

### 기존 데이터 보존

- 기존 `proposal_briefs` 레코드는 모두 `change_workflow_state = 'draft'`로 설정됨
- 기존 `team_runs` 레코드의 `workflow_state`는 변경 없음
- 기존 `decision_records`는 그대로 유지

### 신규 필드 기본값

- `change_workflow_state`: `'draft'`
- `meeting_required`: `0`
- `feature_flag_required`: `0`
- `created_by`: `'user'`

### 상태 전환 호환성

기존 `ResearchWorkflowState` 상태 머신은 ML 연구 워크플로에서 계속 사용된다.
새 `ChangeWorkflowState`는 change management 워크플로에서 사용된다.
두 시스템이 `proposal_briefs` 테이블을 공유하므로:
- ML 연구 proposal: `payload_json`에 기존 데이터, `change_workflow_state = 'draft'`
- Change proposal: 새 필드 사용, `workflow_state`는 선택적

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-03-15 | 초안 작성. Migration v20 추가. 신규 타입 contracts.ts에 추가 |
