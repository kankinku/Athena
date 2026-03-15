# 감사 로그 명세 (Audit Log Specification)

이 문서는 모듈 협의 시스템의 모든 주요 이벤트에 대한 감사 로그 스키마와 기록 정책을 정의한다.

---

## 감사 로그 저장소

기존 `research_action_journal` 테이블을 재사용하며, 새 이벤트 타입을 추가한다.

---

## 이벤트 타입 목록

```typescript
// src/research/contracts.ts의 ActionJournalType 확장
export type ActionJournalType =
  // 기존 타입 유지
  | "session_recovery"
  | "session_tick"
  | "simulation_launch"
  | "simulation_finalize"
  | "simulation_budget_enforcement"
  | "automation_retry"
  | "operator_resume"
  | "operator_rollback"

  // 신규: Change Management 이벤트
  | "proposal_created"           // change proposal 생성
  | "proposal_updated"           // change proposal 수정
  | "impact_analyzed"            // 영향도 분석 완료
  | "agents_summoned"            // 에이전트 소집
  | "agent_responded"            // 에이전트 응답 (발언)
  | "agent_timed_out"            // 에이전트 타임아웃 (기권)
  | "meeting_started"            // 회의 시작
  | "meeting_round_advanced"     // 회의 라운드 진행
  | "meeting_consensus_reached"  // 합의 도달
  | "meeting_on_hold"            // 회의 보류
  | "execution_plan_created"     // 실행 계획 생성
  | "operator_approved"          // 운영자 승인
  | "operator_rejected"          // 운영자 거절
  | "execution_started"          // 실행 시작
  | "execution_task_completed"   // 에이전트 작업 완료
  | "execution_completed"        // 실행 완료
  | "execution_failed"           // 실행 실패
  | "verification_started"       // 검증 시작
  | "verification_completed"     // 검증 완료
  | "verification_failed"        // 검증 실패
  | "remeeting_triggered"        // 재협의 트리거
  | "rollback_started"           // 롤백 시작
  | "rollback_completed"         // 롤백 완료
  | "path_violation_detected"    // 경로 위반 감지
  | "approval_condition_verified"; // 승인 조건 달성 확인
```

---

## 이벤트별 페이로드 스키마

### proposal_created

```json
{
  "proposalId": "cp_x8f2k9m",
  "title": "migrations.ts 추가",
  "changedPaths": ["src/store/migrations.ts"],
  "createdBy": "user"
}
```

### impact_analyzed

```json
{
  "proposalId": "cp_x8f2k9m",
  "directlyAffected": ["store", "research"],
  "indirectlyAffected": ["cli"],
  "observers": ["ui"],
  "meetingRequired": true,
  "meetingRequiredReason": "공용 인터페이스 변경: store"
}
```

### agents_summoned

```json
{
  "proposalId": "cp_x8f2k9m",
  "meetingId": "mtg_a7x3k2",
  "mandatoryAgents": ["store-agent", "research-agent"],
  "conditionalAgents": ["cli-agent"],
  "observerAgents": ["ui-agent"],
  "responseDeadlineAt": 1710500300000
}
```

### agent_responded

```json
{
  "proposalId": "cp_x8f2k9m",
  "meetingId": "mtg_a7x3k2",
  "agentId": "store-agent",
  "round": 2,
  "position": "support",
  "vote": "approve",
  "responseTimeMs": 45000
}
```

### meeting_consensus_reached

```json
{
  "proposalId": "cp_x8f2k9m",
  "meetingId": "mtg_a7x3k2",
  "consensusType": "conditionally-approved",
  "approvalConditions": ["cond_001"],
  "totalRounds": 3,
  "totalDurationMs": 480000
}
```

### path_violation_detected

```json
{
  "agentId": "research-agent",
  "moduleId": "research",
  "attemptedPaths": ["src/store/migrations.ts"],
  "allowedPaths": ["src/research/**"],
  "blocked": true,
  "proposalRequired": true
}
```

### verification_failed

```json
{
  "proposalId": "cp_x8f2k9m",
  "executionPlanId": "plan_a7x1k0",
  "failedTests": ["migrations-upgrade"],
  "failureMessages": ["Expected table meeting_sessions to exist"],
  "remeetingRequired": true,
  "remeetingReason": "계약 테스트 실패: meeting_sessions 테이블 미생성"
}
```

---

## 감사 로그 보존 정책

| 이벤트 유형 | 보존 기간 |
|-------------|-----------|
| 경로 위반 | 영구 |
| 보안 관련 이벤트 | 영구 |
| 회의/합의 기록 | 영구 |
| 실행/검증 결과 | 1년 |
| 일상적 상태 변경 | 90일 |

---

## 감사 로그 조회

```bash
# 특정 proposal의 전체 이벤트 이력
athena audit --proposal <proposal-id>

# 에이전트 활동 이력
athena audit --agent <agent-id> [--since <date>]

# 경로 위반 기록
athena audit --type path_violation

# 보안 이벤트
athena audit --type security [--severity critical]
```

---

## 불변성 보장

감사 로그는 한 번 작성되면 수정하거나 삭제할 수 없다.

```typescript
// research_action_journal에 삽입만 허용 (UPDATE/DELETE 불가)
// 상태 변경이 필요하면 새 레코드를 INSERT
```

이는 감사 추적의 무결성을 보장하고, 나중에 전체 이벤트 시퀀스를 재현할 수 있게 한다.
