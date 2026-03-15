# 대시보드 및 리포트 설계 (Dashboard & Report Spec)

이 문서는 운영자가 모듈 협의 시스템의 상태를 파악하기 위한 화면, 필터, 시각화를 정의한다.

---

## 12.1 핵심 운영자 화면

### 화면 1: Active Change Proposals

운영자가 가장 먼저 봐야 할 화면. 현재 처리 중인 모든 change proposal의 상태를 요약한다.

```
┌─────────────────────────────────────────────────────────────────┐
│  Active Change Proposals                            [new] [filter]│
├─────────────────────────────────────────────────────────────────┤
│  ID          Title                    State           Agents     │
│  ─────────────────────────────────────────────────────────────  │
│  cp_x8f2k9m  migrations.ts 추가       in-meeting  ⚡2/3 응답    │
│  cp_a3k1m9x  contracts.ts 확장        agreed      ✓ 실행 준비   │
│  cp_z9p7r2s  보안 정책 강화          verifying   🔄 검증 중     │
│  ─────────────────────────────────────────────────────────────  │
│  [1 on-hold]  [2 completed today]                               │
└─────────────────────────────────────────────────────────────────┘
```

**표시 컬럼**:
- `ID`: proposal_id (클릭하면 상세 화면)
- `Title`: 변경 제목
- `State`: change_workflow_state (색상 구분)
- `Agents`: 소집된 에이전트 / 응답한 에이전트 수
- `Flags`: 주의 플래그 (운영자 승인 필요, 충돌 있음, 재협의 진행 중)

### 화면 2: 영향받는 모듈 현황

```
┌─────────────────────────────────────────────────────────────────┐
│  Module Impact Status                                           │
├─────────────────────────────────────────────────────────────────┤
│  Module    Active Proposals   In Meeting   Executing   Blocked  │
│  ─────────────────────────────────────────────────────────────  │
│  store     2                  1            0           0        │
│  research  3                  1            1           0        │
│  cli       1                  0            0           1 ⚠️     │
│  ui        0                  0            0           0        │
└─────────────────────────────────────────────────────────────────┘
```

### 화면 3: 소집된 에이전트 현황

```
┌─────────────────────────────────────────────────────────────────┐
│  Agent Summon Status                         [proposal: cp_x8f2k9m]│
├─────────────────────────────────────────────────────────────────┤
│  Agent          Module    Status          Position     Vote      │
│  ─────────────────────────────────────────────────────────────  │
│  store-agent    store     ✅ 응답 완료    support      approve  │
│  research-agent research  ✅ 응답 완료    concern      cond.    │
│  cli-agent      cli       ⏳ 대기 중      —            —        │
│  ─────────────────────────────────────────────────────────────  │
│  ⚠️ cli-agent 응답 기한: 3분 후                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 화면 4: 충돌 포인트 목록

```
┌─────────────────────────────────────────────────────────────────┐
│  Conflict Points                             [proposal: cp_x8f2k9m]│
├─────────────────────────────────────────────────────────────────┤
│  #  Type              Agents           Status               │
│  ─────────────────────────────────────────────────────────────  │
│  1  interface-conflict store ↔ research  ⚠️ 미해결            │
│  ─────────────────────────────────────────────────────────────  │
│  설명: research-agent가 contract 인터페이스 변경 우려           │
│  제안된 해결: 조건부 승인 (MeetingStore 먼저 구현)              │
└─────────────────────────────────────────────────────────────────┘
```

### 화면 5: 승인 조건 추적

```
┌─────────────────────────────────────────────────────────────────┐
│  Approval Conditions                                            │
├─────────────────────────────────────────────────────────────────┤
│  ID       Condition                    Required By   Status    │
│  ─────────────────────────────────────────────────────────────  │
│  cond_001  MeetingStore 구현 완료       research     ⏳ pending │
│  cond_002  마이그레이션 테스트 통과     store        ✅ verified│
└─────────────────────────────────────────────────────────────────┘
```

### 화면 6: 테스트 상태

```
┌─────────────────────────────────────────────────────────────────┐
│  Verification Status                         [plan: plan_a7x1k0]  │
├─────────────────────────────────────────────────────────────────┤
│  Stage             Tests   Passed   Failed   Status             │
│  ─────────────────────────────────────────────────────────────  │
│  1. Module Unit    8/8     8        0        ✅                  │
│  2. Contract       3/3     2        1        ❌ migrations       │
│  3. Integration    —       —        —        ⏸️ blocked          │
│  4. E2E            —       —        —        ⏸️ blocked          │
└─────────────────────────────────────────────────────────────────┘
```

### 화면 7: 재협의 필요 여부

운영자가 즉시 행동해야 하는 항목만 표시:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ Action Required                                              │
├─────────────────────────────────────────────────────────────────┤
│  1. cp_z9p7r2s 검증 실패 → 재협의 필요 [remeeting 시작]        │
│  2. cp_x8f2k9m cli-agent 미응답 → 개입 필요 [기권 처리 / 재소집]│
│  3. cp_a3k1m9x 운영자 최종 승인 대기 [승인] [거절]             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12.2 리포트 구조 변경

기존 `athena report` 출력 구조에 다음 섹션이 추가된다:

```markdown
# Athena Change Management Report

## 요약 (Change Summary)
- 기간: 2026-03-15
- 처리된 change proposals: 5개
- 완료: 3개 | 실행 중: 1개 | 재협의: 1개

## 영향 분석 (Impact Analysis)
- 가장 많이 영향받은 모듈: store (4회), research (3회)
- 총 에이전트 소집: 23회
- 평균 회의 라운드: 3.2

## 각 오너 입장 요약 (Agent Positions Summary)
| 에이전트 | 총 발언 | 승인 | 조건부 | 거절 |
|---------|---------|------|--------|------|
| store-agent | 5 | 4 | 1 | 0 |
| research-agent | 5 | 3 | 2 | 0 |

## 최종 합의 목록 (Consensus Results)
...

## 실행 결과 (Execution Results)
...

## 검증 결과 (Verification Results)
...

## 남은 리스크 (Remaining Risks)
...
```

---

## 12.3 모듈 중심 검색과 필터링

```bash
# 특정 모듈 관련 proposal만 조회
athena research proposals --module store

# 특정 상태 필터
athena research proposals --state in-meeting
athena research proposals --state remeeting

# 에이전트별 조회
athena meeting status --agent store-agent

# 날짜 범위 필터
athena research proposals --since 2026-03-01 --until 2026-03-15
```

---

## 12.4 회의 타임라인 시각화 (TUI 내)

Ink TUI의 새 패널 `MeetingStatusPanel`에 다음을 표시:

```
src/ui/panels/meeting-status.tsx (신규 구현 필요)

[회의 상태 패널]
  Proposal: migrations.ts 추가 (cp_x8f2k9m)
  State:    in-meeting (라운드 3)
  
  참석자:
    ✅ store-agent     support  → approve
    ✅ research-agent  concern  → conditionally_approve
    ⏳ cli-agent       (대기)
    
  충돌: interface-conflict (store ↔ research)
  남은 시간: 7분
```

---

## CLI 명령 (12.1~12.4 구현용)

```bash
athena research proposals [--module <id>] [--state <state>] [--agent <id>]
athena research proposals --impact-dashboard
athena meeting status <proposal-id>
athena meeting agents <proposal-id>
athena meeting conflicts <proposal-id>
athena meeting conditions <proposal-id>
athena report --include-meetings [--since <date>]
```
