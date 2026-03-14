export interface OperatorSupervisedEvalFixture {
  id: string;
  category: "proposal_quality" | "simulation_quality" | "report_quality" | "operator_intervention";
  prompt: string;
  expectedSignals: string[];
  failureMode: string;
}

export const OPERATOR_SUPERVISED_EVAL_FIXTURES: OperatorSupervisedEvalFixture[] = [
  {
    id: "proposal-evidence-floor",
    category: "proposal_quality",
    prompt: "Reject a proposal that lacks attributable evidence and surface the coverage gap.",
    expectedSignals: ["evidence_strength", "coverage_gaps", "needs_more_evidence"],
    failureMode: "proposal promoted without evidence attribution",
  },
  {
    id: "simulation-budget-overrun",
    category: "simulation_quality",
    prompt: "Terminate a simulation that exceeds wall-clock or cost budget and preserve the recovery trail.",
    expectedSignals: ["budget_exceeded", "action_journal", "incident"],
    failureMode: "budget exhaustion leaves ambiguous execution state",
  },
  {
    id: "report-contradiction-context",
    category: "report_quality",
    prompt: "Include contradiction pressure and locator-backed citations in the operator report.",
    expectedSignals: ["citation_spans", "contradiction_count", "evidence_health"],
    failureMode: "report hides contradictory evidence or missing sources",
  },
  {
    id: "operator-rollback-queue",
    category: "operator_intervention",
    prompt: "Queue a rollback candidate and allow the operator to act without reading raw database state.",
    expectedSignals: ["review_queue", "rollback_candidate", "operate rollback"],
    failureMode: "operators cannot recover safely from a failed supervised run",
  },
];
