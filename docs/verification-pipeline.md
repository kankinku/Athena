# 통합 검증 파이프라인 (Verification Pipeline)

이 문서는 change proposal 실행 후 수행되는 검증 파이프라인의 구조, 실행 순서, 실패 시 재협의 트리거를 정의한다.

---

## 11.1 모듈별 필수 테스트 vs. 교차 모듈 테스트

### 모듈별 필수 테스트 (Unit/Module Tests)

각 모듈이 소유하고 반드시 통과해야 하는 테스트:

| 모듈 | 필수 테스트 파일 | 실행 명령 |
|------|-----------------|-----------|
| store | `src/store/migrations-upgrade.test.ts`, `src/store/preferences.test.ts` | `node --import tsx --test src/store/...` |
| research | `src/research/*.test.ts` | `npm run test:research` |
| cli | `src/cli/*.test.ts`, `src/research/cli-*.test.ts` | `node --import tsx --test src/cli/...` |
| ui | `src/ui/**/*.test.ts*` | `node --import tsx --test src/ui/...` |
| remote | `src/remote/*.test.ts` | `npm run test:phase5` |
| security | `src/security/policy.test.ts`, `src/remote/connection-pool-security.test.ts` | `npm run test:phase6` |
| tools | `src/tools/research-orchestration.test.ts` | `node --import tsx --test src/tools/...` |
| providers | `src/providers/**/*.test.ts` | `node --import tsx --test src/providers/...` |

### 교차 모듈 테스트 (Integration/E2E Tests)

여러 모듈이 협력하는 시나리오를 검증하는 테스트:

| 테스트 | 대상 모듈 | 실행 명령 |
|--------|-----------|-----------|
| `src/e2e/local-research.test.ts` | research + remote + store | `npm run test:phase5` |
| `src/e2e/remote-research.test.ts` | research + remote + providers | `npm run test:phase5` |
| `src/research/automation-safety.test.ts` | research + automation | `npm run test:research:safety` |
| `src/research/workflow-state.test.ts` | research + store | `npm run test:research` |

---

## 11.2 검증 테스트와 실행 계획 연결

회의에서 확정된 `required_tests` 목록이 검증 파이프라인으로 연결되는 방식:

```typescript
// ExecutionPlan에서 검증 파이프라인 구성
interface VerificationPipeline {
  stages: VerificationStage[];
  failurePolicy: "stop-on-first" | "run-all-report";
  totalTimeoutMinutes: number;
}

interface VerificationStage {
  stageId: string;
  stageName: string;
  stageType: "module-unit" | "contract" | "integration" | "e2e";
  testCommands: string[];
  ownerModule: string;
  failureAction: "block" | "warn" | "remeeting";
  timeoutMinutes: number;
}
```

---

## 11.3 검증 실행 순서

파이프라인은 다음 순서로 실행된다. 앞 단계 실패 시 기본적으로 다음 단계를 실행하지 않는다.

### Stage 1: 모듈 단위 테스트

```
- 변경된 모듈의 단위 테스트만 실행
- 빠른 피드백 (보통 < 2분)
- 실패 시: 즉시 중단 (빠른 실패)
```

### Stage 2: 영향 모듈 계약 테스트

```
- directly_affected_modules의 계약 테스트 실행
- 공용 인터페이스 호환성 확인
- 타입 호환성 검사 (tsc --noEmit)
- 실패 시: 중단 + remeeting 트리거 (인터페이스 충돌)
```

### Stage 3: 통합 테스트

```
- 변경된 모듈과 의존 모듈 간 통합 테스트
- 데이터 흐름 검증
- 실패 시: 중단 + remeeting 트리거
```

### Stage 4: E2E 테스트

```
- 전체 워크플로 E2E 테스트
- local-research.test.ts (항상)
- remote-research.test.ts (remote 모듈 변경 시)
- 실패 시: remeeting 트리거 (가장 광범위한 실패)
```

---

## 11.4 실패 시 재협의 트리거

검증 실패는 자동으로 재협의를 트리거할 수 있다.

### 재협의 자동 트리거 조건

| 실패 유형 | 재협의 트리거 여부 | 소집할 에이전트 |
|-----------|-------------------|----------------|
| 계약 테스트 실패 (인터페이스 변경) | ✅ 항상 | 원래 회의 참석자 + 실패 모듈 오너 |
| 통합 테스트 실패 | ✅ 항상 | 원래 회의 참석자 + 실패 모듈 오너 |
| 모듈 단위 테스트만 실패 | ⚠️ 조건부 | 실패 모듈 오너만 소집 |
| E2E 실패 | ✅ 항상 | 원래 회의 참석자 전원 |
| 성능 임계치 이탈 | ✅ 항상 | 해당 모듈 오너 + operators |

### 재협의 트리거 프로세스

```
1. VerificationResult 생성 (remeeting_required = true)
2. proposal 상태 → "remeeting"
3. change_workflow_state → "remeeting"
4. 원래 MeetingSession에 실패 정보 첨부
5. 새 MeetingSession 생성:
   - 원래 참석자 + 실패 모듈 오너
   - 실패 컨텍스트 포함
6. 에이전트 재소집
```

---

## 11.5 검증 결과 → 회의 기록 연결

모든 검증 결과는 회의 기록과 연결된다:

```
verification_results.proposal_id → proposal_briefs.id
verification_results.execution_plan_id → execution_plans.id
                                          ↓
                                    execution_plans.meeting_id → meeting_sessions.id
```

이를 통해 운영자가 다음을 추적할 수 있다:
- 어떤 합의 → 어떤 실행 → 어떤 검증 결과
- 재협의가 몇 번 발생했는지
- 어떤 모듈이 반복적으로 검증에 실패하는지

---

## 11.6 검증 명령 레퍼런스

Athena 프로젝트에서 사용하는 검증 명령 전체 목록:

```bash
# 전체 빌드
npm run build

# 연구 스택 테스트 (research 모듈 변경 시)
npm run test:research

# Phase 5 테스트 (remote, providers, e2e 변경 시)
npm run test:phase5

# Phase 6 보안 테스트 (security 변경 시)
npm run test:phase6

# Phase 7 원격 E2E (remote 변경 시, SSH 환경 필요)
npm run test:phase7

# 릴리즈 전체 테스트
npm run test:release

# TypeScript 타입 검사 (contracts.ts 변경 시)
npx tsc --noEmit --skipLibCheck
```
