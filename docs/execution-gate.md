# 실행 게이트 (Execution Gate)

이 문서는 에이전트 회의 합의 결과를 실행 계획으로 변환하는 스키마, 자동 실행 조건, 사람 승인 필수 조건, 실행 전 검증 단계를 정의한다.

---

## 9.1 실행 계획 스키마 (approved_plan)

회의 합의가 도달하면 다음 구조의 실행 계획이 자동 생성된다:

```typescript
interface ApprovedPlan {
  // 식별
  executionPlanId: string;        // "plan_" 접두사
  proposalId: string;
  meetingId: string;
  consensusType: ConsensusType;

  // 작업 분배
  taskAssignments: TaskAssignment[];  // 각 에이전트가 무엇을 할지

  // 검증
  requiredTests: RequiredTest[];      // 반드시 통과해야 하는 테스트

  // 안전장치
  rollbackPlan: string;               // 문제 발생 시 되돌리는 방법
  featureFlags: FeatureFlagConfig[];  // 피처 플래그 목록

  // 실행 예산
  executionBudget: ExecutionBudget;

  // 승인 조건 (conditionally-approved인 경우)
  approvalConditions?: ApprovalConditionRecord[];

  // 분할 실행 순서 (split-execution인 경우)
  executionPhases?: ExecutionPhase[];
}

interface TaskAssignment {
  agentId: string;
  moduleId: string;
  tasks: string[];                // 수행할 작업 목록
  dependsOnAgents: string[];      // 이전에 완료해야 하는 에이전트 작업
  allowedPaths: string[];         // 수정 가능한 파일 경로 (glob)
  estimatedMinutes: number;
}

interface ExecutionBudget {
  maxWallClockMinutes: number;    // 전체 실행 시간 제한
  maxRetryCount: number;          // 단계별 최대 재시도 수
  maxConcurrentAgents: number;    // 동시 실행 에이전트 수 제한
}

interface ExecutionPhase {
  phaseId: string;
  phaseNumber: number;
  assignments: TaskAssignment[];
  trigger: "immediate" | "on-previous-complete" | "operator-approval";
}
```

---

## 9.2 자동 실행 가능 조건

다음 조건을 모두 충족하면 사람 승인 없이 자동 실행 가능하다:

| 조건 | 요구사항 |
|------|----------|
| 합의 유형 | `approved` (전원 동의) |
| 영향 모듈 위험도 | 모두 `low` 또는 `medium` |
| 변경 범위 | `allowedPaths` 내에만 수정 |
| 공용 인터페이스 | 변경 없음 |
| DB 스키마 | 변경 없음 |
| 보안 파일 | 변경 없음 |
| 검증 테스트 | 모두 지정됨 |
| 롤백 계획 | 존재함 |
| 자동화 정책 | `supervised-auto` 또는 `overnight-auto` |

```typescript
function canAutoExecute(plan: ApprovedPlan, policy: AutomationPolicy): boolean {
  if (policy.mode === "manual" || policy.mode === "assisted") return false;
  if (plan.consensusType !== "approved") return false;
  if (plan.approvalConditions && plan.approvalConditions.length > 0) return false;

  // 위험도 확인
  const highRiskAssignments = plan.taskAssignments.filter(
    (t) => isHighRiskModule(t.moduleId)
  );
  if (highRiskAssignments.length > 0) return false;

  return plan.rollbackPlan.length > 0;
}
```

---

## 9.3 사람 승인 필수 조건

다음 중 하나라도 해당하면 반드시 운영자 승인이 필요하다:

### 코드 변경 기준

| 변경 유형 | 승인 필요 이유 |
|-----------|--------------|
| 공용 인터페이스 변경 (`contracts.ts`, `index.ts`) | 광범위한 영향, 하위 호환성 위험 |
| DB 스키마 변경 (`migrations.ts`) | 데이터 손실 위험, 롤백 어려움 |
| 보안 민감 파일 (`src/security/**`, `~/.athena/auth/**`) | 보안 위험 |
| 배포 파이프라인 영향 (`.github/**`, `package.json`) | 릴리즈 영향 |
| `critical` 위험도 모듈 포함 | 높은 위험도 |

### 프로세스 기준

| 상황 | 승인 필요 이유 |
|------|--------------|
| 합의 유형 `conditionally-approved` | 조건 달성 확인 필요 |
| 합의 유형 `split-execution` | 단계 전환 시 검토 필요 |
| 재협의 후 실행 (`remeeting` → `agreed`) | 재검토 필요 |
| 실행 예산 초과 예상 | 리소스 결정 필요 |

---

## 9.4 실행 전 검증 단계

실행 시작 전 다음 단계를 순서대로 수행한다:

### Step 1: 대상 모듈 잠금 (Lock)

```
- 실행 대상 모듈에 대한 다른 proposal 실행 차단
- 동시 실행 충돌 방지
- 잠금 실패 시 → 실행 보류, 기존 실행 완료 대기
```

### Step 2: 수정 범위 확인 (Scope Verification)

```
- plan.taskAssignments의 allowedPaths 재확인
- 각 에이전트가 자신의 모듈 범위 내에서만 수정하는지 확인
- 범위 초과 시도 감지 시 → 실행 중단
```

### Step 3: 테스트 계획 확인 (Test Plan Verification)

```
- requiredTests 목록 존재 확인
- 각 테스트의 testCommand 실행 가능 여부 확인 (파일 존재, 명령 유효)
- 누락 테스트 → 운영자 알림
```

### Step 4: 충돌 재확인 (Conflict Re-check)

```
- 회의 이후 동일 파일에 대한 다른 proposal 실행 여부 확인
- 충돌 감지 시 → 운영자 판단 요청
```

### Step 5: 롤백 계획 준비 (Rollback Preparation)

```
- git stash 또는 branch 생성
- 현재 상태 스냅샷
- 롤백 커맨드 유효성 확인
```

---

## 9.5 실행 중단과 롤백 절차

### 실행 중단 트리거

```
- 타임아웃 (executionBudget.maxWallClockMinutes 초과)
- 에이전트 오류 (재시도 exhausted)
- 보안 정책 위반
- 운영자 수동 중단 (athena rollback <proposal-id>)
- 테스트 실패 (immediate block 설정 테스트)
```

### 롤백 절차

```
1. 진행 중인 에이전트 작업 즉시 중단 (graceful 후 force kill)
2. rollbackPlan에 정의된 명령 실행:
   - git reset --hard <before-commit>
   - DB migration rollback (해당 시)
   - 환경 변수 복원
3. 모듈 잠금 해제
4. proposal 상태 → "rolled-back"
5. VerificationResult에 실패 기록
6. 운영자에게 롤백 완료 알림
7. remeeting 트리거 (설정에 따라)
```

---

## 관련 문서

- [검증 파이프라인](./verification-pipeline.md)
- [회의 프로토콜](./meeting-protocol.md)
- [안전장치](./guardrails.md)
