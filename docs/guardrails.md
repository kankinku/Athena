# 안전장치 (Guardrails)

이 문서는 모듈 오너 에이전트의 수정 가능 경로 강제, 승인 없이 실행할 수 없는 액션 목록, 자동 실행 예산과 제한, 실패 복구 절차를 정의한다.

---

## 13.1 모듈 오너 에이전트 경로 강제

에이전트는 `config/module-registry.yaml`의 `paths` 패턴에 매칭되는 파일만 수정할 수 있다.

### 경로 검사 구현 (실행 전 검사)

```typescript
// src/research/execution-gate.ts (신규 구현 필요)
function verifyPathScope(
  agentId: string,
  moduleId: string,
  intendedFiles: string[],
  registry: ModuleRegistry
): PathScopeResult {
  const module = registry.modules.find(m => m.module_id === moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);

  const violations = intendedFiles.filter(file =>
    !module.paths.some(pattern => matchesPattern(file, pattern))
  );

  return {
    allowed: violations.length === 0,
    violations,
    reason: violations.length > 0
      ? `에이전트 ${agentId}가 범위 외 파일 수정 시도: ${violations.join(', ')}`
      : 'OK'
  };
}
```

### 경로 위반 처리

```
경로 위반 감지 시:
1. 즉시 작업 중단
2. 위반 사항을 research_incidents 테이블에 기록
3. 에이전트에게 오류 반환
4. change proposal 생성 안내
5. 운영자에게 위반 알림 (critical 모듈인 경우)
```

---

## 13.2 승인 없이 실행할 수 없는 액션

다음 액션은 반드시 운영자 승인 또는 전체 에이전트 회의 합의가 필요하다:

### 절대 금지 (모든 조건에서)

| 액션 | 이유 |
|------|------|
| 기존 마이그레이션 SQL 수정 | 데이터 손실 위험 |
| 기존 DB 테이블/컬럼 삭제 | 비가역적 작업 |
| 보안 토큰/키 파일 수정 | 보안 침해 위험 |
| `src/security/policy.ts`의 차단 패턴 완화 | 보안 정책 약화 |
| `package.json` 의존성 추가/제거 | 릴리즈 영향 |

### 운영자 승인 필수

| 액션 | 승인 필요 이유 |
|------|--------------|
| 공용 인터페이스 변경 (`contracts.ts`) | 광범위한 영향 |
| DB 스키마 변경 (새 마이그레이션) | 데이터 영향 |
| CLI 인터페이스 변경 | 사용자 영향 |
| 배포 파이프라인 변경 (`.github/**`) | CI/CD 영향 |
| 모든 `critical` 위험도 모듈 변경 | 높은 위험 |

### 회의 합의 필수

| 액션 | 회의 필요 이유 |
|------|--------------|
| 여러 모듈 동시 변경 | 충돌 가능성 |
| 간접 영향 모듈이 있는 변경 | 검토 필요 |
| `high` 위험도 모듈 변경 | 위험 평가 필요 |

---

## 13.3 감사 로그 (상세한 명세는 audit-log-spec.md 참조)

모든 주요 이벤트는 `research_action_journal` 테이블에 기록된다.

기록 대상 이벤트:
- change proposal 생성/수정/삭제
- 영향도 분석 실행
- 에이전트 소집/응답
- 회의 라운드 진행
- 합의 결정
- 실행 계획 생성
- 실행 시작/완료/실패
- 검증 실행/결과
- 재협의 트리거
- 경로 위반 시도
- 운영자 승인/거절

---

## 13.4 자동 실행 예산과 제한

### 전체 시스템 제한

```yaml
global_limits:
  max_concurrent_proposals: 5           # 동시 처리 중인 proposal 최대 수
  max_concurrent_meetings: 3            # 동시 진행 중인 회의 최대 수
  max_concurrent_executions: 2          # 동시 실행 중인 proposal 최대 수
  max_daily_auto_executions: 10         # 하루 최대 자동 실행 수
  cooldown_after_failure_minutes: 30    # 실패 후 재시도 대기 시간
```

### 에이전트 자율 실행 제한

```yaml
agent_execution_limits:
  max_wall_clock_minutes: 60            # 에이전트 최대 실행 시간
  max_retry_count: 3                    # 단계별 최대 재시도 수
  max_files_per_execution: 5            # 실행당 최대 수정 파일 수
  max_cost_usd_per_execution: 2.00      # 실행당 최대 비용
```

### 일일 예산 초과 시

```
일일 예산 초과 → 모든 자동 실행 일시 중단
→ 운영자에게 알림
→ 운영자가 수동으로 재개하거나 예산 조정
```

---

## 13.5 실패 복구 절차

### 중단된 회의 복구

```
회의 상태 = "in-meeting" + 타임아웃 감지:
1. 회의 상태 → "on-hold"
2. 현재까지의 발언 기록 보존
3. 운영자에게 복구 옵션 제시:
   a) 타임아웃된 에이전트 기권 처리 후 회의 계속
   b) 에이전트 재소집
   c) 회의 취소 (proposal → "on-hold")

커맨드:
athena meeting resume <meeting-id> [--forfeit-absent] [--resummon]
```

### 중단된 실행 복구

```
실행 상태 = "executing" + 하트비트 없음 감지:
1. 실행 에이전트 상태 확인
2. 완료된 작업 목록 조회 (action_journal)
3. 운영자에게 상황 보고:
   - 완료된 작업
   - 미완료 작업
   - 중간 상태의 파일
4. 복구 옵션:
   a) 완료된 부분 유지 후 나머지 재실행
   b) 전체 롤백 후 재시작
   c) 수동 완료

커맨드:
athena execute recover <proposal-id>
athena rollback <proposal-id> --force
```

### 재시도 규칙

```
에이전트 응답 없음:
  - 1차 재시도: 즉시
  - 2차 재시도: 5분 후
  - 3차 재시도: 10분 후
  - 이후: 기권 처리 + 운영자 알림

테스트 실패:
  - 자동 재시도 없음 (반복 실행은 비용 낭비)
  - 즉시 운영자 알림 + remeeting 트리거
  
실행 오류:
  - 1차 재시도: 즉시 (동일 조건)
  - 2차 재시도: 5분 후
  - 이후: 실행 중단 + 롤백 + 운영자 알림
```

---

## 관련 문서

- [감사 로그 명세](./audit-log-spec.md)
- [실행 게이트](./execution-gate.md)
- [에이전트 소집 규칙](./agent-summon-rules.md)
