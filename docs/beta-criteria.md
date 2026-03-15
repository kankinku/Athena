# Beta Criteria

이 문서는 Athena의 **internal beta**와 **limited beta** 승인 기준을 분리 정의한다.

---

## Internal Beta (v0.3)

### 정의

프로젝트 팀 내부에서 실제 개선 목표를 설정하고 Athena를 사용해 루프를 돌릴 수 있는 수준.

### 진입 조건

| # | 기준 | 검증 방법 |
|---|------|----------|
| IB-01 | 코어 루프가 2회 이상 자동 반복된다 | Loop Proof Run A pass |
| IB-02 | proposal이 evidence에 기반해 선택된다 | Loop Proof Run B pass |
| IB-03 | 실패 평가 후 다른 시도로 재설계된다 | Loop Proof Run C pass |
| IB-04 | 고위험 작업이 policy에 의해 차단된다 | Validation Checklist Scenario 4 pass |
| IB-05 | budget/iteration 상한에서 안전하게 정지한다 | Validation Checklist Scenario 7 pass |
| IB-06 | 운영자가 CLI만으로 run 상태를 파악할 수 있다 | `athena research runs`, `workflow`, `iterations`, `proposals`, `decisions` 확인 |
| IB-07 | TypeScript 빌드 에러 0건 | `npx tsc --noEmit` |
| IB-08 | 핵심 테스트 suite 전체 통과 | `team-store`, `research-orchestration`, `report-snapshot`, `migrations` |
| IB-09 | Windows 로컬 실행이 성공한다 | `pool.exec("local", "echo hello")` exitCode=0 |
| IB-10 | 문서 정합성: Athena 정의가 일관된다 | README, vision, glossary에서 동일한 1문장 정의 |

### 미달 시 조치

IB-01~03 중 하나라도 fail이면 internal beta 불가. IB-04~10 중 2개 이상 fail이면 조건부 승인 (fail 항목 명시).

---

## Limited Beta (v0.4)

### 정의

신뢰할 수 있는 소수의 외부 운영자가 자신의 환경에서 Athena를 사용해볼 수 있는 수준.

### 진입 조건

Internal Beta 기준 **전체 통과** + 아래 추가 기준:

| # | 기준 | 검증 방법 |
|---|------|----------|
| LB-01 | 7개 시나리오 중 5개 이상 pass | Validation Checklist Summary 기준 |
| LB-02 | multi-iteration + failure-redesign 시나리오 필수 pass | Scenario 1, 5 전체 항목 pass |
| LB-03 | report가 루프 이력을 완전히 설명한다 | report에 Iteration Cycles, top_claims, evidence_coverage_gap 포함 |
| LB-04 | bounded autonomy 정책이 문서화됐다 | `docs/bounded-autonomy.md` 존재 및 최신화 |
| LB-05 | overnight-auto 모드에서 4시간 이상 안정 운행 | soak run 기록 (run-id, 시작/종료 시간, 정지 사유) |
| LB-06 | 원격 실행(SSH)이 검증됐다 | Scenario 3 pass |
| LB-07 | incident가 자동 기록되고 CLI에서 조회 가능하다 | `athena research incidents` 확인 |
| LB-08 | onboarding 문서만으로 설치-실행-확인이 가능하다 | 외부 사용자 1명 워크스루 완료 |
| LB-09 | 알려진 critical bug 0건 | issue tracker 기준 |
| LB-10 | release note + operator runbook이 최신화됐다 | `docs/operator-runbook.md` 검토 |

### 미달 시 조치

LB-01~02 중 하나라도 fail이면 limited beta 불가. LB-03~10 중 3개 이상 fail이면 조건부 승인 (fail 항목 + remediation plan 명시).

---

## 판정 흐름

```text
Internal Beta 기준 충족?
  ├── No → 기준 미달 항목 수정 후 재평가
  └── Yes → Internal Beta 승인
              │
              v
         Limited Beta 추가 기준 충족?
           ├── No → 기준 미달 항목 수정 후 재평가
           └── Yes → Limited Beta 승인
```

## 판정 기록

| 항목 | 값 |
|------|---|
| Internal Beta 판정 | pass / fail / conditional |
| 판정 날짜 | ____-__-__ |
| 미달 항목 | |
| Limited Beta 판정 | pass / fail / conditional |
| 판정 날짜 | ____-__-__ |
| 미달 항목 | |

## 관련 문서

- [Validation Checklist](./validation-checklist.md)
- [Loop Proof](./loop-proof.md)
- [Release Readiness v0.3](./release-readiness-v0.3.md)
- [Bounded Autonomy](./bounded-autonomy.md)
- [Test Scenarios](./test-scenarios.md)
