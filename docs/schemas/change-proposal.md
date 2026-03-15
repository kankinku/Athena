# Change Proposal 스키마

change proposal은 코드베이스에 적용하려는 변경의 의도, 범위, 영향도, 검증 조건을 담는 핵심 객체다.

---

## 4.1 최소 필드 (Core Identity & Intent)

```typescript
interface ChangeProposal {
  // 식별자
  proposal_id: string;         // nanoid() 생성, "cp_" 접두사
  created_at: number;          // Unix timestamp (ms)
  updated_at: number;
  created_by: string;          // "user" | agent_id | "auto:diff" | "auto:test-failure"

  // 변경 내용
  title: string;               // 한 줄 요약 (max 120자)
  summary: string;             // 변경의 목적과 배경 (Markdown)
  requested_change: string;    // 구체적으로 무엇을 어떻게 변경하는지

  // 변경 범위
  changed_paths: string[];     // 변경될 파일 경로 목록 (glob 허용)
  expected_effect: string;     // 변경 후 예상 동작 변화
  risk_assumptions: string[];  // 작성자가 가정하는 리스크

  // 대상 모듈
  target_modules: string[];    // module_id 목록 (직접 수정 대상)
}
```

---

## 4.2 영향도 및 협의 필요성 필드

```typescript
interface ChangeProposalImpact {
  // 영향도 분류 (ImpactAnalyzer가 자동 계산)
  directly_affected_modules: AffectedModule[];   // 필수 참석
  indirectly_affected_modules: AffectedModule[]; // 조건부 참석
  observer_modules: AffectedModule[];            // 읽기 전용 참여

  // 소집 결정
  required_agents: string[];     // 반드시 참석해야 하는 agent_id 목록
  meeting_required: boolean;     // 회의가 필요한지 여부
  meeting_required_reason?: string; // 회의 불필요 시 사유 ("single-module-internal")

  // 영향 분석 메타
  impact_analyzed_at?: number;
  impact_analyzer_version?: string;
}

interface AffectedModule {
  module_id: string;
  impact_level: "direct" | "indirect" | "observer";
  impact_reason: string;         // 왜 영향을 받는지 설명
  affected_interfaces: string[]; // 영향받는 공용 인터페이스 목록
}
```

---

## 4.3 검증 조건 필드

```typescript
interface ChangeProposalVerification {
  // 실행 후 반드시 통과해야 하는 테스트
  required_tests: RequiredTest[];

  // 계약/인터페이스 검사
  contract_checks: ContractCheck[];

  // 롤백 조건
  rollback_conditions: RollbackCondition[];

  // 피처 플래그
  feature_flag_required: boolean;
  feature_flag_name?: string;
}

interface RequiredTest {
  test_id: string;               // 테스트 식별자
  test_type: "unit" | "integration" | "e2e" | "contract" | "snapshot";
  test_command: string;          // 실행 커맨드 (예: "npm run test:research")
  scope_filter?: string;         // 특정 파일만 실행 (예: "src/store/*.test.ts")
  failure_action: "block" | "warn" | "remeeting";
  owner_module: string;          // 이 테스트를 책임지는 모듈
}

interface ContractCheck {
  check_id: string;
  interface_name: string;        // 검사 대상 인터페이스
  check_type: "type-compatibility" | "schema-version" | "api-contract";
  owner_module: string;
}

interface RollbackCondition {
  condition: string;             // 조건 설명
  trigger_event: "test-failure" | "runtime-error" | "operator-request" | "metric-degradation";
  rollback_target: string;       // 롤백 목표 상태/커밋
  auto_rollback: boolean;
}
```

---

## 4.4 전체 ChangeProposal 타입 정의

```typescript
// src/research/contracts.ts에 추가
export interface ChangeProposal {
  // Core (4.1)
  proposalId: string;
  title: string;
  summary: string;
  requestedChange: string;
  changedPaths: string[];
  expectedEffect: string;
  riskAssumptions: string[];
  targetModules: string[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;

  // Impact (4.2)
  directlyAffectedModules: AffectedModule[];
  indirectlyAffectedModules: AffectedModule[];
  observerModules: AffectedModule[];
  requiredAgents: string[];
  meetingRequired: boolean;
  meetingRequiredReason?: string;
  impactAnalyzedAt?: number;

  // Verification (4.3)
  requiredTests: RequiredTest[];
  contractChecks: ContractCheck[];
  rollbackConditions: RollbackCondition[];
  featureFlagRequired: boolean;
  featureFlagName?: string;

  // Status
  status: ChangeProposalStatus;
  workflowState: ChangeWorkflowState;

  // Links
  meetingSessionId?: string;    // 연결된 회의 세션
  executionPlanId?: string;     // 생성된 실행 계획
  decisionId?: string;          // 최종 합의 결정
}

export type ChangeProposalStatus =
  | "draft"                     // 작성 중
  | "ready"                     // 검토 준비
  | "impact-analyzed"           // 영향도 분석 완료
  | "meeting-scheduled"         // 회의 예약됨
  | "agreed"                    // 합의 완료
  | "conditionally-agreed"      // 조건부 합의
  | "split-execution"           // 분할 실행
  | "on-hold"                   // 보류
  | "rejected"                  // 거절
  | "executing"                 // 실행 중
  | "verifying"                 // 검증 중
  | "completed"                 // 완료
  | "rolled-back"               // 롤백됨
  | "remeeting"                 // 재협의 중
  | "archived";                 // 보관
```

---

## 4.4 생성 경로 (Creation Paths)

| 경로 | 설명 | 자동 채워지는 필드 |
|------|------|-------------------|
| **사용자 입력** | `athena proposal create` 커맨드 | `proposal_id`, `created_at`, `created_by="user"` |
| **코드 diff 자동 생성** | git diff 분석으로 자동 생성 | `changed_paths`, `target_modules`, `impact` |
| **실패한 테스트 기반** | CI 실패 시 자동 제안 | `required_tests`, `rollback_conditions` |
| **모듈 오너 에이전트 제안** | 에이전트가 직접 제안 | 전체 필드 (에이전트가 채움) |

---

## 4.5 DB 스키마 매핑

기존 `proposal_briefs` 테이블을 확장:

```sql
-- Migration v20에 포함 (Task 8)
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
```

---

## 4.6 예시

```json
{
  "proposalId": "cp_x8f2k9m",
  "title": "store 모듈: meeting_sessions 테이블 추가",
  "summary": "에이전트 회의 세션 기록을 위한 새 DB 테이블이 필요하다.",
  "requestedChange": "src/store/migrations.ts에 migration v20을 추가하여 meeting_sessions 테이블을 생성한다.",
  "changedPaths": ["src/store/migrations.ts"],
  "expectedEffect": "meeting_sessions 테이블이 생성되어 회의 기록을 저장할 수 있게 된다.",
  "riskAssumptions": ["기존 마이그레이션과 순서 충돌 없음", "하위 호환 가능"],
  "targetModules": ["store"],
  "directlyAffectedModules": [
    {
      "moduleId": "store",
      "impactLevel": "direct",
      "impactReason": "마이그레이션 파일 직접 수정",
      "affectedInterfaces": ["runMigrations()"]
    }
  ],
  "indirectlyAffectedModules": [
    {
      "moduleId": "research",
      "impactLevel": "indirect",
      "impactReason": "새 테이블을 사용하는 MeetingStore 추가 필요",
      "affectedInterfaces": ["MeetingStore"]
    }
  ],
  "requiredAgents": ["store-agent", "research-agent"],
  "meetingRequired": true,
  "requiredTests": [
    {
      "testId": "migration-upgrade",
      "testType": "integration",
      "testCommand": "npm run test -- src/store/migrations-upgrade.test.ts",
      "failureAction": "block",
      "ownerModule": "store"
    }
  ],
  "rollbackConditions": [
    {
      "condition": "마이그레이션 실패",
      "triggerEvent": "runtime-error",
      "rollbackTarget": "이전 마이그레이션 버전",
      "autoRollback": true
    }
  ],
  "featureFlagRequired": false,
  "status": "impact-analyzed",
  "workflowState": "impact-analyzed"
}
```
