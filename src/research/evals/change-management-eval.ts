/**
 * change-management-eval.ts
 *
 * 모듈 협의 시스템의 품질을 측정하는 eval 프레임워크.
 * OpenAI 가이드 권고: decisions, tool calls, reasoning steps를
 * trace grading과 eval로 점검.
 *
 * 측정 항목:
 * 1. 소집 정확도 (필요한 에이전트만 소집되었는지)
 * 2. 승인 우회 감지 (critical 변경이 회의 없이 실행되었는지)
 * 3. 불필요한 수정 감지 (범위 외 파일 수정 시도)
 * 4. 회의 품질 (합의 도달률, 평균 라운드, 충돌 해결률)
 * 5. 검증 통과율 (1차 검증 통과 비율)
 */

import type { MeetingSessionRecord, VerificationResult } from "../contracts.js";
import type { ImpactAnalysisResult } from "../../impact/impact-analyzer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalMetric {
  name: string;
  value: number;
  target: number;
  passed: boolean;
  details?: string;
}

export interface ChangeManagementEvalResult {
  timestamp: number;
  metrics: EvalMetric[];
  overallScore: number;
  passed: boolean;
}

// ─── Eval Functions ───────────────────────────────────────────────────────────

/**
 * 소집 정확도: 영향 분석 결과 대비 실제 소집된 에이전트.
 *
 * precision = 소집된 에이전트 중 실제 필요했던 비율
 * recall = 필요한 에이전트 중 실제 소집된 비율
 */
export function evalSummonAccuracy(
  impactResult: ImpactAnalysisResult,
  meeting: MeetingSessionRecord,
): EvalMetric[] {
  const requiredAgents = new Set([
    ...impactResult.directlyAffected.map((m) => m.ownerAgent),
  ]);
  const actualSummoned = new Set([
    ...meeting.mandatoryAgents,
    ...meeting.conditionalAgents,
  ]);

  const truePositives = [...requiredAgents].filter((a) => actualSummoned.has(a)).length;
  const precision = actualSummoned.size > 0 ? truePositives / actualSummoned.size : 1;
  const recall = requiredAgents.size > 0 ? truePositives / requiredAgents.size : 1;

  return [
    {
      name: "summon-precision",
      value: precision,
      target: 1.0,
      passed: precision >= 0.8,
      details: `${truePositives}/${actualSummoned.size} summoned agents were necessary`,
    },
    {
      name: "summon-recall",
      value: recall,
      target: 1.0,
      passed: recall >= 1.0, // 필요한 에이전트 누락은 용납 불가
      details: `${truePositives}/${requiredAgents.size} necessary agents were summoned`,
    },
  ];
}

/**
 * 회의 품질: 합의 도달 여부, 라운드 수, 충돌 해결률.
 */
export function evalMeetingQuality(
  meetings: MeetingSessionRecord[],
): EvalMetric[] {
  if (meetings.length === 0) {
    return [{ name: "meeting-quality", value: 0, target: 0.8, passed: true, details: "No meetings to evaluate" }];
  }

  const completed = meetings.filter((m) => m.state === "completed");
  const consensusRate = completed.length / meetings.length;

  const avgRounds = completed.reduce((sum, m) => sum + m.currentRound, 0) / (completed.length || 1);

  const conflictMeetings = meetings.filter((m) => m.conflictPoints.length > 0);
  const resolvedConflicts = conflictMeetings.filter((m) =>
    m.conflictPoints.every((c) => c.resolvedAt !== undefined),
  );
  const conflictResolutionRate = conflictMeetings.length > 0
    ? resolvedConflicts.length / conflictMeetings.length
    : 1;

  return [
    {
      name: "consensus-rate",
      value: consensusRate,
      target: 0.8,
      passed: consensusRate >= 0.8,
      details: `${completed.length}/${meetings.length} meetings reached consensus`,
    },
    {
      name: "avg-meeting-rounds",
      value: avgRounds,
      target: 5,
      passed: avgRounds <= 5,
      details: `Average ${avgRounds.toFixed(1)} rounds per meeting`,
    },
    {
      name: "conflict-resolution-rate",
      value: conflictResolutionRate,
      target: 0.8,
      passed: conflictResolutionRate >= 0.8,
      details: `${resolvedConflicts.length}/${conflictMeetings.length} conflict meetings fully resolved`,
    },
  ];
}

/**
 * 검증 통과율: 1차 검증에서 통과한 비율.
 */
export function evalVerificationPassRate(
  results: VerificationResult[],
): EvalMetric {
  if (results.length === 0) {
    return { name: "first-pass-rate", value: 1, target: 0.7, passed: true, details: "No verifications" };
  }

  const passed = results.filter((r) => r.overallOutcome === "passed");
  const rate = passed.length / results.length;

  return {
    name: "first-pass-rate",
    value: rate,
    target: 0.7,
    passed: rate >= 0.7,
    details: `${passed.length}/${results.length} verifications passed on first attempt`,
  };
}

/**
 * 전체 eval을 실행하고 종합 결과를 반환한다.
 */
export function runChangeManagementEval(
  meetings: MeetingSessionRecord[],
  verifications: VerificationResult[],
  impactResults?: Array<{ impact: ImpactAnalysisResult; meeting: MeetingSessionRecord }>,
): ChangeManagementEvalResult {
  const metrics: EvalMetric[] = [];

  // 회의 품질
  metrics.push(...evalMeetingQuality(meetings));

  // 검증 통과율
  metrics.push(evalVerificationPassRate(verifications));

  // 소집 정확도 (impact-meeting 쌍이 제공된 경우)
  if (impactResults) {
    for (const { impact, meeting } of impactResults) {
      metrics.push(...evalSummonAccuracy(impact, meeting));
    }
  }

  const overallScore = metrics.length > 0
    ? metrics.filter((m) => m.passed).length / metrics.length
    : 1;

  return {
    timestamp: Date.now(),
    metrics,
    overallScore,
    passed: metrics.every((m) => m.passed),
  };
}
