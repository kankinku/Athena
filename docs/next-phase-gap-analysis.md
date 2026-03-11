# Next-Phase Gap Analysis

## Current State

Athena now has a full structured research loop with:

- canonical claims
- evidence-aware proposal scoring
- workflow-state persistence and rollback
- automation policy and checkpoints
- operator CLI/report surfaces
- self-improvement proposals, evaluations, and review queue metadata

The system is no longer missing core architecture. The next work should focus on reliability, ingestion depth, and operator usefulness.

## Highest-Priority Gaps

### 1. Test Depth Is Still Narrow

What exists:

- focused `node:test` coverage for claim merge, decision logic, workflow transitions, and improvement analysis
- end-to-end smoke coverage for the research stack

What is still missing:

- storage-level tests for `TeamStore`
- CLI-output tests for `athena research ...`
- migration compatibility tests across fresh and upgraded SQLite state
- regression tests for report rendering and automation state transitions

Recommended next tasks:

1. Add `TeamStore` persistence tests with isolated `ATHENA_HOME`
2. Add CLI snapshot-style tests for operator views
3. Add migration upgrade tests for research tables

### 2. Ingestion Is Still Mostly Scaffolded

What exists:

- ingestion sources
- source -> candidate pack helpers
- canonical claim normalization and merge

What is still missing:

- robust extraction from external URLs/docs/papers
- richer evidence span capture and source attribution
- stronger contradiction detection beyond simple keyword heuristics
- dedupe/promotion across multiple ingestion waves

Recommended next tasks:

1. Build a real ingestion service for URLs/text sources
2. Add structured evidence spans and citation metadata
3. Improve contradiction/support inference rules

### 3. Operator Surface Is Functional but Not Yet Polished

What exists:

- `athena research` operator views
- `athena report`
- README runbook

What is still missing:

- clearer filtering and sorting for large research sessions
- detailed drill-down for automation checkpoints and improvements
- better distinction between queued review items and historical records
- lightweight dashboard or panel integration for the new research state

Recommended next tasks:

1. Add filtering options for improvements, decisions, and runs
2. Add richer detail views for automation checkpoints and review queue items
3. Surface research state in Ink panels, not just CLI output

### 4. Self-Improvement Is Safe but Not Yet Self-Refining

What exists:

- improvement proposal generation
- evaluation generation
- rollback guidance
- priority score and review queue metadata

What is still missing:

- duplicate-merge behavior at storage level using `mergeKey`
- promotion flow from `queued` -> `promoted` -> reusable system policy
- dismissal/review APIs for operator decisions
- cross-run aggregation of repeated improvement themes

Recommended next tasks:

1. Merge repeated improvement proposals by `mergeKey`
2. Add explicit review/update actions in `TeamStore`
3. Create promotion logic for reusable policy upgrades

### 5. Automation Needs Stronger Runtime Integration

What exists:

- per-run automation policy/state
- checkpoints, resume, retry, timeout metadata

What is still missing:

- tighter integration with actual monitor/sleep scheduling
- automated timeout handling at the run orchestration level
- bounded retry execution that actually launches follow-up actions
- overnight recovery behavior beyond stored state

Recommended next tasks:

1. Connect automation policy to monitor/scheduler actions
2. Implement timeout enforcement for research runs, not just simulation budgets
3. Add automated retry/resume execution hooks with audit trail

## Recommended Execution Order

```text
Phase A  Storage + migration + CLI regression tests
Phase B  Real ingestion service and richer evidence extraction
Phase C  Operator UX refinements and review actions
Phase D  Self-improvement promotion/merge workflow
Phase E  Deeper automation runtime integration
```

## Best Immediate Follow-Up

If only one thing should be done next, it should be:

`Phase A — Storage + migration + CLI regression tests`

Reason:

- the core research architecture is now broad enough that regressions will become expensive
- stronger tests protect all future ingestion, automation, and self-improvement work
- this is the highest leverage stabilization step before adding more runtime complexity
