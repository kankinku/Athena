export type TeamStage = "collection" | "planning" | "simulation" | "reporting";

export type TeamRunStatus = "active" | "completed" | "failed" | "cancelled";

export type ProposalStatus =
  | "candidate"
  | "ready_for_experiment"
  | "scoped_trial"
  | "deferred"
  | "revisit_when"
  | "revisit_due"
  | "archived";

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
}

export interface GraphNodeRecord {
  id: string;
  label: string;
  kind:
    | "document"
    | "claim"
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
  methods: string[];
  normalizedMethods?: string[];
  counterEvidence: string[];
  noveltyScore?: number;
  freshnessScore?: number;
  evidenceConfidence?: number;
  contradictions?: string[];
  openQuestions?: string[];
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
  budget?: ExperimentBudget;
  latestOutput?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
