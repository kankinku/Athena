# Research Stack PR Summary

## Summary

- Add canonical-claim normalization so source claims merge into stable research graph identities.
- Introduce evidence-aware proposal scoring, workflow-state persistence, automation policy, and self-improvement review records.
- Expand operator surfaces with research CLI views, report sections, and targeted research unit tests.

## What Changed

### Research Core

- Added canonical claim helpers and canonical/source claim separation in the graph layer.
- Extended ingestion to normalize, dedupe, and persist canonical claims.
- Strengthened proposal scoring with evidence strength, freshness, and contradiction pressure.
- Added workflow transitions, rollback support, and transition history for research runs.
- Added automation policy, checkpoint, retry, resume, and timeout state per run.
- Added self-improvement proposals/evaluations plus a review queue foundation.

### Operator Surface

- Expanded `athena research` with `workflow`, `automation`, `improvements`, `next-actions`, richer `claims`, and decision detail views.
- Upgraded `athena report` input generation with summary, current decision, automation status, next actions, and self-improvement sections.
- Documented the research workflow, automation modes, operator runbook, and research CLI views in `README.md`.

### Quality

- Added `test:research` using `node:test` + `tsx`.
- Added focused tests for canonical claims, decision-engine behavior, workflow-state rules, and self-improvement analysis.
- Kept end-to-end smoke verification for the structured research pipeline.

## Verification

```bash
npm run test:research
npm run smoke:research
npm run build
```

## Commits

- `15a6c74` `add research unit test coverage`
- `290e9b0` `document research operator workflow`
- `8c56bda` `advance research workflow automation and improvement review`

## Reviewer Focus

- Canonical claim merge semantics and graph relationships.
- Proposal scoring changes driven by claim support and contradiction pressure.
- Workflow/automation persistence and run transition safety.
- Self-improvement review queue semantics (`priorityScore`, `reviewStatus`, `mergeKey`).
