export type TeamStage = "collection" | "planning" | "simulation" | "reporting";

export type TeamRunStatus = "active" | "completed" | "failed" | "cancelled";

export type AutomationMode = "manual" | "assisted" | "supervised-auto" | "overnight-auto" | "fully-autonomous";

export type AutonomyRiskTier = "safe" | "moderate" | "high";

export type ResearchWorkflowState =
  | "draft"
  | "ready"
  | "approved"
  | "running"
  | "evaluating"
  | "reported"
  | "revisit_due"
  | "archived"
  | "failed";

export type ProposalStatus =
  | "candidate"
  | "ready_for_experiment"
  | "scoped_trial"
  | "deferred"
  | "revisit_when"
  | "revisit_due"
  | "archived";

export type ProposalReviewAction = "approve" | "scope_trial" | "defer" | "revisit" | "archive";

export type ExperimentOutcomeStatus =
  | "baseline"
  | "keep"
  | "discard"
  | "crash"
  | "pending"
  | "budget_exceeded"
  | "shadow_win"
  | "inconclusive"
  | "superseded";

export type DecisionType = "adopt" | "trial" | "defer" | "reject" | "revisit";

export type DecisionReasonTag =
  | "insufficient_gain"
  | "memory_risk"
  | "latency_regression"
  | "integration_complexity"
  | "low_confidence_evidence"
  | "simulation_negative"
  | "budget_exceeded"
  | "observability_gap"
  | "rollback_difficulty"
  | "superseded_by_better_option"
  | "high_expected_gain"
  | "stable_simulation"
  | "successful_validation"
  | "needs_more_evidence"
  | "resource_mismatch"
  | "guardrail_trial"
  | "decision_drift";

export type ReconsiderationTriggerType =
  | "new_evidence"
  | "infra_changed"
  | "similar_success"
  | "cost_reduced"
  | "constraint_removed";

export type LineageRelationType =
  | "baseline_of"
  | "derived_from"
  | "superseded_by"
  | "similar_to"
  | "contradicted_by"
  | "validated_by";

export interface MeritRiskScore {
  merit: number;
  risk: number;
  decisionScore: number;
}

export interface ProposalScorecard extends MeritRiskScore {
  proposalId: string;
  weightedScore: number;
  axisScores: {
    expected_gain: number;
    evidence_strength: number;
    evidence_freshness: number;
    contradiction_pressure: number;
    memory_risk: number;
    stability_risk: number;
    integration_cost: number;
    rollback_difficulty: number;
    observability_readiness: number;
  };
  evaluatorSummaries: string[];
  disagreementFlags: string[];
  scoreVersion: string;
}

export interface ClaimSupportSummary {
  claimIds: string[];
  sourceCoverage: number;
  evidenceStrength: number;
  freshnessScore: number;
  contradictionPressure: number;
  unresolvedClaims: string[];
}

export interface EvidenceHealthSummary {
  sourceCount: number;
  claimCount: number;
  canonicalClaimCount: number;
  contradictionCount: number;
  uncoveredClaimCount: number;
  freshnessScore: number;
  evidenceStrength: number;
  modelConfidence: number;
  confidenceSeparation: number;
  coverageGaps: string[];
}

export interface DecisionDriftRecord {
  initialDecision?: DecisionType;
  simulationDecision?: DecisionType;
  finalDecision: DecisionType;
  changed: boolean;
  weightedScore?: number;
  confidenceGap?: number;
  notes: string[];
}

export interface CalibrationSummary {
  weightedScore?: number;
  outcomeStatus?: ExperimentOutcomeStatus;
  falsePositive?: boolean;
  falseNegative?: boolean;
}

export interface ExtractedClaim {
  claimId: string;
  sourceClaimId?: string;
  canonicalClaimId?: string;
  semanticKey?: string;
  normalizedStatement?: string;
  statement: string;
  evidenceIds?: string[];
  confidence?: number;
  freshnessScore?: number;
  source?: string;
  sourceId?: string;
  methodTag?: string;
  supportTags?: string[];
  contradictionTags?: string[];
  rationaleSpans?: string[];
  citationSpans?: CitationSpan[];
  sourceAttributions?: SourceAttribution[];
  disposition?: "support" | "contradiction" | "mixed";
}

export interface CitationSpan {
  text: string;
  start: number;
  end: number;
  locator?: string;
}

export interface SourceAttribution {
  sourceId: string;
  title: string;
  url?: string;
  locator?: string;
}

export interface GraphNodeRecord {
  id: string;
  label: string;
  kind:
    | "document"
    | "claim"
    | "source_claim"
    | "method"
    | "evidence"
    | "constraint"
    | "counter_evidence"
    | "module"
    | "proposal"
    | "decision"
    | "experiment"
    | "result"
    | "note";
  gist?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdgeRecord {
  sourceId: string;
  targetId: string;
  relationship: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeSubgraph {
  rootIds: string[];
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
}

export interface ResearchCandidatePack {
  candidateId: string;
  sourceId?: string;
  problemArea: string;
  documents: string[];
  claims: ExtractedClaim[];
  canonicalClaims?: CanonicalClaim[];
  methods: string[];
  normalizedMethods?: string[];
  counterEvidence: string[];
  noveltyScore?: number;
  freshnessScore?: number;
  evidenceConfidence?: number;
  contradictions?: string[];
  openQuestions?: string[];
}

export interface CanonicalClaim {
  canonicalClaimId: string;
  semanticKey: string;
  statement: string;
  normalizedStatement: string;
  primaryMethodTag?: string;
  sourceClaimIds: string[];
  evidenceIds: string[];
  supportTags: string[];
  contradictionTags: string[];
  confidence?: number;
  freshnessScore?: number;
  sourceIds: string[];
  citationSpans?: CitationSpan[];
  sourceAttributions?: SourceAttribution[];
  supportCount?: number;
  contradictionCount?: number;
}

export interface ProposalBrief {
  proposalId: string;
  title: string;
  summary: string;
  targetModules: string[];
  expectedGain: string;
  expectedRisk: string;
  codeChangeScope: string[];
  staticScores?: Partial<Record<string, number>>;
  scorecard?: ProposalScorecard;
  status: ProposalStatus;
  experimentBudget: ExperimentBudget;
  stopConditions: string[];
  reconsiderConditions: string[];
  claimIds: string[];
  claimSupport?: ClaimSupportSummary;
}

export interface DecisionRecord {
  decisionId: string;
  proposalId: string;
  simulationId?: string;
  decisionType: DecisionType;
  decisionSummary: string;
  confidence: number;
  reasonTags: DecisionReasonTag[];
  createdAt: number;
  createdBy: string;
  evidenceLinks: string[];
  supersedesDecisionId?: string;
  drift?: DecisionDriftRecord;
  calibration?: CalibrationSummary;
}

export interface ReconsiderationTrigger {
  triggerId: string;
  decisionId: string;
  triggerType: ReconsiderationTriggerType;
  triggerCondition: string;
  status: "open" | "satisfied" | "dismissed" | "revisit_due";
  satisfiedAt?: number;
  evidenceLinks?: string[];
}

export interface ExperimentBudget {
  maxIterations?: number;
  maxCostUsd?: number;
  maxInputTokens?: number;
  maxWallClockMinutes?: number;
  maxConcurrentRuns?: number;
  notes?: string;
}

export interface ExperimentCharter {
  experimentId: string;
  proposalId: string;
  machineId: string;
  repoPath?: string;
  branchName?: string;
  command: string;
  evaluationMetric: string;
  metricNames?: string[];
  metricPatterns?: Record<string, string>;
  patchScope: string[];
  allowedChangeUnit: string;
  baselineTaskId?: string;
  budget: ExperimentBudget;
  rollbackPlan: string;
  description: string;
}

export interface SimulationScenario {
  scenarioId: string;
  label: "best" | "base" | "worst" | "custom";
  hypothesis: string;
  expectedEffects: string[];
  failureChains: string[];
  safeguards: string[];
}

export interface ExperimentResult {
  experimentId: string;
  proposalId: string;
  taskId?: string;
  branchName?: string;
  outcomeStatus: ExperimentOutcomeStatus;
  beforeMetrics: Record<string, number>;
  afterMetrics: Record<string, number>;
  resourceDelta: Record<string, number>;
  surprisingFindings: string[];
  notes?: string;
  guardrailTrialRecommended?: boolean;
}

export interface ExperimentLineageRecord {
  lineageId: string;
  proposalId: string;
  experimentId?: string;
  relatedExperimentId?: string;
  relationType: LineageRelationType;
  summary: string;
  createdAt: number;
  supersededByExperimentId?: string;
}

export interface IngestionSourceRecord {
  sourceId: string;
  sourceType: "paper" | "repo" | "docs" | "benchmark" | "manual";
  title: string;
  url?: string;
  status: "pending" | "ingested" | "failed";
  extractedCandidateId?: string;
  notes?: string;
  claimCount?: number;
  linkedProposalCount?: number;
  freshnessScore?: number;
  evidenceConfidence?: number;
  methodTags?: string[];
  extractedClaims?: ExtractedClaim[];
  canonicalClaims?: CanonicalClaim[];
  sourceDigest?: string;
  sourceExcerpt?: string;
  evidenceHealth?: EvidenceHealthSummary;
  createdAt: number;
  updatedAt: number;
}

export interface BudgetAnomalyRecord {
  experimentId: string;
  proposalId: string;
  decisionId?: string;
  findings: string[];
  notes?: string;
  createdAt: number;
}

export interface TeamRunRecord {
  id: string;
  sessionId: string;
  goal: string;
  currentStage: TeamStage;
  status: TeamRunStatus;
  workflowState: ResearchWorkflowState;
  automationPolicy: AutomationPolicy;
  checkpointPolicy: CheckpointPolicy;
  retryPolicy: RetryPolicy;
  timeoutPolicy: TimeoutPolicy;
  automationState: AutomationRuntimeState;
  budget?: ExperimentBudget;
  latestOutput?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type ActionJournalState =
  | "pending"
  | "issued"
  | "running"
  | "verifying"
  | "committed"
  | "needs_recovery";

export type ActionJournalType =
  | "session_recovery"
  | "session_tick"
  | "simulation_launch"
  | "simulation_finalize"
  | "simulation_budget_enforcement"
  | "automation_retry"
  | "operator_resume"
  | "operator_rollback";

export interface ActionJournalRecord {
  actionId: string;
  sessionId: string;
  runId: string;
  actionType: ActionJournalType;
  state: ActionJournalState;
  dedupeKey: string;
  leaseId?: string;
  summary: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
  heartbeatAt?: number;
}

export type RunLeaseStatus = "active" | "released" | "expired";

export interface RunLeaseRecord {
  leaseId: string;
  sessionId: string;
  runId: string;
  ownerId: string;
  status: RunLeaseStatus;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
  releasedAt?: number;
}

export type IncidentSeverity = "info" | "warning" | "critical";

export type IncidentType =
  | "automation_block"
  | "retry_exhausted"
  | "recovery_needed"
  | "budget_exceeded"
  | "simulation_crash"
  | "policy_denial"
  | "rollback_candidate"
  | "stalled_run"
  | "evidence_gap";

export interface IncidentRecord {
  incidentId: string;
  sessionId: string;
  runId: string;
  proposalId?: string;
  experimentId?: string;
  type: IncidentType;
  severity: IncidentSeverity;
  summary: string;
  details?: string;
  status: "open" | "acknowledged" | "resolved";
  actionRequired: boolean;
  relatedActionId?: string;
  relatedDecisionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type ReviewQueueKind =
  | "approval_needed"
  | "blocked"
  | "revisit_due"
  | "recovery_needed"
  | "rollback_candidate";

export interface ReviewQueueEntry {
  id: string;
  kind: ReviewQueueKind;
  runId?: string;
  proposalId?: string;
  experimentId?: string;
  priority: number;
  status: string;
  summary: string;
  actionHint: string;
}

export interface WorkflowTransitionRecord {
  transitionId: string;
  runId: string;
  fromState: ResearchWorkflowState;
  toState: ResearchWorkflowState;
  reason: string;
  rollbackOfTransitionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface AutomationPolicy {
  mode: AutomationMode;
  requireProposalApproval: boolean;
  requireExperimentApproval: boolean;
  requireRevisitApproval: boolean;
  maxAutoExperiments: number;
  autonomyPolicy?: AutonomousModePolicy;
}

export interface AutonomousModePolicy {
  maxRiskTier: AutonomyRiskTier;
  maxCostUsd?: number;
  maxWallClockMinutes?: number;
  maxRetryCount?: number;
  requireRollbackPlan?: boolean;
  requireEvidenceFloor?: number;
  allowedToolFamilies?: string[];
  allowedMachineIds?: string[];
}

export interface CheckpointPolicy {
  intervalMinutes: number;
  onWorkflowStates: ResearchWorkflowState[];
}

export interface RetryPolicy {
  maxRetries: number;
  retryOn: ExperimentOutcomeStatus[];
}

export interface TimeoutPolicy {
  maxRunMinutes: number;
  maxStageMinutes?: number;
}

export interface AutomationRuntimeState {
  retryCount: number;
  resumeCount: number;
  stageStartedAt?: number;
  lastCheckpointAt?: number;
  lastCheckpointReason?: string;
  timeoutAt?: number;
  nextCheckpointAt?: number;
}

export interface AutomationCheckpointRecord {
  checkpointId: string;
  runId: string;
  workflowState: ResearchWorkflowState;
  stage: TeamStage;
  reason: string;
  snapshot?: Record<string, unknown>;
  createdAt: number;
}

export type ImprovementTargetArea =
  | "automation_policy"
  | "workflow_guardrail"
  | "evaluation_strategy"
  | "decision_policy"
  | "reporting_quality"
  | "research_strategy";

export type ImprovementProposalStatus = "proposed" | "approved" | "evaluated" | "rolled_back" | "rejected";

export type ImprovementEvaluationOutcome = "promising" | "neutral" | "regressive" | "rollback_required";

export type ImprovementReviewStatus = "queued" | "in_review" | "promoted" | "dismissed";

export type ImprovementReviewAction = "queue" | "start_review" | "promote" | "dismiss";

export interface ImprovementProposalRecord {
  improvementId: string;
  runId: string;
  proposalId?: string;
  experimentId?: string;
  mergeKey: string;
  title: string;
  targetArea: ImprovementTargetArea;
  hypothesis: string;
  rationale: string;
  expectedBenefit: string;
  priorityScore: number;
  reviewStatus: ImprovementReviewStatus;
  rollbackPlan: string;
  status: ImprovementProposalStatus;
  sourceDecisionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ImprovementEvaluationRecord {
  evaluationId: string;
  improvementId?: string;
  runId: string;
  experimentId?: string;
  outcome: ImprovementEvaluationOutcome;
  summary: string;
  recommendedAction: string;
  rollbackRequired: boolean;
  metricDeltaSummary: string;
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE MANAGEMENT SYSTEM (v0.4+)
// Task 8: State Machine and Data Model for Module-Based Change Coordination
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 모듈 협의 기반 change proposal의 전체 생명주기 상태.
 * 기존 ResearchWorkflowState와 함께 사용 (proposal_briefs.workflow_state 필드).
 */
export type ChangeWorkflowState =
  | "draft"             // change proposal 작성 중
  | "impact-analyzed"   // 영향도 분석 완료
  | "agents-summoned"   // 관련 에이전트 소집됨
  | "in-meeting"        // 에이전트 회의 진행 중
  | "agreed"            // 합의 도달, 실행 계획 확정
  | "executing"         // 모듈 오너들이 실행 중
  | "verifying"         // 통합 테스트 검증 중
  | "completed"         // 변경 완료 + 검증 통과
  | "remeeting"         // 검증 실패로 재협의
  | "on-hold"           // 합의 불가로 보류
  | "rejected"          // 거절됨
  | "failed";           // 오류/타임아웃

/**
 * Change proposal의 상세 상태 (더 세분화된 ChangeWorkflowState).
 */
export type ChangeProposalStatus =
  | "draft"
  | "ready"
  | "impact-analyzed"
  | "meeting-scheduled"
  | "agreed"
  | "conditionally-agreed"
  | "split-execution"
  | "on-hold"
  | "rejected"
  | "executing"
  | "verifying"
  | "completed"
  | "rolled-back"
  | "remeeting"
  | "archived";

/**
 * 에이전트 회의 세션 상태.
 */
export type MeetingState =
  | "scheduled"
  | "pending-quorum"
  | "round-1"
  | "round-2"
  | "round-3"
  | "round-4"
  | "round-5"
  | "completed"
  | "on-hold"
  | "failed";

/**
 * 합의 유형.
 */
export type ConsensusType =
  | "approved"
  | "conditionally-approved"
  | "split-execution"
  | "experiment-first"
  | "on-hold"
  | "rejected";

/**
 * 에이전트 투표.
 */
export type AgentVote =
  | "approve"
  | "conditionally_approve"
  | "split"
  | "hold"
  | "reject"
  | "abstain";

/**
 * 에이전트 입장 (라운드 2).
 */
export type AgentPositionStance = "support" | "neutral" | "concern" | "oppose";

/**
 * 충돌 유형.
 */
export type ConflictType =
  | "interface-conflict"
  | "schedule-conflict"
  | "test-risk"
  | "security-priority"
  | "resource-conflict"
  | "scope-disagreement";

/**
 * 에이전트 회의에서의 발언 기록.
 */
export interface AgentPositionRecord {
  positionId: string;
  meetingId: string;
  agentId: string;
  moduleId: string;
  round: number;
  position: AgentPositionStance;
  impact: string;
  risk: string;
  requiredChanges: string[];
  vote?: AgentVote;
  approvalCondition?: string;
  notes?: string;
  createdAt: number;
}

/**
 * 회의 중 식별된 충돌 포인트.
 */
export interface ConflictPoint {
  conflictId: string;
  conflictType: ConflictType;
  description: string;
  involvedAgents: string[];
  proposedResolutions: string[];
  resolvedAt?: number;
  resolutionNotes?: string;
}

/**
 * 조건부 승인의 조건 항목.
 */
export interface ApprovalConditionRecord {
  conditionId: string;
  meetingId: string;
  proposalId: string;
  requiredBy: string;
  conditionText: string;
  verificationMethod: string;
  verifiedBy?: string;
  status: "pending" | "verified" | "waived" | "failed";
  verifiedAt?: number;
  createdAt: number;
}

/**
 * 에이전트 발언 요약 (회의 기록용).
 */
export interface AgentPositionSummary {
  agentId: string;
  moduleId: string;
  position: AgentPositionStance;
  vote?: AgentVote;
  keyPoints: string[];
}

/**
 * 에이전트 회의 세션 전체 기록.
 */
export interface MeetingSessionRecord {
  meetingId: string;
  proposalId: string;
  state: MeetingState;
  currentRound: number;
  mandatoryAgents: string[];
  conditionalAgents: string[];
  observerAgents: string[];
  respondedAgents: string[];
  absentAgents: string[];
  keyPositions: AgentPositionSummary[];
  conflictPoints: ConflictPoint[];
  consensusType?: ConsensusType;
  consensusReachedAt?: number;
  executionPlanId?: string;
  followUpActions: MeetingFollowUpAction[];
  scheduledAt: number;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 회의 후속 작업.
 */
export interface MeetingFollowUpAction {
  actionId: string;
  description: string;
  assignedAgent: string;
  dueAt?: number;
  status: "pending" | "completed" | "cancelled";
}

/**
 * 합의 결과로 생성되는 실행 계획.
 */
export interface TaskAssignment {
  agentId: string;
  moduleId: string;
  tasks: string[];
  dependsOnAgents: string[];
  estimatedMinutes?: number;
}

export interface ExecutionPlanRecord {
  executionPlanId: string;
  proposalId: string;
  meetingId: string;
  taskAssignments: TaskAssignment[];
  requiredTests: string[];
  rollbackPlan: string;
  featureFlags: string[];
  status: "pending" | "in-progress" | "completed" | "failed" | "rolled-back";
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 검증 단계 결과.
 */
export type VerificationOutcome = "passed" | "failed" | "partial" | "skipped";

export interface VerificationResult {
  verificationId: string;
  proposalId: string;
  executionPlanId: string;
  testResults: TestResult[];
  overallOutcome: VerificationOutcome;
  remeetingRequired: boolean;
  remeetingReason?: string;
  verifiedAt: number;
  createdAt: number;
}

export interface TestResult {
  testId: string;
  testCommand: string;
  outcome: "passed" | "failed" | "skipped" | "error";
  failureMessage?: string;
  ownerModule: string;
  durationMs?: number;
}

/**
 * 영향받는 모듈 분류 (ImpactAnalyzer 결과와 동일 구조).
 */
export type ModuleImpactLevel = "direct" | "indirect" | "observer";

export interface AffectedModuleRecord {
  moduleId: string;
  impactLevel: ModuleImpactLevel;
  impactReason: string;
  affectedInterfaces: string[];
}
