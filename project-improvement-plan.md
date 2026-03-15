# Athena Project Improvement Plan

## Goal

Athena를 `자율형 연구 시스템`이라는 현재 제품 정의에 맞게 정렬하고, `강한 내부 베타`에서 `검증된 제한 베타`로 끌어올리기 위한 단일 실행 계획이다.

이 계획의 핵심은 기능을 더 많이 붙이는 것이 아니라, 이미 있는 시스템을 다음 기준에 맞게 수렴시키는 것이다.

- 목표 중심 루프가 실제로 돌아간다
- 증거 기반으로 다음 개선을 선택한다
- 실행, 평가, 재설계가 분리되지 않고 하나의 루프로 이어진다
- 감독형은 중심 정체성이 아니라 운용 모드로 정리된다
- 운영 표면과 문서, 코드, 검증이 같은 이야기를 한다

## Source Documents

이 계획은 아래 문서를 기준으로 정리한다.

- `README.md`
- `docs/glossary.md`
- `docs/vision.md`
- `docs/architecture-overview.md`
- `docs/current-state-mapping.md`
- `docs/release-readiness-v0.3.md`
- `docs/production-autonomy-roadmap.md`
- `docs/test-scenarios.md`

## Current Diagnosis

현재 Athena는 방향은 맞아졌지만 아직 다섯 가지 갭이 남아 있다.

1. 제품 정의는 정리됐지만 구현과 검증의 중심이 아직 완전히 그 정의를 따라가진 않는다.
2. 운영 표면은 강하지만, `자율 루프가 실제로 반복적으로 개선한다`는 증거 체계는 더 명시적이어야 한다.
3. 문서, CLI, 상태 모델은 많이 정렬됐지만 릴리스 기준과 베타 검증 문서가 하나의 실행 계획으로 묶여 있지 않다.
4. 루프 반복의 부품은 코드에 존재하지만, iteration을 cascade로 연결하는 메커니즘과 이를 관찰하는 표면이 아직 없다.
5. 플랫폼 런타임(특히 Windows)에서 로컬 실행 경로가 Unix 의존성으로 막혀 있어 베타 대상이 제한된다.

## North Star

Athena의 북극성은 다음 한 문장으로 고정한다.

`Athena는 목표 달성을 위해 계획, 개선, 평가, 재설계를 반복하는 자율형 연구 시스템이다.`

이 문장을 기준으로 모든 개선은 아래 질문을 통과해야 한다.

- 이 변경이 루프를 더 잘 돌게 만드는가
- 이 변경이 더 나은 다음 개선을 선택하게 만드는가
- 이 변경이 평가와 재설계를 더 신뢰 가능하게 만드는가
- 이 변경이 감독형 모드를 중심 정체성으로 오해하게 만들지 않는가

## Workstreams

### 1. Product And Runtime Alignment

목적:
문서, CLI, 상태 모델, 운영 표면이 모두 같은 제품 정의를 가리키게 만든다.

주요 작업:

- README, onboarding, glossary를 기준 문서로 고정한다
- CLI 도움말과 리포트 출력에서 `자율 루프`, `증거`, `평가`, `재설계` 언어를 일관되게 맞춘다
- supervised 관련 표면은 모두 운용 모드 문맥으로 재정리한다
- historical 문서는 현재 정의와 분리해서 읽히게 한다
- supervised 관련 문서(`operator-supervised-production-*`, `supervised-production-*`)를 `docs/modes/` 하위로 이동시켜 구조적으로 "모드"임을 명확히 한다
- 내부 상태명과 사용자 표면 언어의 번역 규칙을 정한다 (예: `revisit_due` → `redesign pending`)

검증 기준:

- README만 읽고도 Athena를 한 문장으로 설명할 수 있다
- CLI 표면 설명이 실제 지원 명령과 어긋나지 않는다
- supervised 관련 문서를 읽어도 제품 정체성이 흔들리지 않는다
- `docs/` 최상위 목록에서 supervised가 3개 이상 노출되지 않는다

### 2. Improvement Loop Hardening

목적:
Athena가 실제로 `plan -> improve -> evaluate -> redesign -> repeat`를 반복하는 시스템임을 코드와 표면에서 더 분명하게 만든다.

이 워크스트림은 전체 계획에서 가장 큰 구조적 작업이 필요하다. 현재 `ReconsiderationTrigger`, `revisit_due`, `ImprovementEngine` 등 반복 루프의 부품은 존재하지만, 이들을 하나의 iteration chain으로 연결하는 메커니즘이 없다.

주요 작업:

- workflow state에 `iteration_sequence` 필드를 추가해 run 내 반복 횟수를 명시적으로 추적한다
- `revisit_due` proposal이 다음 iteration을 자동으로 시작하는 cascading 메커니즘을 구현한다
- 첫 시도, 평가 결과, 다음 시도의 차이를 보고서와 CLI에서 추적 가능하게 만든다
- report에 "Loop Cycle Summary" 섹션을 추가한다 (iteration별 proposal → experiment → evaluation → redesign 체인)
- `athena research iterations <run-id>` 전용 뷰를 추가해 iteration 흐름을 한눈에 보여준다
- 실패, 혼합 결과, 보류 결과가 다음 액션 설계와 직접 연결되게 만든다
- stop condition과 revisit condition을 운영 표면에서 더 명시적으로 보여준다

코드 변경 범위:

- `src/research/workflow-state.ts`: iteration sequence 필드 추가
- `src/research/team-orchestrator.ts`: revisit → next iteration cascade 로직
- `src/research/reporting.ts`: Loop Cycle Summary 섹션
- `src/cli/research.ts`: iterations 뷰 추가
- `src/store/team-store.ts`: iteration 관계 persistence

검증 기준:

- 하나의 run에서 2회 이상 반복된 개선 흐름을 명확히 확인할 수 있다
- 첫 평가 결과가 다음 제안에 반영된 흔적이 남는다
- 실패한 시도가 성공처럼 보고되지 않는다
- `athena research iterations <run-id>`에서 iteration별 proposal → evaluation → redesign 체인이 보인다

### 3. Evidence And Proposal Quality

목적:
Athena가 “연구를 한다”가 아니라 “증거를 바탕으로 더 나은 다음 개선을 선택한다”는 제품 약속을 만족하게 한다.

현재 상태: `ProposalScorecard`가 `evidenceStrength(18%)`, `evidenceFreshness(12%)`, `contradictionPressure`를 명시적으로 가중하고, `claim-graph.ts`가 `supportedBy`, `hasCounterEvidence` 관계를 추적한다. 기반은 강하지만 사용자에게 투명하게 노출되지 않는다.

주요 작업:

- proposal, scorecard, claim support 연결을 운영 표면에서 더 읽기 쉽게 정리한다
- evidence strength, contradiction pressure, freshness 같은 판단 근거를 더 선명하게 드러낸다
- report의 Proposal Briefs 섹션에 `top 3 supporting claims`와 `evidence_coverage_gap` 필드를 추가한다
- scorecard 축 값에 claim-level 근거를 연결한다 ("이 evidenceStrength 0.7은 claim X, Y 때문")
- ingestion CLI에서 "어떤 proposal 점수가 바뀌었는지" evidence 유입 전/후 비교를 노출한다
- ingestion에서 들어온 정보가 실제 proposal 선택에 어떻게 반영됐는지 추적 가능하게 만든다
- 근거가 약한 제안과 강한 제안의 차이를 보고서 수준에서 설명할 수 있게 한다
- 외부 ingestion 파이프라인을 강화한다: URL, PDF, 문서에서 claim 추출이 현재 scaffolding 수준이므로, 최소한 URL → claim 경로를 검증 가능한 수준으로 올린다

검증 기준:

- 주요 proposal은 어떤 evidence에 의해 선택됐는지 설명 가능하다
- 근거가 약한 경우 그 약함이 명시적으로 드러난다
- evidence 없는 추정성 proposal이 상위로 쉽게 올라가지 않는다
- evidence 유입 시 scorecard 변화가 CLI에서 확인 가능하다

### 4. Execution, Safety, And Governance

목적:
자율성을 늘리더라도 bounded autonomy를 유지하게 한다.

현재 상태: execution-gate(4단계), verification-pipeline(4단계), RBAC 정책(`agent_worker`, `operator_admin`, `operator_reviewer`, `operator_observer`), action journal + replay-safe recovery가 이미 구현되어 있다. 이 영역은 가장 성숙하며, 남은 작업은 soak validation과 플랫폼 호환성이다.

주요 작업:

- automation mode별 정책 경계를 더 명확히 노출한다
- high-risk action, rollback plan, approval requirement, protected path 정책을 더 읽기 쉽게 연결한다
- remote execution과 recovery 상태를 operator surface에서 쉽게 추적하게 만든다
- incidents, review queue, journal을 실제 개입 포인트 중심으로 정리한다
- Windows 로컬 실행 경로를 수정한다: `connection-pool.ts`의 `/bin/bash` 하드코딩과 `/tmp/` 경로를 플랫폼 독립적으로 변경한다
- TODO Step 9, 13, 14의 미완료 exit gate를 베타 전에 통과시킨다

검증 기준:

- 고위험 작업은 자동으로 저위험처럼 진행되지 않는다
- blocked reason이 설명 가능한 상태로 남는다
- remote 또는 장기 실행 작업도 복구와 상태 점검이 가능하다
- Windows 환경에서 `pool.exec("local", ...)` 호출이 성공한다

### 5. Validation And Release Gating

목적:
Athena가 베타 배포 가능한 수준인지 문장이 아니라 시나리오와 증거로 판단하게 만든다.

주요 작업:

- `docs/test-scenarios.md` 기준으로 검증 러너 또는 수동 검증 체크리스트를 만든다
- 내부 베타 기준과 제한 베타 기준을 분리한다
- v0.3 readiness, autonomy roadmap, test scenarios를 하나의 검증 흐름으로 연결한다
- 시나리오별 실패 패턴을 기록하고 문서/코드에 되먹임한다

검증 기준:

- 최소 7개 시나리오가 pass/fail로 관리된다
- multi-iteration, evidence-grounded selection, failure redesign, safe stop이 모두 증명된다
- “문서상 자율성”이 아니라 “행동상 자율성”을 보여주는 결과가 남는다

## Phased Execution

### Phase 의존성 맵

```text
Phase 1 ─────────────────────────────────────┐
  │                                          │
  v                                          v
Phase 2A (iteration 코드 구현) ──> Phase 2B (표면 정리)
  │                                          │
  v                                          v
Phase 3 (Loop Proof) ◄──────────────────────-┘
  │
  v
Phase 4 ──> Phase 5
```

핵심 제약: Phase 3(Loop Proof)는 Phase 2A(iteration cascading 코드 구현) 없이는 불가능하다. 표면만 정리하고 루프 증거가 없으면 의미가 없다.

### Phase 1: Definition Lock

목표:
제품 정의와 용어를 더 이상 흔들리지 않게 잠근다.

작업:

- glossary를 기준 문서로 유지한다
- README, onboarding, vision, architecture의 중복 문장을 압축한다
- historical docs를 현재 정의와 분리한다
- supervised 관련 문서를 `docs/modes/`로 이동한다

완료 조건:

- 문서 어디를 먼저 읽어도 Athena가 `자율형 연구 시스템`으로 이해된다
- `docs/` 최상위에 supervised 파일이 3개 이상 노출되지 않는다

### Phase 2: Loop Implementation And Surface Cleanup

이 Phase는 두 트랙으로 나눠 병렬 진행한다.

#### Phase 2A: Iteration Cascading 구현

목표:
반복 루프가 코드 수준에서 실제로 작동하게 만든다.

작업:

- workflow state에 `iteration_sequence` 필드를 추가한다
- `revisit_due` → 다음 iteration 자동 시작 cascade를 구현한다
- iteration간 proposal → evaluation → redesign 연결을 persistence에 기록한다
- `athena research iterations <run-id>` 뷰를 추가한다
- report에 Loop Cycle Summary 섹션을 추가한다

완료 조건:

- smoke test에서 2회 이상 반복 iteration이 자동으로 진행된다
- iteration 간 연결이 CLI에서 확인 가능하다

#### Phase 2B: Operator Surface Cleanup

목표:
운영자가 현재 시스템 상태와 루프 상태를 더 쉽게 파악하게 만든다.

작업:

- CLI와 report에서 run, proposal, decision, incident, next-action 흐름을 더 선명히 보여준다
- research views를 역할별로 재정리한다
- evidence-to-proposal trace를 report에 추가한다
- 내부 상태명을 사용자 친화적 언어로 번역하는 레이어를 적용한다

완료 조건:

- 운영자가 README와 CLI만으로 현재 run의 단계, 막힌 이유, 다음 액션을 이해할 수 있다

### Phase 3: Loop Proof

목표:
Athena가 실제로 반복 루프를 수행한다는 증거를 만든다.

선행 조건: Phase 2A 완료 (iteration cascading이 동작해야 증거 수집이 가능)

작업:

- 다회 반복 run 사례를 확보한다
- 실패 후 재설계 사례를 확보한다
- evidence-grounded proposal selection 사례를 확보한다
- self-improvement 사례를 확보한다
- 각 사례를 `docs/test-scenarios.md`의 7개 시나리오에 매핑한다

완료 조건:

- 최소 3개의 대표 run에서 반복 루프가 문서화되고 재현 가능하다
- 7개 시나리오 중 최소 5개가 pass 상태로 기록된다

### Phase 4: Safety And Autonomy Envelope

목표:
autonomy를 늘릴수록 정책 경계도 같이 강화되게 만든다.

작업:

- automation mode별 허용 범위와 stop condition을 정리한다
- approval, rollback, incident, queue 흐름을 테스트 시나리오와 연결한다
- remote recovery와 overnight path를 제한 베타 기준으로 점검한다
- Windows 로컬 실행 블로커를 해결한다 (`/bin/bash`, `/tmp/` 하드코딩)
- TODO Step 9, 13, 14의 미통과 exit gate를 완료한다

완료 조건:

- bounded autonomy가 문서와 런타임 모두에서 설명 가능하다
- 지원 대상 플랫폼 모두에서 로컬 실행이 성공한다

### Phase 5: Beta Readiness

목표:
내부 베타와 제한 베타의 승인 기준을 분리해 실제 배포 결정을 가능하게 만든다.

선행 조건: Phase 3(Loop Proof) + Phase 4(Safety Envelope) 모두 완료

작업:

- 내부 베타 기준서 작성
- 제한 베타 기준서 작성
- 실패 패턴 회고 및 문서 반영
- release note와 operator runbook 연결
- 7개 시나리오 전체 pass/fail 최종 기록

완료 조건:

- "누구에게 어떤 조건으로 열 수 있는가"가 문서로 명확하다
- 7개 시나리오 결과와 베타 기준서가 하나의 릴리스 판단 흐름으로 연결된다

## Immediate Task List

우선순위 P0이 가장 높다. P0은 이후 모든 작업의 전제 조건이다.

### P0: Loop Cascade 구현 (Phase 2A 선행)

- [ ] `workflow-state.ts`에 `iteration_sequence` 필드를 추가한다
  Verify: run 내 반복 횟수가 DB에 기록된다
- [ ] `team-orchestrator.ts`에 `revisit_due` → 다음 iteration 자동 시작 cascade를 구현한다
  Verify: revisit 트리거 시 새 iteration이 자동 생성된다
- [ ] `reporting.ts`에 Loop Cycle Summary 섹션을 추가한다
  Verify: report에서 iteration별 proposal → evaluation → redesign 체인이 보인다
- [ ] `research.ts`에 `athena research iterations <run-id>` 뷰를 추가한다
  Verify: CLI에서 한 run의 iteration 이력을 확인할 수 있다

### P1: 문서 정렬과 표면 정리 (Phase 1 + 2B, P0과 병렬 가능)

- [ ] `README`, `vision`, `architecture`, `current-state-mapping` 중복 문장을 압축한다
  Verify: 같은 내용이 다른 표현으로 반복되는 부분이 크게 줄어든다
- [ ] supervised 관련 문서를 `docs/modes/`로 이동한다
  Verify: `docs/` 최상위에 supervised 파일이 3개 이상 노출되지 않는다
- [ ] evidence-to-proposal trace를 보여주는 운영 출력 개선안을 만든다
  Verify: proposal 선택 이유를 evidence와 함께 설명할 수 있다
- [ ] report Proposal Briefs에 `top 3 supporting claims`와 `evidence_coverage_gap`을 추가한다
  Verify: scorecard 축 값의 근거가 claim 단위로 보인다

### P2: 검증 체계 (Phase 3 선행 조건)

- [ ] `docs/test-scenarios.md` 기준의 수동 검증 체크리스트를 만든다
  Verify: 각 시나리오가 pass/fail로 기록 가능하다
- [ ] Loop Proof 대표 run 3건을 확보하고 문서화한다
  Verify: multi-iteration, evidence-grounded selection, failure redesign이 기록된다

### P3: 안전 경계와 플랫폼 (Phase 4)

- [ ] automation mode별 bounded autonomy 기준을 한 문서로 정리한다
  Verify: `manual`, `assisted`, `supervised-auto`, `overnight-auto`, `fully-autonomous`의 차이가 명확하다
- [ ] `connection-pool.ts`의 `/bin/bash` 및 `/tmp/` 하드코딩을 플랫폼 독립적으로 수정한다
  Verify: Windows에서 `pool.exec("local", "echo hello")`가 성공한다

### P4: 릴리스 판단 (Phase 5)

- [ ] internal beta와 limited beta 승인 기준을 분리한 문서를 만든다
  Verify: 현재 배포 수준을 모호한 표현 없이 판정할 수 있다
- [ ] 7개 시나리오 최종 pass/fail 기록과 릴리스 판단 흐름을 하나의 문서로 연결한다
  Verify: 시나리오 결과 → 베타 기준 → 릴리스 결정이 한 흐름으로 읽힌다

## Success Metrics

이 계획이 성공했다고 보려면 아래 조건을 충족해야 한다.

- Athena를 설명하는 1문장이 문서, CLI, 운영 문맥에서 동일하다
- 대표 run에서 반복 루프의 증거가 남는다
- proposal 선택이 evidence와 연결된다
- 고위험 작업은 정책 경계에서 명확히 멈춘다
- 실패한 결과가 다음 개선 설계로 이어진다
- 내부 베타와 제한 베타의 경계가 문서로 명시된다

## Risks

- 문서만 정리되고 실제 운영 표면이 따라오지 않을 수 있다
- supervised mode가 여전히 제품 중심처럼 읽힐 수 있다
- evidence 체계가 있어도 proposal 선택과 실제로 약하게 연결될 수 있다
- 베타 기준이 없으면 검증이 끝나도 출시 판단이 계속 미뤄질 수 있다
- iteration cascading 구현이 예상보다 복잡할 수 있다: workflow state, persistence, orchestrator, CLI, report 모두 변경이 필요하다
- Windows 플랫폼 블로커가 베타 대상을 제한한다: 로컬 실행(`/bin/bash`), 원격 동기화(`rsync`), doctor 진단(`/bin/bash` shell check)이 모두 Unix 의존이다
- TUI가 연구 상태를 직접 노출하지 않는다: TUI가 주요 사용 표면이라면 CLI만 개선해서는 부족하다
- 외부 ingestion이 scaffolding 수준이다: evidence 품질을 강조하지만 URL/PDF → claim 추출 파이프라인이 아직 검증 가능한 수준이 아니다
- Phase 간 의존성이 명시되지 않으면 순서 역전이 발생할 수 있다: 표면만 깨끗하고 루프 증거가 없는 상태가 될 수 있다

## Done When

- Athena의 제품 정의가 흔들리지 않는다
- 개선 루프의 반복이 관찰 가능하다
- 증거, 제안, 실행, 평가, 재설계가 하나의 run 안에서 연결된다
- 베타 배포 판단 기준이 문서와 시나리오로 고정된다
- iteration cascade가 코드에서 동작하고, CLI/report에서 관찰 가능하다
- 7개 테스트 시나리오가 pass/fail로 기록되고 릴리스 판단과 연결된다
- 지원 대상 플랫폼에서 로컬 실행이 블로커 없이 동작한다
