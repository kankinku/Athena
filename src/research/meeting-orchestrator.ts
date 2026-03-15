/**
 * meeting-orchestrator.ts
 *
 * 에이전트 소집, 회의 라운드 진행, 합의 판정을 오케스트레이션한다.
 * ImpactAnalysisResult → MeetingSession 생성 → 라운드 진행 → 합의 → ExecutionPlan.
 */

import { nanoid } from "nanoid";
import type {
  AgentPositionRecord,
  AgentPositionSummary,
  AgentVote,
  ChangeWorkflowState,
  ConflictPoint,
  ConsensusType,
  ExecutionPlanRecord,
  MeetingFollowUpAction,
  MeetingSessionRecord,
  MeetingState,
} from "./contracts.js";
import { MeetingStore } from "./meeting-store.js";
import {
  assertValidMeetingTransition,
  assertValidChangeTransition,
} from "./change-workflow-state.js";
import type { ImpactAnalysisResult } from "../impact/impact-analyzer.js";
import { ExecutionGate } from "./execution-gate.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SummonResult {
  meetingId: string;
  mandatoryAgents: string[];
  conditionalAgents: string[];
  observerAgents: string[];
  responseDeadlineAt: number;
}

export interface ConsensusResult {
  consensusType: ConsensusType;
  executionPlan?: ExecutionPlanRecord;
  followUpActions: MeetingFollowUpAction[];
}

// ─── MeetingOrchestrator ──────────────────────────────────────────────────────

export class MeetingOrchestrator {
  private meetingStore: MeetingStore;
  private executionGate: ExecutionGate;

  constructor(meetingStore?: MeetingStore, executionGate?: ExecutionGate) {
    this.meetingStore = meetingStore ?? new MeetingStore();
    this.executionGate = executionGate ?? new ExecutionGate();
  }

  /**
   * 영향 분석 결과를 기반으로 에이전트를 소집하고 회의 세션을 생성한다.
   */
  summonAgents(
    proposalId: string,
    impactResult: ImpactAnalysisResult,
    responseTimeoutMs: number = 300_000, // 5분
  ): SummonResult {
    const meetingId = `mtg_${nanoid(8)}`;
    const now = Date.now();

    const mandatoryAgents = impactResult.directlyAffected.map((m) => m.ownerAgent);
    const conditionalAgents = impactResult.indirectlyAffected.map((m) => m.ownerAgent);
    const observerAgents = impactResult.observers.map((m) => m.ownerAgent);

    // 중복 제거
    const uniqueMandatory = [...new Set(mandatoryAgents)];
    const uniqueConditional = [...new Set(conditionalAgents)].filter((a) => !uniqueMandatory.includes(a));
    const uniqueObservers = [...new Set(observerAgents)].filter(
      (a) => !uniqueMandatory.includes(a) && !uniqueConditional.includes(a),
    );

    const session: MeetingSessionRecord = {
      meetingId,
      proposalId,
      state: "scheduled",
      currentRound: 1,
      mandatoryAgents: uniqueMandatory,
      conditionalAgents: uniqueConditional,
      observerAgents: uniqueObservers,
      respondedAgents: [],
      absentAgents: [],
      keyPositions: [],
      conflictPoints: [],
      followUpActions: [],
      scheduledAt: now,
      createdAt: now,
      updatedAt: now,
    };

    this.meetingStore.saveMeetingSession(session);

    return {
      meetingId,
      mandatoryAgents: uniqueMandatory,
      conditionalAgents: uniqueConditional,
      observerAgents: uniqueObservers,
      responseDeadlineAt: now + responseTimeoutMs,
    };
  }

  /**
   * 에이전트 발언을 기록하고 회의를 다음 라운드로 진행한다.
   */
  recordPosition(position: AgentPositionRecord): void {
    this.meetingStore.saveAgentPosition(position);

    // 응답 에이전트 업데이트
    const meeting = this.meetingStore.getMeetingSession(position.meetingId);
    if (meeting && !meeting.respondedAgents.includes(position.agentId)) {
      this.meetingStore.updateMeetingState(position.meetingId, meeting.state, {
        respondedAgents: [...meeting.respondedAgents, position.agentId],
      });
    }
  }

  /**
   * 회의를 다음 라운드로 진행한다.
   */
  advanceRound(meetingId: string): MeetingSessionRecord | null {
    const meeting = this.meetingStore.getMeetingSession(meetingId);
    if (!meeting) return null;

    const nextRound = meeting.currentRound + 1;
    if (nextRound > 5) return meeting; // 이미 마지막 라운드

    const nextState: MeetingState = `round-${nextRound}` as MeetingState;
    assertValidMeetingTransition(meeting.state, nextState);

    return this.meetingStore.updateMeetingState(meetingId, nextState, {
      currentRound: nextRound,
      startedAt: meeting.startedAt ?? Date.now(),
    });
  }

  /**
   * 충돌이 없으면 라운드 4를 건너뛰고 라운드 5로 진행한다.
   */
  skipToVoting(meetingId: string): MeetingSessionRecord | null {
    const meeting = this.meetingStore.getMeetingSession(meetingId);
    if (!meeting || meeting.state !== "round-3") return null;

    if (meeting.conflictPoints.length === 0) {
      // 충돌 없음 → 라운드 4 건너뛰기
      assertValidMeetingTransition("round-3", "round-5");
      return this.meetingStore.updateMeetingState(meetingId, "round-5", {
        currentRound: 5,
      });
    }

    // 충돌 있음 → 라운드 4로 정상 진행
    return this.advanceRound(meetingId);
  }

  /**
   * 라운드 5 투표 결과를 집계하고 합의를 판정한다.
   */
  evaluateConsensus(
    meetingId: string,
    proposalChangedPaths: string[],
    rollbackPlan: string,
  ): ConsensusResult {
    const meeting = this.meetingStore.getMeetingSession(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);

    // 라운드 5 투표 수집
    const votes = this.meetingStore.listAgentPositions(meetingId, 5);
    const mandatoryVotes = votes.filter((v) =>
      meeting.mandatoryAgents.includes(v.agentId),
    );

    const consensusType = this.determineConsensus(mandatoryVotes);
    const now = Date.now();

    // 합의에 따른 실행 계획 생성
    let executionPlan: ExecutionPlanRecord | undefined;
    if (consensusType === "approved" || consensusType === "conditionally-approved") {
      executionPlan = this.executionGate.createExecutionPlan(
        meeting,
        proposalChangedPaths,
        rollbackPlan,
      );
      this.meetingStore.saveExecutionPlan(executionPlan);
    }

    // 후속 작업 생성
    const followUpActions = this.buildFollowUpActions(mandatoryVotes, consensusType);

    // 회의 완료
    this.meetingStore.updateMeetingState(meetingId, "completed", {
      consensusType,
      executionPlanId: executionPlan?.executionPlanId,
      completedAt: now,
    });

    return {
      consensusType,
      executionPlan,
      followUpActions,
    };
  }

  /**
   * 타임아웃된 에이전트를 기권 처리한다.
   */
  forfeitAbsentAgents(meetingId: string, agentIds: string[]): MeetingSessionRecord | null {
    const meeting = this.meetingStore.getMeetingSession(meetingId);
    if (!meeting) return null;

    const newAbsent = [...new Set([...meeting.absentAgents, ...agentIds])];
    return this.meetingStore.updateMeetingState(meetingId, meeting.state, {
      absentAgents: newAbsent,
    });
  }

  /**
   * 충돌 포인트를 추가한다.
   */
  addConflict(meetingId: string, conflict: ConflictPoint): void {
    const meeting = this.meetingStore.getMeetingSession(meetingId);
    if (!meeting) return;

    const updated: MeetingSessionRecord = {
      ...meeting,
      conflictPoints: [...meeting.conflictPoints, conflict],
    };
    this.meetingStore.saveMeetingSession(updated);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private determineConsensus(mandatoryVotes: AgentPositionRecord[]): ConsensusType {
    if (mandatoryVotes.length === 0) return "on-hold";

    const voteMap = new Map<AgentVote, number>();
    for (const v of mandatoryVotes) {
      const vote = v.vote ?? "abstain";
      voteMap.set(vote, (voteMap.get(vote) ?? 0) + 1);
    }

    const rejects = voteMap.get("reject") ?? 0;
    const holds = voteMap.get("hold") ?? 0;
    const approves = voteMap.get("approve") ?? 0;
    const conditionals = voteMap.get("conditionally_approve") ?? 0;
    const splits = voteMap.get("split") ?? 0;

    // 거절이 하나라도 있으면 → rejected
    if (rejects > 0) return "rejected";

    // 보류가 있고 거절이 없으면 → on-hold
    if (holds > 0) return "on-hold";

    // 분할 제안이 있으면 → split-execution
    if (splits > 0) return "split-execution";

    // 조건부 승인이 있으면 → conditionally-approved
    if (conditionals > 0) return "conditionally-approved";

    // 전원 승인 → approved
    if (approves === mandatoryVotes.length) return "approved";

    // 과반 승인 → approved
    if (approves > mandatoryVotes.length / 2) return "approved";

    return "on-hold";
  }

  private buildFollowUpActions(
    votes: AgentPositionRecord[],
    consensusType: ConsensusType,
  ): MeetingFollowUpAction[] {
    const actions: MeetingFollowUpAction[] = [];

    // 조건부 승인 → 조건 충족 확인 작업 생성
    for (const vote of votes) {
      if (vote.vote === "conditionally_approve" && vote.approvalCondition) {
        actions.push({
          actionId: `act_${nanoid(6)}`,
          description: vote.approvalCondition,
          assignedAgent: vote.agentId,
          status: "pending",
        });
      }

      // 필요 변경 → 실행 작업 생성
      for (const change of vote.requiredChanges) {
        actions.push({
          actionId: `act_${nanoid(6)}`,
          description: change,
          assignedAgent: vote.agentId,
          status: "pending",
        });
      }
    }

    return actions;
  }
}
