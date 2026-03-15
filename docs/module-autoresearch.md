# 모듈별 Autoresearch 루프 (Module Autoresearch Loop)

이 문서는 각 모듈 오너 에이전트가 자신의 범위 내에서 자율적으로 개선을 탐색하는 루프의 설계를 정의한다.

---

## 10.1 수정 가능 범위 제한

각 에이전트는 `config/module-registry.yaml`의 `paths` 필드에 정의된 범위 내에서만 파일을 수정할 수 있다.

```
범위 검사 (실행 전):
  수정 대상 파일 ∈ module.paths → 허용
  수정 대상 파일 ∉ module.paths → 차단 + 로그

위반 시:
  → change proposal 생성 필요
  → 영향받는 모듈 협의 필요
```

---

## 10.2 모듈별 목표 함수

각 모듈은 달성하고자 하는 목표가 다르다. 목표 함수가 autoresearch 루프의 방향을 결정한다.

| 모듈 | 주요 목표 | 측정 지표 |
|------|-----------|-----------|
| store | DB 마이그레이션 안정성, 쿼리 성능 | 마이그레이션 성공률, 쿼리 응답 시간 |
| research | 제안 품질, 상태 전환 정확도 | 합의 도달률, 재협의 발생 빈도 |
| cli | CLI 응답성, 출력 정확도 | 스냅샷 테스트 통과율 |
| ui | 렌더링 정확도, 사용성 | 렌더 테스트 통과율 |
| remote | 실행 안정성, 오류 복구 | 실행 성공률, 복구 시간 |
| security | 정책 위반 차단율 | 차단된 위반 시도 수 |
| impact | 영향도 분석 정확도 | 참탐율 (true positive rate) |

### 공통 목표

모든 모듈이 공통으로 추구하는 목표:
- **테스트 통과** (`affected_tests` 100% 통과)
- **계약 유지** (공용 인터페이스 하위 호환성)
- **오류 감소** (런타임 오류 발생 빈도)

---

## 10.3 모듈별 실행 예산

과도한 자율 실행을 방지하기 위해 모듈별 실행 예산을 정의한다.

| 모듈 | 최대 시간 | 최대 반복 | 최대 파일 수정 | 최대 비용 |
|------|-----------|-----------|----------------|-----------|
| store | 30분 | 5회 | 3개 | $0.50 |
| research | 60분 | 10회 | 5개 | $1.00 |
| cli | 30분 | 5회 | 3개 | $0.50 |
| ui | 20분 | 5회 | 3개 | $0.30 |
| remote | 45분 | 5회 | 3개 | $0.50 |
| security | 15분 | 3회 | 2개 | $0.30 |
| impact | 20분 | 5회 | 3개 | $0.30 |
| tools | 30분 | 5회 | 3개 | $0.50 |

---

## 10.4 로컬 반복 루프 (Local Iteration Loop)

각 모듈 오너 에이전트가 실행하는 내부 루프:

```
LOOP:
  1. 변경 생성 (Change Generation)
     - 목표 함수 기반 개선점 식별
     - 최소 변경 원칙: 가장 작은 유효한 변경
     - 범위 검사: 수정 파일 ∈ module.paths

  2. 테스트 실행 (Test Execution)
     - module.affected_tests 실행
     - 타임아웃 적용 (각 테스트 최대 5분)

  3. 결과 비교 (Result Comparison)
     - 이전 상태와 비교
     - 목표 함수 개선 여부 확인

  4. 채택/폐기 (Adopt/Discard)
     - 개선됨: 변경 유지, 반복 계속
     - 개선 없음: 변경 폐기 (git reset)
     - 악화됨: 즉시 변경 폐기

  5. 재시도 (Retry)
     - 예산 내에서 반복
     - 예산 소진: 루프 종료

UNTIL: 목표 달성 OR 예산 소진 OR 공용 인터페이스 변경 필요 감지
```

### 공용 인터페이스 변경 필요 감지 시

```
→ 로컬 루프 중단
→ change proposal 자동 생성 (created_by = agent_id)
→ 영향도 분석 실행
→ 회의 소집 요청
```

---

## 10.5 실패 시 자동 롤백과 재보고

### 자동 롤백 조건

```
- 테스트 실패 (실패 횟수 > 2)
- 예산 초과 (시간 또는 반복 수)
- 보안 정책 위반
- 공용 인터페이스 의도치 않은 변경
```

### 롤백 절차

```
1. 현재 변경사항 git stash (또는 git reset --hard)
2. 테스트 재실행으로 원상복구 확인
3. ImprovementProposalRecord 생성:
   - 시도한 내용
   - 실패 이유
   - 다음 시도 방향
4. 실패 리포트를 운영자 알림 큐에 추가
```

---

## 10.6 모듈별 실행 템플릿

### 백엔드 모듈 (store, research, security)

```yaml
# templates/backend-module-autoresearch.yaml
module_type: backend
iteration_pattern: test-driven
change_approach:
  - 단위 테스트 먼저 작성
  - 구현 변경
  - 단위 테스트 통과 확인
  - 통합 테스트 실행
rollback_strategy: git-reset-hard
test_runner: "node --import tsx --test"
max_parallel_tests: 1
```

### 프런트 모듈 (ui)

```yaml
# templates/frontend-module-autoresearch.yaml
module_type: frontend
iteration_pattern: render-driven
change_approach:
  - 스냅샷 테스트 기준 설정
  - 렌더링 변경
  - 스냅샷 비교
  - 시각적 검토 (스크린샷 비교)
rollback_strategy: git-reset-hard
test_runner: "node --import tsx --test"
max_parallel_tests: 1
```

### 인프라 모듈 (remote, providers)

```yaml
# templates/infra-module-autoresearch.yaml
module_type: infra
iteration_pattern: safety-first
change_approach:
  - 변경 전 현재 상태 스냅샷
  - 단계적 변경 (최소 단위)
  - 연결 테스트
  - E2E 경로 검증
rollback_strategy: git-reset-hard
test_runner: "node --import tsx --test"
max_parallel_tests: 1
safety_checks:
  - no-auth-file-modification
  - no-key-file-modification
```

### 데이터 모듈 (store with migrations)

```yaml
# templates/data-module-autoresearch.yaml
module_type: data
iteration_pattern: migration-safe
change_approach:
  - 새 마이그레이션 추가만 허용 (기존 수정 금지)
  - 마이그레이션 버전 순서 확인
  - 롤백 SQL 준비
  - 마이그레이션 업그레이드 테스트 실행
rollback_strategy: migration-rollback + git-reset
test_runner: "node --import tsx --test"
requires_operator_approval: true
```

---

## 10.7 감사 및 가시성

모든 autoresearch 루프 실행은 `research_action_journal`에 기록된다:

```
action_type = "module_autoresearch_tick"
state = "running" | "committed" | "needs_recovery"
payload = {
  moduleId, agentId, iteration, changedFiles,
  testResults, decision, reason
}
```

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `config/module-registry.yaml` | 모듈 범위 및 예산 정의 |
| `src/research/automation-manager.ts` | 자동화 정책 실행 |
| `src/research/action-journal-store.ts` | 루프 감사 로그 |
| `docs/templates/backend-module-autoresearch.yaml` | 백엔드 템플릿 |
| `docs/templates/frontend-module-autoresearch.yaml` | 프런트 템플릿 |
| `docs/templates/infra-module-autoresearch.yaml` | 인프라 템플릿 |
| `docs/templates/data-module-autoresearch.yaml` | 데이터 템플릿 |
