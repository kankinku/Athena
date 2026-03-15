/**
 * agent-event-bus.ts
 *
 * 실시간 에이전트 통신 시스템:
 *  1. EventEmitter 기반 비동기 메시지 버스
 *  2. 응답 대기 + 타임아웃 + 자동 에스컬레이션
 *  3. 비동기 라운드 진행 (응답 도착 순서대로 처리)
 *
 * spec §4.5: 라운드별 에이전트 응답 비동기 수신
 *       §4.6: 타임아웃 시 기권 처리 + operator 알림
 */

import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type {
  AgentPositionRecord,
  AgentPositionStance,
  MeetingState,
} from "./contracts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentEventType =
  | "agent:response"       // 에이전트 발언 도착
  | "agent:timeout"        // 에이전트 응답 타임아웃
  | "agent:forfeit"        // 기권 처리됨
  | "round:ready"          // 라운드 진행 준비 완료
  | "round:advance"        // 다음 라운드로 진행
  | "meeting:quorum"       // 정족수 충족
  | "meeting:escalate"     // operator 에스컬레이션
  | "meeting:complete"     // 회의 완료
  | "broadcast";           // 전체 공지

export interface AgentEvent {
  eventId: string;
  type: AgentEventType;
  meetingId: string;
  agentId?: string;
  round?: number;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface ResponseWaiter {
  meetingId: string;
  round: number;
  expectedAgents: string[];
  receivedAgents: Set<string>;
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (responses: AgentPositionRecord[]) => void;
}

export interface AgentEventBusOptions {
  /** 기본 응답 타임아웃 (ms). 기본 5분 */
  defaultTimeoutMs?: number;
  /** 정족수 비율 (0~1). 기본 0.5 */
  quorumRatio?: number;
  /** 타임아웃 시 operator에게 알림 */
  onEscalate?: (event: AgentEvent) => void;
}

// ─── AgentEventBus ────────────────────────────────────────────────────────────

export class AgentEventBus extends EventEmitter {
  private waiters = new Map<string, ResponseWaiter>();
  private responses = new Map<string, AgentPositionRecord[]>();
  private defaultTimeoutMs: number;
  private quorumRatio: number;
  private onEscalate?: (event: AgentEvent) => void;

  constructor(options: AgentEventBusOptions = {}) {
    super();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300_000;
    this.quorumRatio = options.quorumRatio ?? 0.5;
    this.onEscalate = options.onEscalate;
  }

  // ─── 메시지 발행 ─────────────────────────────────────────────────────────────

  /**
   * 이벤트를 발행한다. 모든 리스너에게 전달.
   */
  publish(event: AgentEvent): void {
    this.emit(event.type, event);
    this.emit("*", event); // catch-all
  }

  /**
   * 에이전트 응답을 수신 처리한다.
   */
  receiveResponse(position: AgentPositionRecord): void {
    const key = waiterKey(position.meetingId, position.round);

    // 응답 저장
    const existing = this.responses.get(key) ?? [];
    existing.push(position);
    this.responses.set(key, existing);

    // 이벤트 발행
    this.publish({
      eventId: `evt_${nanoid(8)}`,
      type: "agent:response",
      meetingId: position.meetingId,
      agentId: position.agentId,
      round: position.round,
      payload: {
        moduleId: position.moduleId,
        stance: position.position,
        vote: position.vote,
      },
      timestamp: Date.now(),
    });

    // 대기 중인 waiter가 있으면 진행 체크
    const waiter = this.waiters.get(key);
    if (waiter) {
      waiter.receivedAgents.add(position.agentId);
      this.checkRoundProgress(waiter);
    }
  }

  // ─── 응답 대기 ──────────────────────────────────────────────────────────────

  /**
   * 특정 라운드의 모든 에이전트 응답을 대기한다.
   * 타임아웃 시 수신된 응답만 반환하고, 미응답 에이전트는 기권 처리.
   */
  waitForResponses(
    meetingId: string,
    round: number,
    expectedAgents: string[],
    timeoutMs?: number,
  ): Promise<AgentPositionRecord[]> {
    const key = waiterKey(meetingId, round);
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    // 이미 수신된 응답 확인
    const existing = this.responses.get(key) ?? [];
    const alreadyReceived = new Set(existing.map((r) => r.agentId));
    const allReceived = expectedAgents.every((a) => alreadyReceived.has(a));
    if (allReceived) {
      return Promise.resolve(existing);
    }

    return new Promise<AgentPositionRecord[]>((resolve) => {
      const waiter: ResponseWaiter = {
        meetingId,
        round,
        expectedAgents,
        receivedAgents: alreadyReceived,
        timeoutMs: timeout,
        timer: null,
        resolve,
      };

      // 타임아웃 설정
      waiter.timer = setTimeout(() => {
        this.handleTimeout(waiter);
      }, timeout);

      this.waiters.set(key, waiter);
    });
  }

  // ─── 브로드캐스트 ───────────────────────────────────────────────────────────

  /**
   * 회의 참여 에이전트 전체에게 공지를 보낸다.
   */
  broadcast(meetingId: string, message: string, metadata?: Record<string, unknown>): void {
    this.publish({
      eventId: `evt_${nanoid(8)}`,
      type: "broadcast",
      meetingId,
      payload: { message, ...metadata },
      timestamp: Date.now(),
    });
  }

  // ─── 상태 조회 ──────────────────────────────────────────────────────────────

  /**
   * 특정 라운드의 수신된 응답 목록
   */
  getResponses(meetingId: string, round: number): AgentPositionRecord[] {
    return this.responses.get(waiterKey(meetingId, round)) ?? [];
  }

  /**
   * 미응답 에이전트 목록
   */
  getPendingAgents(meetingId: string, round: number, expectedAgents: string[]): string[] {
    const received = new Set(
      (this.responses.get(waiterKey(meetingId, round)) ?? []).map((r) => r.agentId),
    );
    return expectedAgents.filter((a) => !received.has(a));
  }

  /**
   * 정족수 충족 여부
   */
  hasQuorum(meetingId: string, round: number, totalExpected: number): boolean {
    const received = this.responses.get(waiterKey(meetingId, round)) ?? [];
    return received.length >= Math.ceil(totalExpected * this.quorumRatio);
  }

  // ─── 정리 ───────────────────────────────────────────────────────────────────

  /**
   * 특정 회의의 모든 리소스 해제
   */
  cleanup(meetingId: string): void {
    for (const [key, waiter] of this.waiters) {
      if (waiter.meetingId === meetingId) {
        if (waiter.timer) clearTimeout(waiter.timer);
        this.waiters.delete(key);
      }
    }
    for (const key of this.responses.keys()) {
      if (key.startsWith(`${meetingId}:`)) {
        this.responses.delete(key);
      }
    }
  }

  /**
   * 모든 대기 해제
   */
  dispose(): void {
    for (const waiter of this.waiters.values()) {
      if (waiter.timer) clearTimeout(waiter.timer);
    }
    this.waiters.clear();
    this.responses.clear();
    this.removeAllListeners();
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private checkRoundProgress(waiter: ResponseWaiter): void {
    const allReceived = waiter.expectedAgents.every((a) => waiter.receivedAgents.has(a));
    const quorumMet = waiter.receivedAgents.size >=
      Math.ceil(waiter.expectedAgents.length * this.quorumRatio);

    if (allReceived) {
      // 전원 응답 완료
      this.resolveWaiter(waiter);
    } else if (quorumMet) {
      // 정족수 충족 → 이벤트 발행 (아직 대기는 유지)
      this.publish({
        eventId: `evt_${nanoid(8)}`,
        type: "meeting:quorum",
        meetingId: waiter.meetingId,
        round: waiter.round,
        payload: {
          received: waiter.receivedAgents.size,
          expected: waiter.expectedAgents.length,
          pending: waiter.expectedAgents.filter((a) => !waiter.receivedAgents.has(a)),
        },
        timestamp: Date.now(),
      });
    }
  }

  private handleTimeout(waiter: ResponseWaiter): void {
    const key = waiterKey(waiter.meetingId, waiter.round);
    const pending = waiter.expectedAgents.filter((a) => !waiter.receivedAgents.has(a));

    // 미응답 에이전트 기권 이벤트
    for (const agentId of pending) {
      const event: AgentEvent = {
        eventId: `evt_${nanoid(8)}`,
        type: "agent:timeout",
        meetingId: waiter.meetingId,
        agentId,
        round: waiter.round,
        payload: { timeoutMs: waiter.timeoutMs },
        timestamp: Date.now(),
      };
      this.publish(event);
    }

    // 정족수 미충족 시 에스컬레이션
    const hasQuorum = waiter.receivedAgents.size >=
      Math.ceil(waiter.expectedAgents.length * this.quorumRatio);

    if (!hasQuorum) {
      const escalateEvent: AgentEvent = {
        eventId: `evt_${nanoid(8)}`,
        type: "meeting:escalate",
        meetingId: waiter.meetingId,
        round: waiter.round,
        payload: {
          reason: "quorum_not_met_after_timeout",
          received: waiter.receivedAgents.size,
          expected: waiter.expectedAgents.length,
          pendingAgents: pending,
        },
        timestamp: Date.now(),
      };
      this.publish(escalateEvent);
      this.onEscalate?.(escalateEvent);
    }

    // 수신된 응답만으로 resolve
    this.resolveWaiter(waiter);
  }

  private resolveWaiter(waiter: ResponseWaiter): void {
    const key = waiterKey(waiter.meetingId, waiter.round);
    if (waiter.timer) clearTimeout(waiter.timer);
    this.waiters.delete(key);

    const responses = this.responses.get(key) ?? [];
    waiter.resolve(responses);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function waiterKey(meetingId: string, round: number): string {
  return `${meetingId}:r${round}`;
}
