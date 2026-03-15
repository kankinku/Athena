# 운영자 런북 (Operator Runbook)

이 문서는 모듈 협의 시스템을 운영하는 담당자를 위한 실용적인 작업 가이드다.

---

## 시스템 상태 빠른 점검

```bash
# 1. 전체 상태 확인
athena research proposals --state active

# 2. 행동 필요 항목 확인
athena research next-actions

# 3. 현재 회의 진행 상황
athena meeting status --all-active

# 4. 오늘의 영향 요약
athena report --today
```

---

## 주요 운영 작업

### 제안 생성 (Proposal Creation)

```bash
# 수동으로 change proposal 생성
athena proposal create \
  --title "src/store/migrations.ts에 v20 마이그레이션 추가" \
  --paths "src/store/migrations.ts" \
  --summary "meeting_sessions 등 6개 테이블 추가"

# 생성 후 영향도 분석 시작
athena impact analyze --proposal <proposal-id>
```

### 영향 분석 확인 (Impact Analysis Verification)

```bash
# 영향도 분석 결과 조회
athena impact show <proposal-id>

# 예상 소집 에이전트 미리 보기
athena agent preview <proposal-id>

# 영향도 분석 재실행 (레지스트리 변경 후)
athena impact reanalyze <proposal-id>
```

### 회의 승인 (Meeting Approval)

```bash
# 현재 회의 상태 확인
athena meeting status <proposal-id>

# 회의 기록 전문 조회
athena meeting transcript <meeting-id>

# 특정 에이전트 수동 기권 처리
athena meeting forfeit <meeting-id> --agent <agent-id>

# 회의 강제 재소집
athena meeting resummon <meeting-id>

# 운영자 최종 합의 승인
athena agree <proposal-id> [--condition "조건 설명"]
```

### 실행 시작 (Execution Start)

```bash
# 실행 계획 확인
athena execute preview <proposal-id>

# 실행 시작
athena execute <proposal-id>

# 실행 상태 모니터링
athena execute status <proposal-id>
```

### 검증 실행 (Verification)

```bash
# 수동 검증 시작
athena verify <proposal-id>

# 검증 결과 확인
athena verify results <proposal-id>

# 특정 테스트만 재실행
athena verify --test <test-id> <proposal-id>
```

### 실행 중단 (Execution Stop)

```bash
# 실행 즉시 중단
athena execute stop <proposal-id>

# 롤백 실행
athena rollback <proposal-id>

# 강제 롤백 (확인 없이)
athena rollback <proposal-id> --force
```

### 재협의 강제 (Force Remeeting)

```bash
# 운영자가 직접 재협의 트리거
athena meeting force-remeeting <proposal-id> \
  --reason "추가 검토 필요: 보안 영향 미확인"

# 특정 에이전트 추가 소집
athena meeting add-agent <meeting-id> --agent security-agent
```

### 롤백 (Rollback)

```bash
# 현재 proposal 상태 확인
athena research proposals <proposal-id>

# 롤백 실행
athena rollback <proposal-id>

# 롤백 후 상태 확인
athena research proposals <proposal-id>
# Expected: status = "rolled-back"
```

---

## 문제 상황별 대응

### 에이전트 미응답으로 회의 지연

```
증상: athena meeting status → cli-agent 미응답 10분 이상

대응:
1. 기권 처리: athena meeting forfeit <meeting-id> --agent cli-agent
2. 회의 계속 진행 (cli-agent 기권으로 처리)

OR

1. 재소집: athena meeting resummon <meeting-id>
2. 재소집 후 5분 대기
3. 여전히 무응답 → 기권 처리
```

### 정족수 미달 (Quorum Failure)

```
증상: meeting_state = "pending-quorum"

대응:
1. 누락 에이전트 확인
2. 소집 재시도 (자동 3회 실패 시 운영자 알림)
3. 수동 소집: athena agent summon <proposal-id> --agent <id>
4. 여전히 미달 시 → proposal을 "on-hold"로 전환
```

### 검증 실패로 재협의 필요

```
증상: proposal_state = "remeeting"

대응:
1. 실패 원인 확인: athena verify results <proposal-id>
2. 재협의 회의 확인: athena meeting status <proposal-id>
3. 실패한 에이전트에게 원인 분석 요청
4. 회의에서 수정 계획 수립
5. 재실행: athena execute <proposal-id>
```

### 경로 위반 감지

```
증상: research_incidents 테이블에 path_violation 기록

대응:
1. 위반 내용 확인: athena audit --type path_violation
2. 에이전트 작업 즉시 중단 (자동 처리)
3. change proposal 생성 안내
4. 보안 민감 경로였다면 → 운영자 추가 검토
```

---

## 일일 점검 루틴

```bash
# 아침 점검 (5분)
athena research runs                    # 전체 현황
athena research next-actions            # 오늘 해야 할 일
athena meeting status --all-active      # 진행 중 회의

# 주간 점검 (15분)
athena report --since <last-week>       # 주간 변경 요약
athena audit --type path_violation      # 보안 위반 검토
athena research improvements            # 시스템 개선 제안
```

---

## 비상 연락 및 에스컬레이션

```
Level 1 (일반 이슈): 운영자가 직접 처리
Level 2 (보안 이슈): security-agent + 운영자 협의
Level 3 (데이터 손실 위험): 즉시 전체 실행 중단 후 검토
```
