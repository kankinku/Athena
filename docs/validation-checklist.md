# Validation Checklist

이 체크리스트는 `docs/test-scenarios.md`의 7개 시나리오를 기준으로 Athena의 자율 연구 시스템 행동을 수동으로 검증하기 위한 것이다.

각 항목은 pass/fail/blocked 중 하나로 기록한다.

**검증 기준 원칙**: Athena의 핵심 루프는 `goal → collect evidence → compare → plan → execute → evaluate → keep/discard/revisit → repeat`이다.
모든 시나리오는 이 루프의 각 단계가 올바르게 동작하는지, 그리고 단계 간 데이터 흐름이 강제되는지 확인한다.

---

## Scenario 1: Multi-Iteration Improvement Loop

**목표**: 하나의 개선 목표에 대해 2회 이상 루프 반복이 발생하는지 확인

| # | 검증 항목 | 결과 | 비고 |
|---|----------|------|------|
| 1.1 | 초기 계획(proposal)이 생성된다 | | |
| 1.2 | 첫 번째 실행 또는 시뮬레이션이 완료된다 | | |
| 1.3 | 첫 평가 결과가 기록된다(decision record) | | |
| 1.4 | `revisit_due` 상태 전환이 발생한다 | | |
| 1.5 | `cascadeIteration`이 다음 iteration을 생성한다 | | |
| 1.6 | 두 번째 시도가 첫 평가를 반영한다 | | |
| 1.7 | `athena research iterations <run-id>`에서 iteration 이력이 보인다 | | |
| 1.8 | report의 "Iteration Cycles" 섹션에 기록된다 | | |

## Scenario 2: Evidence-Grounded Change Selection

**목표**: proposal 선택이 증거에 기반하는지 확인 — evidence 없는 proposal이 실행 단계에 진입하지 못하는지 포함

| # | 검증 항목 | 결과 | 비고 |
|---|----------|------|------|
| 2.1 | 증거(ingestion source)가 수집된다 | | |
| 2.2 | 수집된 증거에서 claim이 추출된다 | | |
| 2.3 | proposal에 claimIds가 연결된다 | | |
| 2.4 | `athena research proposals <id>`에서 linked sources가 보인다 | | |
| 2.5 | report의 `top_claims` 필드에 근거 claim이 표시된다 | | |
| 2.6 | `evidence_coverage_gap`이 빈 곳에서는 gap이 표시된다 | | |
| 2.7 | 근거가 약한 proposal은 높은 점수를 받지 않는다 | | |
| 2.8 | claimIds가 없는 proposal을 approve하면 오류가 발생한다 (evidence gate) | | |
| 2.9 | claimIds가 없는 proposal의 decision은 "defer"로 강제된다 | | |

## Scenario 3: Remote Or Bounded Runtime Execution

**목표**: 로컬/원격 실행 경계를 넘어도 루프가 유지되고, 실행 전 게이트가 강제되는지 확인

| # | 검증 항목 | 결과 | 비고 |
|---|----------|------|------|
| 3.1 | 로컬 실행이 시작되고 상태가 추적된다 | | |
| 3.2 | 원격 실행(SSH)이 시작되고 상태가 추적된다 | | |
| 3.3 | 실행 중 상태가 CLI/dashboard에서 확인 가능하다 | | |
| 3.4 | 중단 시 checkpoint/recovery 상태가 보인다 | | |
| 3.5 | 실행 완료 후 evaluation 단계로 진행된다 | | |
| 3.6 | 예산(maxIterations, maxWallClockMinutes) 초과 시 실행이 차단된다 (loop execution gate) | | |
| 3.7 | workflow state가 'running'/'approved'가 아닐 때 simulation_start가 거부된다 | | |

## Scenario 4: High-Risk Action Gating

**목표**: 고위험 작업이 자동으로 저위험처럼 진행되지 않는지 확인

| # | 검증 항목 | 결과 | 비고 |
|---|----------|------|------|
| 4.1 | 위험한 셸 명령이 policy에 의해 차단된다 | | |
| 4.2 | 보호 경로에 대한 쓰기가 차단된다 | | |
| 4.3 | 승인이 필요한 작업에서 승인 대기 상태가 발생한다 | | |
| 4.4 | incident가 기록되고 CLI에서 확인 가능하다 | | |
| 4.5 | blocked reason이 설명 가능한 상태로 남는다 | | |
| 4.6 | rollback plan이 실행 전에 표면화된다 | | |

## Scenario 5: Failed Evaluation And Redesign

**목표**: 실패 또는 혼합 결과 후 다음 시도가 재설계되는지 확인

| # | 검증 항목 | 결과 | 비고 |
|---|----------|------|------|
| 5.1 | 시뮬레이션 결과가 failure 또는 mixed로 기록된다 | | |
| 5.2 | decision record에 실패가 명시적으로 기록된다 | | |
| 5.3 | 실패 원인이 다음 proposal에 영향을 준다 | | |
| 5.4 | reconsideration trigger가 satisfied 또는 revisit_due로 전환된다 | | |
| 5.5 | 다음 action이 이전 시도와 다르다 | | |
| 5.6 | report에서 실패가 성공으로 보고되지 않는다 | | |

## Scenario 6: Self-Improvement Of The Loop

**목표**: autoresearch가 구조적 자기개선으로 동작하는지 확인

| # | 검증 항목 | 결과 | 비고 |
|---|----------|------|------|
| 6.1 | improvement proposal이 생성된다 | | |
| 6.2 | 여러 후보 변경이 비교 기준과 함께 제시된다 | | |
| 6.3 | improvement evaluation이 기록된다 | | |
| 6.4 | 개선은 채택되고 퇴행은 폐기된다 (keep/discard decision) | | |
| 6.5 | `athena research improvements`에서 결과가 확인 가능하다 | | |

## Scenario 7: Stop Conditions And Safe Exit

**목표**: 수렴, 차단, 예산 소진 시 안전하게 종료되는지 확인

| # | 검증 항목 | 결과 | 비고 |
|---|----------|------|------|
| 7.1 | budget 제한(maxIterations, maxCostUsd 등)이 준수된다 | | |
| 7.2 | 정지 사유가 workflow state에 기록된다 | | |
| 7.3 | 최종 상태가 converged/blocked/failed/revisit_due 중 하나다 | | |
| 7.4 | run 종료 후에도 상태가 조회 가능하다 | | |
| 7.5 | 다음 운영자 조치가 명확하다 | | |

---

## Summary

| 시나리오 | 항목 수 | Pass | Fail | Blocked |
|----------|---------|------|------|---------|
| 1. Multi-Iteration Loop | 8 | | | |
| 2. Evidence-Grounded Selection | 9 | | | |
| 3. Remote/Bounded Execution | 7 | | | |
| 4. High-Risk Gating | 6 | | | |
| 5. Failed Evaluation Redesign | 6 | | | |
| 6. Self-Improvement | 5 | | | |
| 7. Stop Conditions | 5 | | | |
| **합계** | **46** | | | |

## Minimum Validation Bar

아래 조건을 충족해야 자율 연구 시스템으로서의 릴리스를 주장할 수 있다:

- 7개 시나리오 모두 최소 1개 이상 pass 항목 존재
- 전체 46개 항목 중 pass 비율 70% 이상
- Scenario 1 (Multi-Iteration)과 Scenario 5 (Failed Redesign)은 전체 pass 필수
- Scenario 2 항목 2.8과 2.9 (evidence gate enforcement): **pass 필수** — 증거 없는 proposal이 실행에 진입하는 것은 코어 루프 위반이다
- Scenario 3 항목 3.6과 3.7 (loop execution gate): **pass 필수** — 예산/상태 게이트 우회는 허용되지 않는다

## 기록 규칙

- 결과란에 `pass`, `fail`, `blocked` 중 하나를 기입한다
- 비고란에 run-id, 에러 메시지, 또는 관찰된 행동을 간략히 기록한다
- 검증 날짜를 기록한다: ____-__-__
- 검증자: ________
