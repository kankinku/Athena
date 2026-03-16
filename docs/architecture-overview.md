# 아키텍처 개요

이 문서는 Athena를 `자율 연구 루프를 실행하는 시스템`으로 볼 때의 전체 구조를 설명한다.

## 시스템 레이어

### 1. Loop Control

목표, 현재 단계, 다음 액션, 자동화 정책, 재시도, 복구를 관리한다.

주요 파일:
- `src/research/workflow-state.ts`
- `src/research/automation-manager.ts`
- `src/research/team-orchestrator.ts`
- `src/research/workflow-automation-service.ts`

### 2. Research and Evidence

외부 자료와 내부 상태를 개선 근거로 바꾸는 계층이다.

주요 파일:
- `src/research/ingestion-service.ts`
- `src/research/claim-graph.ts`
- `src/research/source-adapters/*`

### 3. Planning and Decision

수집된 자료를 후보로 줄이고, 다음 bounded improvement를 선택하는 계층이다.

주요 파일:
- `src/research/decision-engine.ts`
- `src/research/team-orchestrator.ts`
- `src/research/meeting-orchestrator.ts`

### 4. Execution and Experimentation

실제 개선을 수행하거나 시뮬레이션하고, 로컬 및 원격 머신에서 실행을 관리한다.

주요 파일:
- `src/remote/executor.ts`
- `src/remote/local-runtime.ts`
- `src/research/simulation-runner.ts`
- `src/tools/research-orchestration.ts`

### 5. Memory and Reporting

실험 이력, 그래프 메모리, 보고서, 운영자 관찰면을 담당한다.

주요 파일:
- `src/memory/graph-memory.ts`
- `src/research/reporting.ts`
- `src/ui/panels/research-status.tsx`
- `src/cli/research.ts`

### 6. Safety and Governance

정책, 위험 경계, 승인, 감사, 롤백, 검증을 담당한다.

주요 파일:
- `src/security/policy.ts`
- `src/security/audit-store.ts`
- `src/research/execution-gate.ts`
- `src/research/verification-pipeline.ts`

## 핵심 데이터 흐름

```text
goal
  -> collect evidence
  -> shortlist and compare candidate directions
  -> plan the next bounded improvement
  -> execute or simulate
  -> evaluate result
  -> keep, discard, or revisit
  -> update memory and decision state
  -> repeat
```

## 제품 중심 해석

Athena의 본질은 `회의 시스템`이 아니라 `반복형 연구 실행 시스템`이다.

- 회의는 다중 모듈 조정이나 충돌 해소가 필요할 때 쓰는 조건부 planning 메커니즘이다.
- 오케스트레이터는 루프 방향 제어기다.
- 메모리와 보고서는 루프의 기억 장치다.
- 원격 실행과 보안 정책은 루프의 실행 기반이다.

## 기술 스택

- Runtime: Node.js 20+
- Language: TypeScript 5.7+
- CLI: `@effect/cli`
- TUI: Ink 6 + React 19
- Persistence: SQLite + `better-sqlite3`
- Models: Claude SDK, OpenAI Codex SDK
- Remote execution: SSH2
