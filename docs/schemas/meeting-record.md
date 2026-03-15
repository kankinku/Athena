# 회의 기록 스키마 (Meeting Record Schema)

이 문서는 에이전트 회의 세션의 저장 형식을 TypeScript 타입과 DB 스키마 두 가지 형태로 정의한다.

---

## TypeScript 타입 정의

```typescript
// src/research/contracts.ts에 추가 예정

// ─── Meeting Session ──────────────────────────────────────────────────────────

export type MeetingState =
  | "scheduled"       // 소집 완료, 시작 대기
  | "pending-quorum"  // 정족수 미달
  | "round-1"         // 라운드 1: 제안 요약
  | "round-2"         // 라운드 2: 영향 평가
  | "round-3"         // 라운드 3: 충돌 지점 정리
  | "round-4"         // 라운드 4: 대안 비교
  | "round-5"         // 라운드 5: 합의 투표
  | "completed"       // 합의 완료
  | "on-hold"         // 보류
  | "failed";         // 오류/타임아웃

export type ConsensusType =
  | "approved"
  | "conditionally-approved"
  | "split-execution"
  | "experiment-first"
  | "on-hold"
  | "rejected";

export interface MeetingSession {
  meetingId: string;           // "mtg_" 접두사
  proposalId: string;          // 연결된 change proposal
  state: MeetingState;
  currentRound: number;        // 1-5

  // 참석자
  mandatoryAgents: string[];   // 필수 참석 에이전트 ID 목록
  conditionalAgents: string[]; // 조건부 참석 에이전트 목록
  observerAgents: string[];    // 참관 에이전트 목록
  respondedAgents: string[];   // 실제 응답한 에이전트 목록
  absentAgents: string[];      // 미응답/기권 처리된 에이전트

  // 주요 발언 요약
  keyPositions: AgentPositionSummary[];

  // 충돌 포인트
  conflictPoints: ConflictPoint[];

  // 합의 결과
  consensusType?: ConsensusType;
  consensusReachedAt?: number;
  executionPlanId?: string;     // 생성된 실행 계획 ID

  // 후속 작업
  followUpActions: FollowUpAction[];

  // 타임스탬프
  scheduledAt: number;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Agent Position ───────────────────────────────────────────────────────────

export type AgentVote = "approve" | "conditionally_approve" | "split" | "hold" | "reject" | "abstain";

export interface AgentPositionRecord {
  positionId: string;           // "pos_" 접두사
  meetingId: string;
  agentId: string;
  moduleId: string;
  round: number;

  // 라운드 2 필드
  position: "support" | "neutral" | "concern" | "oppose";
  impact: string;               // 영향 설명
  risk: string;                 // 위험도 설명
  requiredChanges: string[];    // 필요 변경 목록

  // 라운드 5 필드
  vote?: AgentVote;
  approvalCondition?: string;

  // 공통
  notes?: string;
  createdAt: number;
}

export interface AgentPositionSummary {
  agentId: string;
  moduleId: string;
  position: "support" | "neutral" | "concern" | "oppose";
  vote?: AgentVote;
  keyPoints: string[];          // 핵심 발언 요약 (1-3개)
}

// ─── Conflict Point ───────────────────────────────────────────────────────────

export type ConflictType =
  | "interface-conflict"
  | "schedule-conflict"
  | "test-risk"
  | "security-priority"
  | "resource-conflict"
  | "scope-disagreement";

export interface ConflictPoint {
  conflictId: string;
  conflictType: ConflictType;
  description: string;
  involvedAgents: string[];     // 충돌 당사자 에이전트
  proposedResolutions: string[]; // 제안된 해결 방안
  resolvedAt?: number;
  resolutionNotes?: string;
}

// ─── Approval Condition ───────────────────────────────────────────────────────

export interface ApprovalCondition {
  conditionId: string;          // "cond_" 접두사
  meetingId: string;
  proposalId: string;
  requiredBy: string;           // 조건을 요구한 에이전트
  condition: string;            // 조건 설명
  verificationMethod: string;   // 조건 달성 확인 방법
  verifiedBy?: string;          // 확인 담당자
  status: "pending" | "verified" | "waived" | "failed";
  verifiedAt?: number;
  createdAt: number;
}

// ─── Follow-Up Action ─────────────────────────────────────────────────────────

export interface FollowUpAction {
  actionId: string;
  description: string;
  assignedAgent: string;
  dueAt?: number;
  status: "pending" | "completed" | "cancelled";
}
```

---

## DB 스키마 (Migration v20에 포함)

```sql
-- 회의 세션
CREATE TABLE IF NOT EXISTS meeting_sessions (
  id TEXT PRIMARY KEY,                    -- meetingId
  proposal_id TEXT NOT NULL,              -- 연결된 change proposal
  state TEXT NOT NULL DEFAULT 'scheduled',
  current_round INTEGER NOT NULL DEFAULT 1,
  mandatory_agents_json TEXT NOT NULL DEFAULT '[]',
  conditional_agents_json TEXT NOT NULL DEFAULT '[]',
  observer_agents_json TEXT NOT NULL DEFAULT '[]',
  responded_agents_json TEXT NOT NULL DEFAULT '[]',
  absent_agents_json TEXT NOT NULL DEFAULT '[]',
  conflict_points_json TEXT,
  consensus_type TEXT,
  execution_plan_id TEXT,
  follow_up_actions_json TEXT,
  scheduled_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES proposal_briefs(id)
);
CREATE INDEX IF NOT EXISTS idx_meeting_sessions_proposal
  ON meeting_sessions(proposal_id, updated_at);

-- 에이전트 발언 기록
CREATE TABLE IF NOT EXISTS agent_positions (
  id TEXT PRIMARY KEY,                    -- positionId
  meeting_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  position TEXT NOT NULL,                 -- support/neutral/concern/oppose
  impact TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT '',
  required_changes_json TEXT NOT NULL DEFAULT '[]',
  vote TEXT,                              -- approve/conditionally_approve/split/hold/reject/abstain
  approval_condition TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (meeting_id) REFERENCES meeting_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_agent_positions_meeting
  ON agent_positions(meeting_id, round, agent_id);

-- 승인 조건
CREATE TABLE IF NOT EXISTS approval_conditions (
  id TEXT PRIMARY KEY,                    -- conditionId
  meeting_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  required_by TEXT NOT NULL,
  condition_text TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  verified_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (meeting_id) REFERENCES meeting_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_approval_conditions_meeting
  ON approval_conditions(meeting_id, status);

-- 실행 계획
CREATE TABLE IF NOT EXISTS execution_plans (
  id TEXT PRIMARY KEY,                    -- executionPlanId
  proposal_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  task_assignments_json TEXT NOT NULL,    -- [{agentId, moduleId, tasks[]}]
  required_tests_json TEXT NOT NULL,
  rollback_plan TEXT NOT NULL,
  feature_flags_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES proposal_briefs(id)
);
CREATE INDEX IF NOT EXISTS idx_execution_plans_proposal
  ON execution_plans(proposal_id, status);
```

---

## 예시 회의 기록

```json
{
  "meetingId": "mtg_a7x3k2",
  "proposalId": "cp_x8f2k9m",
  "state": "completed",
  "currentRound": 5,
  "mandatoryAgents": ["store-agent", "research-agent"],
  "conditionalAgents": ["cli-agent"],
  "observerAgents": ["ui-agent"],
  "respondedAgents": ["store-agent", "research-agent", "cli-agent"],
  "absentAgents": [],
  "keyPositions": [
    {
      "agentId": "store-agent",
      "moduleId": "store",
      "position": "support",
      "vote": "approve",
      "keyPoints": ["마이그레이션 v20 준비됨", "롤백 계획 확인됨"]
    },
    {
      "agentId": "research-agent",
      "moduleId": "research",
      "position": "support",
      "vote": "conditionally_approve",
      "keyPoints": ["MeetingStore 추가 작업 필요"]
    }
  ],
  "conflictPoints": [],
  "consensusType": "conditionally-approved",
  "consensusReachedAt": 1710500000000,
  "followUpActions": [
    {
      "actionId": "act_001",
      "description": "research-agent가 MeetingStore 추가 구현",
      "assignedAgent": "research-agent",
      "status": "pending"
    }
  ]
}
```
