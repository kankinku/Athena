# 에이전트 소집 규칙 (Agent Summon Rules)

이 문서는 change proposal이 생성되었을 때 어떤 에이전트를 소집하고, 어떤 우선순위와 규칙으로 소집하는지를 정의한다.

---

## 6.1 모듈-에이전트 매핑

모든 모듈은 정확히 하나의 오너 에이전트에 매핑된다. 매핑은 `config/module-registry.yaml`의 `owner_agent` 필드가 기준이다.

| 모듈 | 오너 에이전트 |
|------|--------------|
| store | store-agent |
| research | research-agent |
| impact | impact-agent |
| cli | cli-agent |
| ui | ui-agent |
| remote | remote-agent |
| security | security-agent |
| tools | tools-agent |
| providers | providers-agent |

---

## 6.2 소집 규칙

### 규칙 1: 직접 영향 모듈 → 필수 참석 (MANDATORY)

변경된 파일이 직접 속하는 모듈의 오너 에이전트는 반드시 소집된다.

```
직접 영향 모듈 오너 → 필수 참석
  - 거부권 행사 가능
  - 실행 계획의 담당자로 배정
  - 미응답 시 회의 보류
```

### 규칙 2: 간접 영향 모듈 → 조건부 참석 (CONDITIONAL)

공용 인터페이스가 변경되는 경우에만 간접 영향 모듈 오너를 소집한다.

```
조건:
  a) 직접 영향 모듈의 contracts.ts 또는 index.ts가 변경됨
  b) 직접 영향 모듈의 공용 인터페이스 시그니처가 변경됨
  c) DB 스키마 변경이 포함됨

조건 미충족 시: 알림만 발송 (선택적 참석 허용)
```

### 규칙 3: 참관 모듈 → 읽기 전용 참여 (OBSERVER)

2단계 이상 거리의 의존 모듈 오너는 읽기 전용으로 참여한다.

```
참관 모듈 오너:
  - 회의 내용 수신
  - 의견 표명만 가능 (발언은 가능하나 결정권 없음)
  - 미응답해도 회의 진행 가능
```

---

## 6.3 소집 우선순위

소집 순서는 변경의 성격에 따라 결정된다. 우선순위가 높은 변경일수록 더 많은 에이전트를 소집하고 더 엄격한 합의가 필요하다.

### P1 — 인터페이스 변경 (최우선)
```yaml
trigger: contracts.ts, *.d.ts, index.ts의 public export 변경
required_agents: [직접 모듈, 모든 indirect 모듈]
approval_requirement: unanimous  # 전원 동의 필요
example: "ProposalBrief 타입에 새 필수 필드 추가"
```

### P2 — 데이터 구조 변경
```yaml
trigger: src/store/migrations.ts 변경, DB 스키마 변경
required_agents: [store-agent, 영향받는 모든 모듈]
approval_requirement: unanimous + operator
example: "proposal_briefs 테이블에 NOT NULL 컬럼 추가"
```

### P3 — 런타임 설정 변경
```yaml
trigger: src/config/**, src/paths.ts, 환경 변수 관련 파일
required_agents: [직접 모듈, 높은 위험도 indirect 모듈]
approval_requirement: majority
example: "ATHENA_HOME 경로 변경"
```

### P4 — 배포 영향 변경
```yaml
trigger: package.json, tsconfig.json, .github/**, scripts/**
required_agents: [tools-agent, ops-agent (미래)]
approval_requirement: operator
example: "빌드 스크립트 변경"
```

### P5 — 보안 영향 변경
```yaml
trigger: src/security/**, auth-related 파일, ~/.athena/auth/**
required_agents: [security-agent, operator 필수]
approval_requirement: security-agent + operator
example: "SSH 인증 로직 변경"
```

### P6 — 일반 내부 변경 (최저 우선)
```yaml
trigger: 위 항목에 해당하지 않는 단일 모듈 내부 변경
required_agents: [직접 모듈만]
approval_requirement: owner_only
example: "에러 메시지 수정, 로그 추가"
```

---

## 6.4 응답 시간 제한과 미응답 처리

### 응답 타임아웃

| 영향 단계 | 응답 기한 | 미응답 시 |
|-----------|-----------|-----------|
| direct (P1-P2) | 5분 | 회의 보류 (operator 개입 필요) |
| direct (P3-P6) | 10분 | 자동 기권으로 처리 |
| indirect | 15분 | 자동 기권 (회의는 계속) |
| observer | 30분 | 알림 후 무시 |

### 미응답 처리 규칙

```
1. 타임아웃 5분 전: 에이전트에게 재알림 발송
2. P1-P2 직접 영향 에이전트가 무응답이면:
   → 회의를 "on-hold" 상태로 전환
   → operator에게 개입 요청 발송
   → operator가 수동으로 기권 처리하거나 재소집 가능
3. 기타 에이전트가 무응답이면:
   → 기권(abstain) 처리
   → 회의는 계속 진행
   → 기권 사실이 회의 기록에 남음
```

---

## 6.5 회의 최소 구성 (Quorum Rules)

회의가 진행되려면 다음 최소 구성이 충족되어야 한다:

### 정족수 기본 규칙

```
1. 제안자 (proposer) — 항상 포함
2. 모든 직접 영향 모듈 오너 — 미응답 없이 출석해야 함 (P1-P2 기준)
3. 통합 검증 담당 — verifier-agent 또는 직접 영향 모듈 오너 중 1명
```

### 운영자 승인이 추가로 필요한 경우

다음 중 하나라도 해당하면 운영자 승인이 의무:
- merge_gate에 `operator` 포함 (예: `migration_review_required`)
- 변경 경로가 `src/security/**` 포함
- 변경이 공용 API/CLI 인터페이스 변경
- 직접 영향 모듈에 `critical` 위험도 모듈 포함

### 정족수 미달 시

```
정족수 미달 → 회의 상태: "pending-quorum"
→ 소집 재시도 (최대 3회)
→ 3회 실패 시 → "failed" + operator 알림
```

---

## 6.6 소집 프로세스 흐름

```
1. ImpactAnalyzer.analyze(changedPaths) 호출
   → ImpactAnalysisResult 반환

2. meetingRequired == true 이면:
   → MeetingOrchestrator.summonAgents(result) 호출
   → 각 에이전트에게 소집 메시지 발송:
      {
        proposalId, title, summary,
        impactLevel, affectedInterfaces,
        responseDeadline
      }

3. 에이전트 응답 수신:
   → AgentPosition 저장 (meeting_sessions 테이블)
   → 정족수 확인

4. 정족수 충족 → 회의 시작 (MeetingProtocol 실행)
   정족수 미달 → pending-quorum → 재소집

5. meetingRequired == false 이면:
   → 직접 모듈 오너에게만 알림 발송
   → 자동 승인 처리 (policy 허용 시)
```

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-03-15 | 초안 작성 |
