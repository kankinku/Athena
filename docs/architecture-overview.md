# 아키텍처 개요 (Architecture Overview)

이 문서는 Athena 모듈 협의 시스템의 전체 아키텍처를 개괄한다.

---

## 시스템 레이어 구조

```
┌─────────────────────────────────────────────────────────────────┐
│  운영자 인터페이스 (Operator Interface)                           │
│  • Ink TUI (src/ui/)                                            │
│  • Effect CLI (src/cli/)                                        │
│  • athena proposal | meeting | impact | agree | execute | verify│
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  협의 오케스트레이터 (Meeting Orchestrator)                        │
│  • src/research/team-orchestrator.ts (확장)                     │
│  • MeetingSession 라이프사이클 관리                               │
│  • 에이전트 소집 + 응답 수집 + 합의 판정                          │
└──────┬─────────────────┬──────────────────┬──────────────────────┘
       │                 │                  │
┌──────▼──────┐  ┌───────▼──────┐  ┌────────▼───────────┐
│  영향도 분석  │  │  회의 세션    │  │  실행 게이트         │
│  (Impact)   │  │  (Meeting)   │  │  (ExecutionGate)   │
│             │  │              │  │                    │
│ GraphBuilder│  │MeetingSession│  │ExecutionPlan       │
│ ImpactAna-  │  │AgentPosition │  │PathScopeVerifier   │
│   lyzer     │  │ApprovalCond  │  │AutoApproveChecker  │
└──────┬──────┘  └───────┬──────┘  └────────┬───────────┘
       │                 │                  │
┌──────▼─────────────────▼──────────────────▼───────────────────┐
│  Research 엔진 (연구 모듈 - src/research/)                       │
│  • ProposalStore, DecisionStore, WorkflowStore                  │
│  • MeetingStore (신규)                                          │
│  • AutomationManager                                            │
│  • ActionJournalStore (감사 로그)                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  저장소 (Store - src/store/)                                      │
│  • SQLite (better-sqlite3)                                       │
│  • 19+1 마이그레이션 (v20: 6개 신규 테이블)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 핵심 데이터 흐름

```
사용자/에이전트 → ChangeProposal 생성
                         │
                 ImpactAnalyzer.analyze()
                         │
               ImpactAnalysisResult (직접/간접/참관)
                         │
                MeetingOrchestrator.summon()
                         │
                AgentPosition 수집 (라운드 1-5)
                         │
              합의 판정 → ExecutionPlan 생성
                         │
              (선택) 운영자 승인
                         │
            ExecutionGate.verify() → 실행 시작
                         │
          각 모듈 오너 에이전트 → 범위 내 파일 수정
                         │
          VerificationPipeline 실행 (단위→계약→통합→E2E)
                         │
          통과 → completed | 실패 → remeeting
```

---

## 컴포넌트 책임 매핑

| 컴포넌트 | 파일 | 책임 |
|----------|------|------|
| GraphBuilder | `src/impact/graph-builder.ts` | 모듈 레지스트리 → 의존 그래프 |
| ImpactAnalyzer | `src/impact/impact-analyzer.ts` | 변경 파일 → 영향 모듈 |
| MeetingOrchestrator | `src/research/team-orchestrator.ts` | 회의 전체 진행 |
| MeetingStore | `src/research/meeting-store.ts` (신규) | 회의 기록 CRUD |
| ExecutionGate | `src/research/execution-gate.ts` (신규) | 게이트 검사 + 계획 생성 |
| VerificationPipeline | `src/research/verification-pipeline.ts` (신규) | 테스트 실행 + 재협의 트리거 |
| ProposalStore | `src/research/proposal-store.ts` | Change proposal CRUD |
| AutomationManager | `src/research/automation-manager.ts` | 자동 실행 정책 |
| ActionJournalStore | `src/research/action-journal-store.ts` | 감사 로그 |

---

## 기술 스택

| 계층 | 기술 |
|------|------|
| 런타임 | Node.js 20+ |
| 언어 | TypeScript 5.7+ |
| 함수형 프로그래밍 | Effect 3.x |
| CLI 프레임워크 | @effect/cli |
| TUI | Ink 6 + React 19 |
| 데이터베이스 | SQLite (better-sqlite3) |
| AI 공급자 | Claude (Anthropic SDK), OpenAI Codex SDK |
| 원격 실행 | SSH2 |
| 빌드 | TypeScript (tsc) |
| 테스트 | Node.js built-in test runner |
