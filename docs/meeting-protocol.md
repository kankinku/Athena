# 회의 프로토콜 (Meeting Protocol)

이 문서는 에이전트 회의의 진행 순서, 발언 형식, 충돌 해결 규칙, 합의 유형, 종료 조건을 정의한다.

---

## 7.1 회의 라운드 구조

회의는 최대 5개 라운드로 구성된다. 각 라운드에는 명확한 목표가 있으며, 목표가 달성되면 다음 라운드로 진행한다.

### 라운드 1: 제안 요약 (Proposal Summary)

**목표**: 모든 에이전트가 change proposal의 내용을 동일하게 이해한다.

```
진행자(facilitator)가 다음을 요약:
  - 변경의 목적과 배경
  - 변경 범위 (changed_paths)
  - 영향받는 모듈 목록
  - 예상 효과

각 에이전트는 이해 확인 또는 명확화 질문만 가능.
결정이나 입장 표명 불가.

라운드 완료 조건: 모든 에이전트가 이해 확인 완료 OR 타임아웃 (5분)
```

### 라운드 2: 영향 평가 (Impact Assessment)

**목표**: 각 에이전트가 자신의 모듈에 미치는 영향을 평가하고 보고한다.

```
각 에이전트의 발언 형식 (AgentPosition):
  - position: 입장 (support/neutral/concern/oppose)
  - impact: 자신의 모듈에 미치는 구체적 영향
  - risk: 식별된 위험도
  - required_changes: 자신의 모듈에서 필요한 변경사항
  - approval_condition: 승인 조건 (있는 경우)

참관 에이전트는 의견만 표명 가능.

라운드 완료 조건: 모든 필수 참석 에이전트가 발언 완료 OR 타임아웃 (10분)
```

### 라운드 3: 충돌 지점 정리 (Conflict Identification)

**목표**: 에이전트 간 의견 충돌과 미해결 이슈를 식별한다.

```
진행자가 다음을 정리:
  - concern/oppose 입장 목록
  - 상충되는 required_changes
  - 미해결 approval_conditions

각 에이전트는 충돌 지점에 대한 설명 추가 가능.

라운드 완료 조건: 충돌 지점 목록 확정 OR 충돌 없음 확인
```

### 라운드 4: 대안 비교 (Alternative Comparison)

**목표**: 충돌 해결을 위한 대안을 비교하고 최선안을 선택한다.

```
충돌이 있는 경우에만 진행.
충돌 없으면 라운드 4 건너뜀.

각 에이전트가 대안을 제시:
  - 원안 유지 (필요 변경 추가)
  - 수정안
  - 분할 실행
  - 추가 실험 후 재회의

비교 기준:
  - 영향 범위
  - 위험도
  - 구현 복잡도
  - 검증 가능성

라운드 완료 조건: 대안 목록 확정 OR 타임아웃 (10분)
```

### 라운드 5: 합의 또는 보류 (Consensus or Hold)

**목표**: 최종 합의 또는 보류 결정을 내린다.

```
투표 진행:
  - 각 에이전트: approve / conditionally_approve / split / hold / reject
  - 참관 에이전트: approve / neutral / concern (결정 불참)

합의 유형 결정 (아래 7.4 참조)

라운드 완료 조건: 합의 유형 확정
```

---

## 7.2 에이전트 발언 포맷

모든 에이전트의 발언은 다음 `AgentPosition` 형식을 따른다:

```typescript
interface AgentPosition {
  agentId: string;
  moduleId: string;
  round: number;

  // 라운드 2에서 필수
  position: "support" | "neutral" | "concern" | "oppose";
  impact: string;           // 내 모듈에 미치는 영향 설명
  risk: string;             // 위험도 평가
  requiredChanges: string[]; // 내 모듈에서 필요한 변경 목록

  // 라운드 5에서 필수
  vote?: "approve" | "conditionally_approve" | "split" | "hold" | "reject";
  approvalCondition?: string; // 조건부 승인의 조건

  // 공통
  notes?: string;
  timestamp: number;
}
```

---

## 7.3 충돌 해결 규칙

### 인터페이스 충돌 (Interface Conflict)

**발생**: 두 모듈이 동일 인터페이스에 상충되는 변경을 요구할 때

```
해결 순서:
1. 두 모듈 오너가 직접 협상 (라운드 4)
2. 합의 실패 → 인터페이스 오너(contracts 소유 모듈)가 결정
3. 여전히 충돌 → operator 개입 필요
```

### 일정 충돌 (Schedule Conflict)

**발생**: 변경 실행 순서에 의존성이 있어 동시 실행이 불가능할 때

```
해결 순서:
1. 실행 순서를 명시한 분할 실행 계획 수립
2. 의존 관계 확인 (먼저 실행할 모듈 결정)
3. → "split-execution" 합의 유형 선택
```

### 테스트 미충족 (Test Failure Risk)

**발생**: 특정 에이전트가 "이 변경으로 우리 테스트가 실패할 것"이라고 주장할 때

```
해결 순서:
1. 해당 테스트 목록 명시
2. 실패 방지를 위한 required_changes 추가
3. 변경 전 테스트 실행 확인 계획 수립
4. 여전히 해결 불가 → "추가 실험 후 재회의" 합의
```

### 보안/운영 우선권 충돌 (Security/Ops Priority Conflict)

**발생**: 보안 또는 운영 안정성과 기능 변경이 충돌할 때

```
규칙: 보안/운영 이슈는 기능 이슈보다 항상 우선한다.
  - security-agent의 "oppose"는 자동으로 reject 트리거
  - operator 명시적 override 없이는 진행 불가
```

---

## 7.4 합의 유형

| 유형 | 의미 | 다음 단계 |
|------|------|-----------|
| `approved` | 전원 동의 또는 과반 동의 | 즉시 실행 계획 생성 |
| `conditionally-approved` | 특정 조건 달성 후 진행 | 조건 항목 추적 후 조건 달성 시 실행 |
| `split-execution` | 변경을 여러 단계로 분할 | 순서가 있는 단계별 실행 계획 생성 |
| `experiment-first` | 추가 실험/검증 후 재회의 | 실험 계획 수립 → 결과 후 재회의 |
| `on-hold` | 합의 불가, 추가 정보 필요 | operator 검토 → 재소집 또는 거절 |
| `rejected` | 변경 거절 | proposal 상태 → "rejected", 아카이브 |

### 합의 판정 기준

| 합의 유형 | 필요 조건 |
|-----------|-----------|
| approved | 필수 참석 에이전트 전원 `approve` OR `approve + conditionally_approve` 과반 이상 |
| conditionally-approved | 최소 1명 `conditionally_approve`, 나머지 `approve` |
| split-execution | 최소 1명 `split`, 나머지 반대 없음 |
| on-hold | `hold` 1명 이상 + `oppose` 없음 |
| rejected | `reject` 1명 이상 (security-agent의 reject는 자동 rejected) |

---

## 7.5 회의 종료 조건

다음 조건이 모두 충족되면 회의가 종료된다:

```
1. 필수 참석 에이전트가 모두 라운드 2 발언 완료
2. 라운드 5 투표 완료 (타임아웃 포함)
3. 합의 유형이 결정됨
4. 합의 유형이 "approved" 또는 "conditionally-approved"인 경우:
   - 실행 계획 초안이 존재
   - 검증 조건이 명시됨
5. 합의 유형이 "conditionally-approved"인 경우:
   - 조건 항목이 명시됨
   - 조건 달성 확인 담당자가 지정됨
```

### 강제 종료 조건

```
- 전체 회의 시간 > 60분 → 자동 "on-hold"
- 진행자가 회의 중단 요청 → "on-hold"
- operator가 회의 중단 → "on-hold"
```

---

## 7.6 회의 기록 스키마

회의 기록은 `meeting_sessions` 테이블과 `agent_positions` 테이블에 저장된다.
자세한 스키마는 [docs/schemas/meeting-record.md](./schemas/meeting-record.md) 참조.

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-03-15 | 초안 작성 |
