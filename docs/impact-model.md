# 영향도 모델 (Impact Model)

이 문서는 변경 파일 목록에서 영향받는 모듈을 계산하는 영향도 그래프의 설계와 알고리즘을 설명한다.

---

## 영향도 3단계 분류

모든 모듈 영향은 정확히 세 단계 중 하나로 분류된다:

### 1단계: 직접 영향 (direct)
- **정의**: 변경된 파일이 직접 속하는 모듈
- **소집**: 필수 참석
- **발언 권한**: 완전한 발언권 + 거부권 행사 가능
- **예시**: `src/store/migrations.ts` 변경 → `store` 모듈 직접 영향

### 2단계: 간접 영향 (indirect)
- **정의**: 직접 영향 모듈의 공용 인터페이스를 사용하는 모듈
- **소집**: 조건부 참석 (공용 인터페이스 변경 시 필수, 내부 변경만이면 선택)
- **발언 권한**: 완전한 발언권 (거부권 없음, 단 조건부 승인 가능)
- **예시**: `store` 공용 인터페이스 변경 → `research`, `cli`, `ui` 간접 영향

### 3단계: 참관 (observer)
- **정의**: 2단계 이상 거리의 의존 관계, 또는 런타임 의존 관계만 있는 모듈
- **소집**: 알림만 받음 (회의 참석 선택)
- **발언 권한**: 읽기 전용 참여, 입장 표명만 가능
- **예시**: `store` 변경 → `providers` 간접 의존 → `providers` 참관

---

## 영향도 계산 파이프라인

```
변경된 파일 목록
      │
      ▼
[Step 1] 직접 모듈 식별
  module-registry.yaml의 paths 패턴 매칭
      │
      ▼
[Step 2] 공용 인터페이스 변경 감지
  contracts.ts, index.ts 등 인터페이스 파일 변경 여부
      │
      ▼
[Step 3] 역방향 BFS (indirectly affected)
  reverseEdges 그래프에서 직접 모듈을 시작점으로 BFS
  depth 1 → indirect
  depth 2+ → observer
      │
      ▼
[Step 4] 회의 필요 여부 판단
  - critical/high 모듈 직접 수정 → 항상 회의
  - 공용 인터페이스 변경 → 항상 회의
  - 2개+ 모듈 동시 수정 → 회의
  - 단일 모듈 내부 변경만 → 회의 불필요
      │
      ▼
ImpactAnalysisResult
```

---

## 의존 그래프 구조

### 정방향 의존 (edges)
> A depends_on [B, C] → A는 B와 C에 의존한다

```
store ← (없음)
research ← store
cli ← research, store, impact
ui ← research, store
remote ← store, security
security ← store
tools ← remote, security, store
providers ← store
impact ← store
```

### 역방향 의존 (reverseEdges)
> B가 변경되면 A가 영향받는다

```
store → research, cli, ui, remote, security, tools, providers, impact
research → cli, ui
security → remote, tools
remote → tools
impact → cli
```

---

## 계약 의존성 수집 (5.2)

영향도 분석은 코드 의존성 외에도 다음 계약 의존성을 추적한다:

### API 스펙 의존성
- `src/research/contracts.ts` 변경 → research 공용 인터페이스 변경으로 처리
- 타입 정의 변경은 컴파일 오류 없이도 의미적 변경 가능

### DB 스키마 의존성
- `src/store/migrations.ts` 변경 → store 직접 영향
- 스키마 변경은 모든 `INSERT`/`SELECT` 쿼리에 영향 가능

### 설정 파일 의존성
- `config/module-registry.yaml` 변경 → impact 직접 영향 + 모든 모듈 참관

### 환경 변수 의존성
- `src/paths.ts` 또는 `src/cli/env.ts` 변경 → 관련 모듈 간접 영향

---

## 테스트 의존성 (5.3)

각 모듈의 `affected_tests`가 변경 영향을 받는 테스트 파일을 정의한다:

| 모듈 | 연관 테스트 |
|------|-------------|
| store | migrations-upgrade.test.ts, preferences.test.ts |
| research | research/*.test.ts, e2e/local-research.test.ts |
| cli | cli/*.test.ts, cli-regression.test.ts |
| ui | ui/**/*.test.ts, ui/**/*.test.tsx |
| remote | remote/*.test.ts, e2e/remote*.test.ts |
| security | security/policy.test.ts |

---

## 그래프 저장소 (5.6)

현재 구현: **메모리 인접 구조 (adjacency Map)**

```typescript
interface ModuleGraph {
  modules: Map<string, ModuleDefinition>;    // moduleId → 정의
  edges: Map<string, Set<string>>;           // 정방향: A → B (A depends_on B)
  reverseEdges: Map<string, Set<string>>;    // 역방향: B → A (A depends on B)
  pathPatterns: Array<{ pattern, moduleId }>;
  mergeGates: Record<string, MergeGateDefinition>;
}
```

캐시:
- `getModuleGraph()` 호출 시 30초 TTL 캐시
- `invalidateModuleGraphCache()` 로 명시적 무효화
- 레지스트리 파일 변경 후 재시작 또는 명시적 무효화 필요

향후 개선:
- DB 기반 저장 (변경 이력 추적)
- 시각화 export (Mermaid, DOT 형식)

---

## 소스 파일

| 파일 | 역할 |
|------|------|
| `src/impact/graph-builder.ts` | YAML 파싱 → 그래프 구성, 유효성 검사 |
| `src/impact/impact-analyzer.ts` | 변경 파일 → 영향 모듈 계산 |
| `config/module-registry.yaml` | 모듈 정의 원본 |
