# Bounded Autonomy

이 문서는 Athena의 automation mode별 허용 범위, 정책 경계, 정지 조건을 정의한다.

Athena는 자율형 연구 시스템이다. 자율성이 늘어날수록 정책 경계도 같이 강화된다.

---

## Automation Mode 정의

Athena는 5단계 automation mode를 지원한다. 각 모드는 `AutomationPolicy.mode` 필드로 설정된다.

### 1. manual

| 항목 | 값 |
|------|---|
| 설명 | Athena가 상태를 구조화하고 다음 액션을 추천하지만, 실행은 운영자가 직접 수행 |
| 자동 실행 | 없음 |
| 승인 필요 | 모든 제안, 실험, 재방문에 운영자 승인 필요 |
| 실험 상한 | 0 (자동 실행 불가) |
| 정지 조건 | 운영자가 명시적으로 run을 종료 |

### 2. assisted

| 항목 | 값 |
|------|---|
| 설명 | Athena가 bounded action을 수행하되 운영자가 활성 감독 |
| 자동 실행 | evidence 수집, report 생성 등 저위험 작업만 가능 |
| 승인 필요 | proposal 승인, 실험 승인 필요, 재방문 승인 필요 |
| 실험 상한 | `maxAutoExperiments` (기본: 1) |
| 정지 조건 | 운영자 중단, budget 소진, 또는 blocked 상태 |

### 3. supervised-auto

| 항목 | 값 |
|------|---|
| 설명 | Athena가 정책 범위 내에서 자율 진행하되 운영자가 비동기 감독 |
| 자동 실행 | proposal 선택, 시뮬레이션 실행, 결과 평가까지 자동 |
| 승인 필요 | proposal 승인은 정책에 따라 선택적, 실험 승인 불필요, 재방문는 자동 cascade 가능 |
| 실험 상한 | `maxAutoExperiments` (기본: 3) |
| 정지 조건 | budget 소진, iteration 상한 도달, 고위험 작업 차단, 운영자 개입 |
| 비고 | 현재 가장 잘 검증된 배포 모드 |

### 4. overnight-auto

| 항목 | 값 |
|------|---|
| 설명 | Athena가 장시간(야간 등) bounded 작업을 budget과 gate 내에서 지속 |
| 자동 실행 | 전체 루프 자동 반복 (수집→제안→실험→평가→재설계) |
| 승인 필요 | 불필요 (정책 경계 내에서 자율) |
| 실험 상한 | `maxAutoExperiments` (기본: 5 이상) |
| 정지 조건 | `maxWallClockMinutes` 초과, `maxCostUsd` 초과, `maxIterations` 도달, 고위험 gate 차단, `failed` 전환 |
| 추가 제약 | checkpoint 주기적 기록 필수, timeout policy 활성 필수 |

### 5. fully-autonomous

| 항목 | 값 |
|------|---|
| 설명 | Athena가 명시적 autonomy policy envelope 내에서 완전 자율 운영 |
| 자동 실행 | 모든 단계 자동 (iteration cascade 포함) |
| 승인 필요 | 불필요 |
| 실험 상한 | `maxAutoExperiments` (정책 설정값) |
| 정지 조건 | autonomy policy 경계 도달 시 자동 중단 |
| 추가 제약 | `AutonomousModePolicy` 필수 설정 (아래 참고) |

---

## AutonomousModePolicy 필수 필드

`fully-autonomous` 모드에서는 `autonomyPolicy` 객체가 필수이며, 아래 정책 경계를 반드시 포함한다:

```typescript
interface AutonomousModePolicy {
  maxRiskTier: "safe" | "moderate" | "high";   // 허용 최대 위험 등급
  maxCostUsd?: number;                          // 비용 상한 (USD)
  maxWallClockMinutes?: number;                 // 총 실행 시간 상한
  maxRetryCount?: number;                       // 최대 재시도 횟수
  requireRollbackPlan?: boolean;                // 롤백 계획 필수 여부
  requireEvidenceFloor?: number;                // 최소 evidenceStrength
  allowedToolFamilies?: string[];               // 허용 도구 범위
  allowedMachineIds?: string[];                 // 허용 머신 범위
}
```

누락 시 기본 동작: `fully-autonomous`로 설정되어도 `autonomyPolicy`가 없으면 runtime이 `supervised-auto`처럼 동작한다.

---

## 정지 조건 (Stop Conditions)

모든 모드에 공통으로 적용되는 정지 조건:

| 조건 | 동작 |
|------|------|
| `maxIterations` 도달 | iteration cascade 중단, automation block 기록 |
| `maxWallClockMinutes` 초과 | timeout 전환, `failed` 상태로 전환 |
| `maxCostUsd` 초과 | budget anomaly 기록, run 중단 |
| 고위험 명령 탐지 | `SecurityManager.assertCommandAllowed()` 차단, incident 기록 |
| 보호 경로 쓰기 시도 | `SecurityManager.assertPathAllowed()` 차단, incident 기록 |
| `failed` 상태 전환 | run 종료 |
| 운영자 명시적 중단 | `athena research operate <run-id> --kind run --action cancel` |

### Reconsideration 조건

`revisit_due` 전환이 발생하는 조건:

- 시뮬레이션 결과의 decision이 `revisit`인 경우
- reconsideration trigger가 `satisfied` 상태로 전환된 경우
- 운영자가 명시적으로 재방문을 요청한 경우

`revisit_due`에서 다음 iteration으로의 cascade는 `cascadeIteration()`이 처리하며, `maxIterations` budget 내에서만 허용된다.

---

## 모드별 비교 요약

| | manual | assisted | supervised-auto | overnight-auto | fully-autonomous |
|---|---|---|---|---|---|
| 자동 수집 | ✗ | ✓ | ✓ | ✓ | ✓ |
| 자동 proposal | ✗ | ✗ | ✓ | ✓ | ✓ |
| 자동 실험 | ✗ | △ | ✓ | ✓ | ✓ |
| 자동 iteration | ✗ | ✗ | ✓ | ✓ | ✓ |
| 승인 필요 | 전부 | 전부 | 선택적 | ✗ | ✗ |
| 야간 운영 | ✗ | ✗ | △ | ✓ | ✓ |
| autonomyPolicy 필수 | ✗ | ✗ | ✗ | ✗ | ✓ |

---

## 관련 코드

- `src/research/contracts.ts`: `AutomationMode`, `AutomationPolicy`, `AutonomousModePolicy` 타입
- `src/research/automation-manager.ts`: automation state 관리, checkpoint, retry, timeout
- `src/research/team-orchestrator.ts`: `cascadeIteration()`, run lifecycle
- `src/security/policy.ts`: `SecurityManager`, command/path 허용 판단
- `src/research/execution-gate.ts`: 실행 게이트 조건
- `src/research/verification-pipeline.ts`: 검증 파이프라인 단계

## 관련 문서

- [Execution Gate](./execution-gate.md)
- [Guardrails](./guardrails.md)
- [State Machine](./state-machine.md)
- [Verification Pipeline](./verification-pipeline.md)
