/**
 * change-pipeline.ts
 *
 * 12개 plane을 end-to-end로 연결하는 중앙 오케스트레이터.
 *
 * 전체 흐름 (spec §15):
 *   change detected
 *   → impact analysis         (Impact Analysis Plane)
 *   → affected owner summon   (Deliberation Plane)
 *   → structured meeting      (Deliberation Plane)
 *   → decision contract       (Decision Contract Plane)
 *   → module-bounded execution (Execution Plane)
 *   → affected-only verification (Verification Plane)
 *   → owner approval          (Governance Plane + Operator Plane)
 *   → merge or remeeting      (Control Plane)
 */

import { nanoid } from "nanoid";
import type {
  AuditEvent,
  ChangeWorkflowState,
  ExecutionPlanRecord,
  MeetingSessionRecord,
  PipelineStageRecord,
  VerificationResult,
} from "./contracts.js";
import { assertValidChangeTransition } from "./change-workflow-state.js";
import { ChangeProposalStore, type ChangeProposalRecord } from "./change-proposal-store.js";
import { ImpactAnalyzer, type ImpactAnalysisResult } from "../impact/impact-analyzer.js";
import { MeetingOrchestrator } from "./meeting-orchestrator.js";
import { MeetingStore } from "./meeting-store.js";
import { ExecutionGate } from "./execution-gate.js";
import { VerificationPipeline } from "./verification-pipeline.js";
import { AuditEventStore } from "./audit-event-store.js";
import { PipelineStore } from "./pipeline-store.js";
import { BudgetEnforcer } from "./budget-enforcer.js";
import type { ToolApprovalGate } from "../security/tool-approval.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineContext {
  pipelineId: string;
  proposalId: string;
  sessionId: string;
  stages: PipelineStageRecord[];
  currentState: ChangeWorkflowState;
  impactResult?: ImpactAnalysisResult;
  meetingId?: string;
  meetingResult?: MeetingSessionRecord;
  executionPlan?: ExecutionPlanRecord;
  verificationResult?: VerificationResult;
  auditTrail: AuditEvent[];
}

export interface PipelineOptions {
  autoExecute?: boolean;        // 자동 실행 허용 여부 (default: false)
  rollbackPlan?: string;        // 롤백 계획 (필수)
  operatorId?: string;          // 운영자 ID
  timeoutMs?: number;           // 파이프라인 전체 타임아웃
}

// ─── ChangePipeline ───────────────────────────────────────────────────────────

export class ChangePipeline {
  private proposalStore: ChangeProposalStore;
  private impactAnalyzer: ImpactAnalyzer;
  private meetingOrchestrator: MeetingOrchestrator;
  private meetingStore: MeetingStore;
  private executionGate: ExecutionGate;
  private verificationPipeline: VerificationPipeline;
  private toolApprovalGate?: ToolApprovalGate;
  private auditEventStore: AuditEventStore;
  private pipelineStore: PipelineStore;
  private budgetEnforcer: BudgetEnforcer;

  constructor(deps?: {
    proposalStore?: ChangeProposalStore;
    impactAnalyzer?: ImpactAnalyzer;
    meetingOrchestrator?: MeetingOrchestrator;
    meetingStore?: MeetingStore;
    executionGate?: ExecutionGate;
    verificationPipeline?: VerificationPipeline;
    toolApprovalGate?: ToolApprovalGate;
    auditEventStore?: AuditEventStore;
    pipelineStore?: PipelineStore;
    budgetEnforcer?: BudgetEnforcer;
  }) {
    this.proposalStore = deps?.proposalStore ?? new ChangeProposalStore();
    this.impactAnalyzer = deps?.impactAnalyzer ?? new ImpactAnalyzer();
    this.meetingStore = deps?.meetingStore ?? new MeetingStore();
    this.meetingOrchestrator = deps?.meetingOrchestrator ?? new MeetingOrchestrator(this.meetingStore);
    this.executionGate = deps?.executionGate ?? new ExecutionGate();
    this.verificationPipeline = deps?.verificationPipeline ?? new VerificationPipeline();
    this.toolApprovalGate = deps?.toolApprovalGate;
    this.auditEventStore = deps?.auditEventStore ?? new AuditEventStore();
    this.pipelineStore = deps?.pipelineStore ?? new PipelineStore();
    this.budgetEnforcer = deps?.budgetEnforcer ?? new BudgetEnforcer({ auditStore: this.auditEventStore });
  }

  /**
   * Stage 1: Impact Analysis
   * 변경된 파일 목록으로부터 영향 모듈을 계산한다.
   */
  analyzeImpact(ctx: PipelineContext): PipelineContext {
    const stage = this.startStage(ctx, "impact");
    try {
      const proposal = this.proposalStore.get(ctx.proposalId);
      if (!proposal) throw new Error(`Proposal not found: ${ctx.proposalId}`);

      const result = this.impactAnalyzer.analyze(proposal.changedPaths);
      ctx.impactResult = result;

      // proposal에 영향도 결과 저장
      this.proposalStore.applyImpactAnalysis(ctx.proposalId, {
        directlyAffectedModules: result.directlyAffected.map((m) => ({
          moduleId: m.moduleId,
          impactLevel: "direct" as const,
          impactReason: m.impactReason,
          affectedInterfaces: m.affectedInterfaces,
        })),
        indirectlyAffectedModules: result.indirectlyAffected.map((m) => ({
          moduleId: m.moduleId,
          impactLevel: "indirect" as const,
          impactReason: m.impactReason,
          affectedInterfaces: m.affectedInterfaces,
        })),
        observerModules: result.observers.map((m) => ({
          moduleId: m.moduleId,
          impactLevel: "observer" as const,
          impactReason: m.impactReason,
          affectedInterfaces: m.affectedInterfaces,
        })),
        requiredAgents: result.allAffected.map((m) => m.ownerAgent),
        meetingRequired: result.meetingRequired,
        meetingRequiredReason: result.meetingRequiredReason,
      });

      this.transition(ctx, "impact-analyzed");
      this.completeStage(stage);
      this.audit(ctx, "impact_analyzed", {
        directCount: result.directlyAffected.length,
        indirectCount: result.indirectlyAffected.length,
        meetingRequired: result.meetingRequired,
      });
      this.checkpoint(ctx);
    } catch (e) {
      this.failStage(stage, e);
      this.transition(ctx, "failed");
      this.checkpoint(ctx);
    }
    return ctx;
  }

  /**
   * Stage 2: Agent Summon
   * 영향 분석 결과를 기반으로 에이전트를 소집한다.
   */
  summonAgents(ctx: PipelineContext): PipelineContext {
    const stage = this.startStage(ctx, "summon");
    try {
      if (!ctx.impactResult) throw new Error("Impact analysis required before summoning");

      if (!ctx.impactResult.meetingRequired) {
        // 회의 불필요 → 바로 agreed로 전환 (단일 모듈 내부 변경)
        this.transition(ctx, "agents-summoned");
        this.transition(ctx, "in-meeting");
        this.transition(ctx, "agreed");
        this.completeStage(stage);
        this.audit(ctx, "meeting_skipped", { reason: ctx.impactResult.meetingRequiredReason });
        return ctx;
      }

      const summonResult = this.meetingOrchestrator.summonAgents(
        ctx.proposalId,
        ctx.impactResult,
      );
      ctx.meetingId = summonResult.meetingId;

      this.transition(ctx, "agents-summoned");
      this.completeStage(stage);
      this.audit(ctx, "agents_summoned", {
        meetingId: summonResult.meetingId,
        mandatory: summonResult.mandatoryAgents,
        conditional: summonResult.conditionalAgents,
      });
      this.checkpoint(ctx);
    } catch (e) {
      this.failStage(stage, e);
      this.transition(ctx, "failed");
      this.checkpoint(ctx);
    }
    return ctx;
  }

  /**
   * Stage 3: Structured Meeting
   * 회의 진행을 시작한다. 실제 라운드 진행은 에이전트 응답에 따라 비동기로 진행됨.
   */
  startMeeting(ctx: PipelineContext): PipelineContext {
    const stage = this.startStage(ctx, "meeting");
    try {
      if (!ctx.meetingId) {
        // 회의 없이 진행된 경우 (단일 모듈)
        this.completeStage(stage);
        return ctx;
      }

      this.transition(ctx, "in-meeting");
      this.audit(ctx, "meeting_started", { meetingId: ctx.meetingId });

      // 회의 자체는 비동기로 진행됨 — MeetingOrchestrator가 라운드별로 관리
      // 이 단계는 meeting이 completed 될 때까지 대기하는 entry point
      this.completeStage(stage);
      this.checkpoint(ctx);
    } catch (e) {
      this.failStage(stage, e);
      this.transition(ctx, "failed");
      this.checkpoint(ctx);
    }
    return ctx;
  }

  /**
   * Stage 4: Decision Contract
   * 회의 합의 결과를 실행 계획으로 변환한다.
   */
  buildDecisionContract(
    ctx: PipelineContext,
    options: PipelineOptions,
  ): PipelineContext {
    const stage = this.startStage(ctx, "decision");
    try {
      if (ctx.meetingId) {
        const meeting = this.meetingStore.getMeetingSession(ctx.meetingId);
        if (!meeting || meeting.state !== "completed") {
          throw new Error(`Meeting ${ctx.meetingId} is not completed: ${meeting?.state}`);
        }
        ctx.meetingResult = meeting;

        if (!meeting.consensusType || meeting.consensusType === "rejected") {
          this.transition(ctx, "rejected");
          this.completeStage(stage);
          this.audit(ctx, "proposal_rejected", { consensusType: meeting.consensusType });
          return ctx;
        }

        if (meeting.consensusType === "on-hold") {
          this.transition(ctx, "on-hold");
          this.completeStage(stage);
          return ctx;
        }
      }

      // 실행 계획 생성 (ExecutionGate)
      const proposal = this.proposalStore.get(ctx.proposalId);
      if (!proposal) throw new Error(`Proposal not found: ${ctx.proposalId}`);

      if (ctx.meetingResult) {
        const plan = this.executionGate.createExecutionPlan(
          ctx.meetingResult,
          proposal.changedPaths,
          options.rollbackPlan ?? "git reset --hard HEAD~1",
        );
        this.meetingStore.saveExecutionPlan(plan);
        ctx.executionPlan = plan;
      }

      this.transition(ctx, "agreed");
      this.completeStage(stage);
      this.audit(ctx, "decision_contract_created", {
        executionPlanId: ctx.executionPlan?.executionPlanId,
      });
      this.checkpoint(ctx);
    } catch (e) {
      this.failStage(stage, e);
      this.checkpoint(ctx);
    }
    return ctx;
  }

  /**
   * Stage 5: Module-Bounded Execution
   * 실행 게이트 검사 후 실행을 시작한다.
   */
  execute(ctx: PipelineContext, options: PipelineOptions): PipelineContext {
    const stage = this.startStage(ctx, "execution");
    try {
      if (!ctx.executionPlan) {
        throw new Error("No execution plan — cannot execute");
      }

      // 게이트 검사
      const gateResult = this.executionGate.runGateChecks(
        ctx.executionPlan,
        ctx.currentState,
      );

      if (!gateResult.passed) {
        this.audit(ctx, "execution_gate_blocked", {
          blockers: gateResult.blockers,
        });
        throw new Error(`Execution gate blocked: ${gateResult.blockers.join(", ")}`);
      }

      this.transition(ctx, "executing");
      this.meetingStore.updateExecutionPlanStatus(
        ctx.executionPlan.executionPlanId,
        "in-progress",
        { startedAt: Date.now() },
      );

      // 각 TaskAssignment에 대해 예산 추적 시작
      for (const task of ctx.executionPlan.taskAssignments) {
        if (task.budget) {
          const taskId = `task_${task.moduleId}_${ctx.pipelineId}`;
          this.budgetEnforcer.startTracking(
            taskId,
            ctx.proposalId,
            task.moduleId,
            task.agentId,
            task.budget,
          );
        }
      }

      this.audit(ctx, "execution_started", {
        planId: ctx.executionPlan.executionPlanId,
        taskCount: ctx.executionPlan.taskAssignments.length,
      });
      this.completeStage(stage);
      this.checkpoint(ctx);
    } catch (e) {
      this.failStage(stage, e);
      this.transition(ctx, "failed");
      this.checkpoint(ctx);
    }
    return ctx;
  }

  /**
   * Stage 6: Affected-Only Verification
   */
  verify(ctx: PipelineContext): PipelineContext {
    const stage = this.startStage(ctx, "verification");
    try {
      if (!ctx.executionPlan || !ctx.impactResult) {
        throw new Error("Execution plan and impact result required for verification");
      }

      this.transition(ctx, "verifying");

      const affectedModules = ctx.impactResult.allAffected.map((m) => ({
        moduleId: m.moduleId,
        impactLevel: m.impactLevel as "direct" | "indirect" | "observer",
        impactReason: m.impactReason,
        affectedInterfaces: m.affectedInterfaces,
      }));

      const config = this.verificationPipeline.buildPipeline(
        ctx.executionPlan,
        affectedModules,
      );
      const result = this.verificationPipeline.execute(
        ctx.proposalId,
        ctx.executionPlan.executionPlanId,
        config,
      );

      this.meetingStore.saveVerificationResult(result);
      ctx.verificationResult = result;

      this.audit(ctx, "verification_completed", {
        outcome: result.overallOutcome,
        remeetingRequired: result.remeetingRequired,
        testCount: result.testResults.length,
      });

      if (result.remeetingRequired) {
        this.transition(ctx, "remeeting");
        this.audit(ctx, "remeeting_triggered", {
          reason: result.remeetingReason,
        });
      }

      this.completeStage(stage);
      this.checkpoint(ctx);
    } catch (e) {
      this.failStage(stage, e);
      this.transition(ctx, "failed");
      this.checkpoint(ctx);
    }
    return ctx;
  }

  /**
   * Stage 7: Merge
   * 검증 통과 후 최종 반영.
   */
  merge(ctx: PipelineContext, options: PipelineOptions): PipelineContext {
    const stage = this.startStage(ctx, "merge");
    try {
      if (!ctx.verificationResult || ctx.verificationResult.overallOutcome !== "passed") {
        throw new Error("Verification must pass before merge");
      }

      // operator 승인 확인
      if (options.operatorId) {
        this.audit(ctx, "operator_approved", {
          operatorId: options.operatorId,
        });
      }

      this.transition(ctx, "merged");

      if (ctx.executionPlan) {
        this.meetingStore.updateExecutionPlanStatus(
          ctx.executionPlan.executionPlanId,
          "completed",
          { completedAt: Date.now() },
        );
      }

      this.proposalStore.updateWorkflowState(ctx.proposalId, "merged");

      this.audit(ctx, "proposal_merged", {
        proposalId: ctx.proposalId,
      });
      this.completeStage(stage);
      this.checkpoint(ctx);
    } catch (e) {
      this.failStage(stage, e);
      this.checkpoint(ctx);
    }
    return ctx;
  }

  /**
   * 전체 파이프라인을 한 번에 실행한다 (동기 모드).
   * 회의는 에이전트 응답이 필요하므로 실제 프로덕션에서는 단계별 비동기 호출을 사용.
   */
  runFullPipeline(
    proposalId: string,
    sessionId: string,
    options: PipelineOptions,
  ): PipelineContext {
    let ctx = this.createContext(proposalId, sessionId);

    ctx = this.analyzeImpact(ctx);
    if (ctx.currentState === "failed") return ctx;

    ctx = this.summonAgents(ctx);
    if (ctx.currentState === "failed" || ctx.currentState === "rejected") return ctx;

    ctx = this.startMeeting(ctx);
    if (ctx.currentState === "failed") return ctx;

    // 회의가 있으면 여기서 대기 (비동기 환경에서는 이벤트 기반)
    // 동기 모드에서는 이미 agreed 상태라고 가정

    ctx = this.buildDecisionContract(ctx, options);
    if (ctx.currentState === "rejected" || ctx.currentState === "on-hold") return ctx;

    ctx = this.execute(ctx, options);
    if (ctx.currentState === "failed") return ctx;

    ctx = this.verify(ctx);
    if (ctx.currentState === "remeeting") return ctx;

    ctx = this.merge(ctx, options);
    return ctx;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  createContext(proposalId: string, sessionId: string): PipelineContext {
    return {
      pipelineId: `pl_${nanoid(8)}`,
      proposalId,
      sessionId,
      stages: [],
      currentState: "draft",
      auditTrail: [],
    };
  }

  /**
   * DB에 저장된 파이프라인 상태로부터 컨텍스트를 복원한다.
   * 프로세스 중단 후 재개 시 사용.
   */
  resumeContext(proposalId: string): PipelineContext | null {
    return this.pipelineStore.load(proposalId);
  }

  private transition(ctx: PipelineContext, to: ChangeWorkflowState): void {
    assertValidChangeTransition(ctx.currentState, to);
    ctx.currentState = to;
  }

  /**
   * 현재 파이프라인 상태를 DB에 체크포인트한다.
   */
  private checkpoint(ctx: PipelineContext): void {
    this.pipelineStore.save(ctx);
  }

  private startStage(ctx: PipelineContext, stage: PipelineStageRecord["stage"]): PipelineStageRecord {
    const record: PipelineStageRecord = {
      stage,
      status: "running",
      startedAt: Date.now(),
    };
    ctx.stages.push(record);
    return record;
  }

  private completeStage(stage: PipelineStageRecord): void {
    stage.status = "completed";
    stage.completedAt = Date.now();
  }

  private failStage(stage: PipelineStageRecord, error: unknown): void {
    stage.status = "failed";
    stage.completedAt = Date.now();
    stage.error = error instanceof Error ? error.message : String(error);
  }

  private audit(ctx: PipelineContext, eventType: string, details: Record<string, unknown>): void {
    const event: AuditEvent = {
      eventId: `evt_${nanoid(8)}`,
      eventType,
      proposalId: ctx.proposalId,
      meetingId: ctx.meetingId,
      details,
      severity: "info",
      timestamp: Date.now(),
    };
    ctx.auditTrail.push(event);
    try {
      this.auditEventStore.save(event);
    } catch {
      // 감사 로그 저장 실패는 파이프라인을 중단하지 않음
    }
  }
}
