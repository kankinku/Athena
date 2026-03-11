# Helios Phase 6-12 Implementation Plan

## Context
Helios is an autonomous research agent. The Phase 1-5 foundation (research contracts, team store/orchestrator, graph memory, reporting, budget enforcement) is complete. The database schema for Phase 6-12 (migration 7) is already present, including tables for scorecards, decisions, lineage, and ingestion. We need to implement the runtime logic, orchestrators, and UI surfaces for these phases. The proposed execution order has been critiqued and slightly adjusted to ensure data dependencies (Scorecards -> Decisions) are respected.

## Task Dependency Graph

| Task | Depends On | Reason |
|------|------------|--------|
| Task 1: Phase 7 Scorecards | None | Foundational quantitative data for proposals. Schema exists. |
| Task 2: Phase 6 Decision Layer | Task 1 | Decisions require Scorecard data to be evaluated automatically. |
| Task 3: Phase 9+11 Ledger & Propagation | Task 2 | Ledger tracks the history of Decisions and Simulations. |
| Task 4: Phase 8+10 Retrieval & Operator Surfaces | Task 3 | UI/CLI needs the Ledger and Decision data to display. |
| Task 5: Phase 12 Ingestion Scaffolding | None | Independent top-of-funnel feature, can be built anytime but scheduled last to focus on core loop. |

## Parallel Execution Graph

Wave 1 (Start immediately):
├── Task 1: Phase 7 Scorecards (no dependencies)
└── Task 5: Phase 12 Ingestion Scaffolding (no dependencies)

Wave 2 (After Wave 1 completes):
└── Task 2: Phase 6 Decision Layer (depends: Task 1)

Wave 3 (After Wave 2 completes):
└── Task 3: Phase 9+11 Ledger & Propagation (depends: Task 2)

Wave 4 (After Wave 3 completes):
└── Task 4: Phase 8+10 Retrieval & Operator Surfaces (depends: Task 3)

Critical Path: Task 1 → Task 2 → Task 3 → Task 4
Estimated Parallel Speedup: 20% faster than sequential (Task 5 runs in parallel)

## Tasks

### Task 1: Phase 7 Scorecards
**Description**: Implement the `ScorecardEvaluator` service to generate and persist `proposal_scorecards`. Integrate this into `TeamOrchestrator` so that when a `ProposalBrief` is created, a scorecard is automatically generated and saved.
**Delegation Recommendation**:
- Category: `deep` - Requires understanding the existing `TeamOrchestrator` and `TeamStore` to integrate cleanly without breaking the current flow.
- Skills: [`analyze`, `tdd`] - Needs careful analysis of existing contracts and test-driven implementation to ensure scorecards are correctly calculated and stored.
**Skills Evaluation**: 
- ✅ INCLUDED `analyze`: Essential for understanding the existing `TeamStore` and `GraphMemory` interactions.
- ✅ INCLUDED `tdd`: Crucial for ensuring the scorecard calculation logic is robust.
- ❌ OMITTED `frontend-ui-ux`: This is a backend data task.
**Depends On**: None
**Acceptance Criteria**:
- `ScorecardEvaluator` class exists with a method to calculate `MeritRiskScore`.
- `TeamStore` has methods to read/write `proposal_scorecards`.
- `TeamOrchestrator.recordProposalBrief` triggers scorecard generation.
- Unit tests verify scorecard generation and persistence.

### Task 2: Phase 6 Decision Layer
**Description**: Implement the `DecisionEngine` service to create `decision_records` and `reconsideration_triggers`. This engine should consume `ProposalBrief` and `proposal_scorecards` to make automated decisions (e.g., approve for simulation, reject).
**Delegation Recommendation**:
- Category: `deep` - Core business logic that dictates the autonomous loop's behavior.
- Skills: [`analyze`, `tdd`] - Requires careful state machine handling and robust testing.
**Skills Evaluation**:
- ✅ INCLUDED `analyze`: Needed to map out the decision state machine.
- ✅ INCLUDED `tdd`: Essential for verifying decision logic and trigger conditions.
- ❌ OMITTED `visual-engineering`: Backend logic only.
**Depends On**: Task 1
**Acceptance Criteria**:
- `DecisionEngine` class exists with methods to evaluate proposals and simulations.
- `TeamStore` has methods to read/write `decision_records` and `reconsideration_triggers`.
- `TeamOrchestrator` uses `DecisionEngine` to determine the next `TeamStage`.
- Unit tests verify decision creation and state transitions.

### Task 3: Phase 9+11 Ledger & Propagation
**Description**: Implement the `ExperimentLedger` service to track `experiment_lineage`. Update `reporting.ts` to include decision and lineage data in the research reports.
**Delegation Recommendation**:
- Category: `unspecified-high` - Standard backend service implementation and string formatting for reports.
- Skills: [`tdd`] - Ensure lineage tracking is accurate.
**Skills Evaluation**:
- ✅ INCLUDED `tdd`: Verify lineage graph correctness.
- ❌ OMITTED `analyze`: Straightforward CRUD and reporting task.
**Depends On**: Task 2
**Acceptance Criteria**:
- `ExperimentLedger` class exists to record lineage relationships (e.g., "derived_from", "supersedes").
- `TeamStore` has methods to read/write `experiment_lineage`.
- `buildResearchReportInput` in `reporting.ts` includes decision summaries and lineage.
- Unit tests verify lineage tracking and report generation.

### Task 4: Phase 8+10 Retrieval & Operator Surfaces
**Description**: Build CLI commands and UI panels to view scorecards, decisions, and the experiment ledger. Add commands like `/decisions`, `/ledger`, and update the metrics dashboard to show decision context.
**Delegation Recommendation**:
- Category: `visual-engineering` - Involves React UI components (Ink) and CLI command routing.
- Skills: [`frontend-ui-ux`] - Requires knowledge of the existing Ink-based UI framework in Helios.
**Skills Evaluation**:
- ✅ INCLUDED `frontend-ui-ux`: Essential for building terminal UI components.
- ❌ OMITTED `deep`: This is a presentation layer task, not complex logic.
**Depends On**: Task 3
**Acceptance Criteria**:
- CLI commands `/decisions` and `/ledger` exist and display formatted data.
- UI overlays/panels can display the current decision status and scorecard of the active proposal.
- Manual testing confirms the UI updates correctly when decisions are made.

### Task 5: Phase 12 Ingestion Scaffolding
**Description**: Implement the `IngestionService` to populate `ingestion_sources` and generate `ResearchCandidatePack`s from external URLs or documents.
**Delegation Recommendation**:
- Category: `unspecified-high` - Independent service that fetches and parses data.
- Skills: [`tdd`] - Ensure parsing and candidate generation work correctly.
**Skills Evaluation**:
- ✅ INCLUDED `tdd`: Verify ingestion logic and candidate pack formatting.
- ❌ OMITTED `frontend-ui-ux`: Backend service.
**Depends On**: None
**Acceptance Criteria**:
- `IngestionService` class exists with methods to process URLs/text into `ingestion_sources`.
- Service can generate a `ResearchCandidatePack` from an ingestion source.
- `TeamStore` has methods to read/write `ingestion_sources`.
- Unit tests verify ingestion and candidate generation.

## Commit Strategy
- **Atomic Commits**: Each task should be committed separately.
- **Prefixes**: Use conventional commits (`feat:`, `test:`, `refactor:`).
- **Task 1**: `feat(scorecards): implement ScorecardEvaluator and store integration`
- **Task 2**: `feat(decisions): implement DecisionEngine and state transitions`
- **Task 3**: `feat(ledger): implement ExperimentLedger and update reporting`
- **Task 4**: `feat(ui): add CLI commands and UI panels for decisions and ledger`
- **Task 5**: `feat(ingestion): implement IngestionService for external sources`

## Success Criteria
- All new services (`ScorecardEvaluator`, `DecisionEngine`, `ExperimentLedger`, `IngestionService`) are fully unit-tested.
- `TeamOrchestrator` successfully integrates these services without becoming a god object (maintain clear boundaries).
- The CLI and UI can display the new data structures.
- A full autonomous loop can run from ingestion -> proposal -> scorecard -> decision -> simulation -> ledger without crashing.
