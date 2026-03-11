# Athena v0.3 Release Readiness

## Release Target

Athena v0.3 is the short-term closure target for this project.

This release is **not** positioned as a fully autonomous research OS.
It is positioned as a:

`stable operator-supervised research system`

That means:

- research state is persisted structurally
- operator CLI/report surfaces are usable for day-to-day control
- automation runs inside explicit safety gates
- simulation launch and failure paths are guarded
- the most important regressions are protected by automated tests

## What Is In Scope For v0.3

### Research Core

- canonical claim normalization and merge
- evidence-aware proposal scoring
- decision drift and reconsideration triggers
- workflow state persistence and rollback support
- experiment lineage and structured reporting

### Operator Surface

- `athena research runs`
- `athena research workflow <run-id>`
- `athena research automation <run-id>`
- `athena research proposals`
- `athena research scorecard <proposal-id>`
- `athena research improvements`
- `athena research review <id> --kind ... --action ...`
- `athena research next-actions`
- `athena report <session-id>`

### Safety Rails

- persistence regression coverage
- CLI regression coverage
- report/CLI snapshot regression coverage
- migration upgrade regression coverage
- automation approval/retry/timeout safety gates
- simulation launch preflight checks
- launch failure recording and recovery checkpoints

## What Is Explicitly Out of Scope For v0.3

These are intentionally deferred beyond the short-term closure point:

- robust external ingestion service for docs/papers/URLs
- richer citation spans and evidence attribution engine
- full TUI/dashboard refinement for research state
- autonomous scheduler-grade overnight orchestration
- cross-run self-improvement learning engine
- reusable policy promotion engine beyond current review queue semantics

## Release Sanity Checklist

The release is considered ready when all of the following are true:

- `npm run test:research:safety` passes
- `npm run test:research` passes
- `npm run smoke:research` passes
- `npm run build` passes
- README describes operator approval and review flow accurately
- PR summary exists in `docs/pr-summary-research-stack.md`
- next backlog boundary exists in `docs/next-phase-gap-analysis.md`

## Closure Point

The short-term project can be considered "wrapped" at the moment this document is true.

Concretely, the closure point is:

> Athena can be handed to an operator who can inspect state, review proposals, review improvements, manage automation safely, and understand failures without reading source code.

That is the v0.3 finish line.

## Supporting Commits

- `15a6c74` `add research unit test coverage`
- `290e9b0` `document research operator workflow`
- `8c56bda` `advance research workflow automation and improvement review`
- `ebcfaf8` `add research stack pr summary`
- `6b61042` `add next phase gap analysis`
- `819456d` `change project license to MIT`
- `e2c3179` `add research safety regression tests`
- `e78992c` `add migration upgrade regression coverage`
- `a1843b1` `harden ingestion evidence inference`
- `72dbc47` `enforce automation safety gates`
- `0b6bdc3` `add safe improvement review actions`
- `5dea978` `add operator review action flow`
- `4b8c745` `add report and cli snapshot regressions`
- `2a854ae` `harden simulation launch safety`
- `9ea06a5` `freeze research safety edge cases`
- `56d84c3` `document operator approval flow`
- `0796e0a` `record runtime recovery checkpoints`

## After v0.3

After this release boundary, new work should be treated as the next development cycle, not as part of short-term closure.

The starting point for that next cycle is already captured in:

- `docs/next-phase-gap-analysis.md`
