# Release Decision Flow

이 문서는 7개 테스트 시나리오 결과에서 베타 기준 판정, 최종 릴리스 결정까지의 흐름을 하나로 연결한다.

---

## 1단계: 시나리오 검증

[Validation Checklist](./validation-checklist.md)의 7개 시나리오를 실행하고 결과를 기록한다.

| 시나리오 | 항목 수 | Pass | Fail | Blocked | 판정 |
|----------|---------|------|------|---------|------|
| 1. Multi-Iteration Loop | 8 | | | | |
| 2. Evidence-Grounded Selection | 7 | | | | |
| 3. Remote/Bounded Execution | 5 | | | | |
| 4. High-Risk Gating | 6 | | | | |
| 5. Failed Evaluation Redesign | 6 | | | | |
| 6. Self-Improvement | 5 | | | | |
| 7. Stop Conditions | 5 | | | | |
| **합계** | **42** | | | | |

시나리오별 판정 기준:
- **pass**: 전체 항목 pass
- **partial**: 1~2개 fail, 나머지 pass
- **fail**: 3개 이상 fail 또는 핵심 항목 fail

---

## 2단계: Loop Proof 확인

[Loop Proof](./loop-proof.md)의 대표 run 3건 결과를 기록한다.

| Run | 시나리오 | 판정 | 날짜 | run-id |
|-----|----------|------|------|--------|
| A | Multi-Iteration | | | |
| B | Evidence-Grounded | | | |
| C | Failure → Redesign | | | |

---

## 3단계: Internal Beta 판정

[Beta Criteria](./beta-criteria.md) IB-01 ~ IB-10 기준:

| 기준 | 결과 | 비고 |
|------|------|------|
| IB-01: 코어 루프 2회+ 반복 | | Run A |
| IB-02: evidence 기반 proposal | | Run B |
| IB-03: 실패→재설계 | | Run C |
| IB-04: 고위험 작업 차단 | | Scenario 4 |
| IB-05: 안전 정지 | | Scenario 7 |
| IB-06: CLI 상태 파악 | | |
| IB-07: 빌드 에러 0 | | |
| IB-08: 핵심 테스트 통과 | | |
| IB-09: Windows 로컬 실행 | | |
| IB-10: 문서 정합성 | | |

**Internal Beta 판정**: pass / fail / conditional
**날짜**: ____-__-__
**미달 항목**: 

---

## 4단계: Limited Beta 판정

Internal Beta 통과 후, [Beta Criteria](./beta-criteria.md) LB-01 ~ LB-10 추가 기준:

| 기준 | 결과 | 비고 |
|------|------|------|
| LB-01: 7개 시나리오 중 5+ pass | | |
| LB-02: Scenario 1+5 필수 pass | | |
| LB-03: report 루프 이력 완전 | | |
| LB-04: bounded autonomy 문서화 | | |
| LB-05: overnight 4h+ 안정 | | |
| LB-06: SSH 원격 실행 검증 | | |
| LB-07: incident 자동 기록 | | |
| LB-08: onboarding 워크스루 | | |
| LB-09: critical bug 0건 | | |
| LB-10: release note/runbook 최신 | | |

**Limited Beta 판정**: pass / fail / conditional
**날짜**: ____-__-__
**미달 항목**: 

---

## 5단계: 릴리스 결정

```text
시나리오 42개 항목 실행
        │
        v
  Pass 비율 >= 70%?  ──No──> 수정 후 재검증
        │Yes
        v
  Loop Proof 3건 pass?  ──No──> 코드 수정 후 재실행
        │Yes
        v
  Internal Beta 기준 충족?  ──No──> 미달 항목 해결
        │Yes
        v
  ★ Internal Beta 승인 (v0.3)
        │
        v
  Limited Beta 추가 기준 충족?  ──No──> 미달 항목 해결
        │Yes
        v
  ★ Limited Beta 승인 (v0.4)
```

---

## 문서 연결 맵

```text
test-scenarios.md          시나리오 정의 (7개)
        │
        v
validation-checklist.md    개별 항목 pass/fail 기록 (42개)
        │
        v
loop-proof.md              대표 run 3건 증거 기록
        │
        v
beta-criteria.md           internal/limited beta 승인 기준
        │
        v
release-decision-flow.md   ★ 이 문서: 전체 흐름 연결 + 최종 판정
        │
        v
release-readiness-v0.3.md  v0.3 릴리스 정의 및 범위
```

---

## 최종 판정 기록

| 항목 | 값 |
|------|---|
| 시나리오 전체 Pass 수 | /42 |
| Loop Proof Pass 수 | /3 |
| Internal Beta 판정 | |
| Limited Beta 판정 | |
| 릴리스 결정 | |
| 결정 날짜 | |
| 결정자 | |
