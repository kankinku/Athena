# Autopilot Context Snapshot

## Task Statement

Implement the first slice of Athena's `fully-autonomous` mode based on the production autonomy roadmap and execution plan.

## Desired Outcome

- Athena supports a first-class `fully-autonomous` automation mode
- runs can persist an explicit autonomy policy
- automation gating uses that policy for bounded autonomous progression
- CLI and TUI surfaces expose the autonomy envelope
- regression tests cover the new behavior

## Known Facts / Evidence

- Existing automation modes stop at `overnight-auto`
- Research run persistence already stores `automationPolicy`, retry, timeout, and checkpoint policies
- Workflow automation gating currently relies on approval booleans and retry limits
- Team runs are persisted through `TeamRunStore`
- CLI and TUI already surface research state

## Constraints

- Preserve existing supervised behavior
- Minimize scope to the first autonomy slice
- Do not replace the current runtime model
- Avoid reverting unrelated user changes in the dirty worktree

## Unknowns / Open Questions

- Whether autonomy policy should live inside `automationPolicy` or as a separate root field
- How much of the initial policy should be enforced in the first slice
- Whether existing tests already encode assumptions about automation modes

## Likely Codebase Touchpoints

- `src/research/contracts.ts`
- `src/research/team-run-store.ts`
- `src/research/workflow-automation-service.ts`
- `src/research/automation-manager.ts`
- `src/research/team-orchestrator.ts`
- `src/research/team-store.test.ts`
- `src/research/automation-manager.test.ts`
- `src/research/cli-regression.test.ts`
- `src/research/report-snapshot.test.ts`
- `src/ui/panels/research-status.tsx`
- `src/ui/panels/research-status.test.tsx`
