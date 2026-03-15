# 테스트 시나리오 (Test Scenarios)

이 문서는 모듈 협의 시스템의 검증을 위한 5가지 대표 변경 시나리오와 각 시나리오의 기대 결과를 정의한다.

---

## 시나리오 1: 단일 모듈 내부 수정

**변경 내용**: `src/research/proposal-store.ts`에 새 조회 메서드 추가 (내부만 사용)

**변경 파일**: `src/research/proposal-store.ts`

### 기대 결과

| 항목 | 기대값 |
|------|--------|
| 영향도 분석 | 직접: `research` / 간접: 없음 / 참관: 없음 |
| 소집 에이전트 | `research-agent`만 (1명) |
| 회의 필요 | ❌ 불필요 (`single-module-internal`) |
| 자동 실행 | ✅ 가능 (policy가 `supervised-auto` 이상일 때) |
| 운영자 승인 | ❌ 불필요 |
| 필수 테스트 | `src/research/*.test.ts` |
| 재협의 조건 | 단위 테스트 실패 시 |

### 검증 포인트

```bash
# 영향도 분석 확인
athena impact analyze --paths "src/research/proposal-store.ts"
# Expected: Direct: research | Meeting required: false

# 자동 실행 확인
athena proposal create --title "..." --paths "src/research/proposal-store.ts"
# Expected: workflow_state가 'agreed'로 빠르게 전환, 에이전트 1명만 소집
```

---

## 시나리오 2: 공용 인터페이스 변경

**변경 내용**: `src/research/contracts.ts`에 `ProposalBrief` 타입에 새 필드 추가 (선택적 필드)

**변경 파일**: `src/research/contracts.ts`

### 기대 결과

| 항목 | 기대값 |
|------|--------|
| 영향도 분석 | 직접: `research` / 간접: `cli`, `ui` / 참관: 없음 |
| 소집 에이전트 | `research-agent`, `cli-agent`, `ui-agent` (3명) |
| 회의 필요 | ✅ 필요 (공용 인터페이스 변경) |
| 자동 실행 | ❌ 불가 (공용 인터페이스 변경) |
| 운영자 승인 | ✅ 필요 |
| 필수 테스트 | `tsc --noEmit`, `research/*.test.ts`, `cli/*.test.ts` |
| 재협의 조건 | 타입 오류 발생, cli 스냅샷 실패 |

### 검증 포인트

```bash
athena impact analyze --paths "src/research/contracts.ts"
# Expected: Direct: research | Indirect: cli, ui | Meeting required: true
# Expected reason: "공용 인터페이스 변경: research"

# 회의에서 ui-agent가 참관으로만 참여하는지 확인
athena meeting agents <proposal-id>
# Expected: research-agent(mandatory), cli-agent(mandatory), ui-agent(observer)
```

---

## 시나리오 3: DB 스키마 변경

**변경 내용**: `src/store/migrations.ts`에 새 마이그레이션 추가 (새 테이블 생성)

**변경 파일**: `src/store/migrations.ts`

### 기대 결과

| 항목 | 기대값 |
|------|--------|
| 영향도 분석 | 직접: `store` / 간접: `research`, `cli`, `ui`, `remote`, `tools`, `providers`, `security`, `impact` (모두) |
| 소집 에이전트 | `store-agent` (필수) + 영향받는 모듈 오너들 |
| 회의 필요 | ✅ 필요 (`critical` 위험도 모듈 + DB 스키마 변경) |
| 자동 실행 | ❌ 불가 (`critical` 모듈 + DB 변경) |
| 운영자 승인 | ✅ 필수 |
| 필수 테스트 | `migrations-upgrade.test.ts`, `tsc --noEmit` |
| 재협의 조건 | 마이그레이션 실패, 기존 데이터 손실 감지 |

### 검증 포인트

```bash
athena impact analyze --paths "src/store/migrations.ts"
# Expected: Direct: store | Indirect: research, cli, ui, remote, ...
# Expected meeting reason: "위험도 critical 모듈 포함: store"

# 운영자 승인 없이 실행 불가 확인
athena execute <proposal-id>
# Expected error: "운영자 승인 필요: DB 스키마 변경"
```

---

## 시나리오 4: 프런트-백엔드 연동 변경

**변경 내용**: `src/ui/panels/research-status.tsx`에서 `src/research/contracts.ts`의 타입을 직접 사용하던 방식을 새 API 함수로 교체

**변경 파일**: `src/ui/panels/research-status.tsx`, `src/research/reporting.ts`

### 기대 결과

| 항목 | 기대값 |
|------|--------|
| 영향도 분석 | 직접: `ui`, `research` / 간접: `cli` |
| 소집 에이전트 | `ui-agent`, `research-agent` (필수), `cli-agent` (조건부) |
| 회의 필요 | ✅ 필요 (2개 모듈 동시 수정 + 인터페이스 변경 가능성) |
| 자동 실행 | ❌ 불가 |
| 운영자 승인 | ⚠️ 조건부 (reporting.ts 공용 API 변경 시 필요) |
| 필수 테스트 | `research-status.test.tsx`, `reporting.ts` 관련 |
| 재협의 조건 | 렌더 스냅샷 불일치, CLI 출력 변경 |

### 검증 포인트

```bash
athena impact analyze --paths "src/ui/panels/research-status.tsx,src/research/reporting.ts"
# Expected: 2개 모듈 직접 영향 → meeting required

# 충돌 감지 확인 (ui와 research가 동일 인터페이스에 다른 요구사항 가질 때)
athena meeting conflicts <meeting-id>
```

---

## 시나리오 5: 운영 설정 변경

**변경 내용**: `config/module-registry.yaml`의 특정 모듈 위험도 레벨 변경

**변경 파일**: `config/module-registry.yaml`

### 기대 결과

| 항목 | 기대값 |
|------|--------|
| 영향도 분석 | 직접: `impact` / 간접: 없음 / 참관: 모든 모듈 |
| 소집 에이전트 | `impact-agent` (필수) + 위험도가 변경되는 모듈 오너 |
| 회의 필요 | ✅ 필요 (운영 설정 변경 + 참관 전원에게 영향) |
| 자동 실행 | ❌ 불가 |
| 운영자 승인 | ✅ 필수 |
| 필수 테스트 | Impact 정확도 테스트 재실행 |
| 재협의 조건 | 영향도 분석 결과 예상치 벗어남 |

### 검증 포인트

```bash
athena impact analyze --paths "config/module-registry.yaml"
# Expected: Direct: impact | Observers: all modules

# 레지스트리 무효화 및 재계산 확인
athena impact --invalidate-cache
athena impact analyze --paths "src/store/migrations.ts"
# 위험도 변경 후 결과가 반영되어야 함
```

---

## 상태 전이 회귀 테스트 세트 (Task 14.3)

다음 상태 전이 시나리오에 대한 단위 테스트가 필요하다:

```typescript
// src/research/change-workflow-state.test.ts (신규 작성 필요)

describe("ChangeWorkflowState transitions", () => {
  it("draft → impact-analyzed", ...);
  it("impact-analyzed → agents-summoned", ...);
  it("in-meeting → agreed (합의 도달)", ...);
  it("in-meeting → on-hold (타임아웃)", ...);
  it("verifying → remeeting (테스트 실패)", ...);
  it("remeeting → in-meeting (재회의 시작)", ...);
  it("agreed → executing (게이트 통과)", ...);
  it("executing → failed (실행 오류)", ...);
  // 유효하지 않은 전이 차단
  it("should block: completed → executing", ...);
  it("should block: rejected → executing", ...);
});
```

---

## 회의 기록과 실행 결과 정합성 테스트 (Task 14.4)

```typescript
// src/research/meeting-execution-consistency.test.ts (신규 작성 필요)

describe("Meeting-Execution consistency", () => {
  it("실행 계획의 taskAssignments가 회의 mandatoryAgents를 포함해야 함", ...);
  it("conditionally-approved 합의는 approvalConditions가 있어야 함", ...);
  it("검증 실패 시 remeeting_required = true여야 함", ...);
  it("재협의 회의는 원래 meeting_id를 참조해야 함", ...);
  it("완료된 proposal의 verification_result가 passed여야 함", ...);
});
```
