# Athena Supervised Production Checklist

Status: `blocked`

This checklist is the operator-supervised production exit artifact for roadmap `Step 14`.

## Required Green Checks

- Security policy is enforced for file, remote exec, remote sync, and research orchestration entry points.
- Action journal is present for launch, finalize, retry, and recovery paths.
- Active runs hold a lease with heartbeat semantics.
- Ingestion outputs preserve citation spans, source attribution, contradiction context, and evidence health.
- CLI/TUI expose review queue, incident counts, and journal/lease state.
- Eval fixtures exist for proposal quality, simulation quality, report quality, and operator intervention correctness.
- Soak harness evaluates local-only, single-remote, and multi-host scenarios with induced failure notes.

## Current Evidence

- `node --import tsx --test src/security/policy.test.ts src/security/audit-store.test.ts src/cli/security.test.ts src/research/review-flow.test.ts src/research/cli-regression.test.ts src/research/soak-harness.test.ts src/store/migrations-upgrade.test.ts`
  - result: `24/24` passing on `2026-03-14`
- `npm run build`
  - result: success on `2026-03-14`
- `node --import tsx src/bootstrap.ts research soak`
  - result: `local_only` smoke passed, artifact recorded
- `node --import tsx src/bootstrap.ts research checklist`
  - result: `overall=blocked`

## Exit Rule

Do not mark `Step 14` complete unless:

- all required green checks are satisfied
- soak checklist output is green for the selected scenarios
- no unrecoverable supervised run state remains in the exercised failure paths

## Current Blocking Result

```text
# Athena Supervised Production Checklist

overall=blocked
- local_only: status=pass pass=true completion=1 recovery=1 rollback=1 notes=local_smoke_only
- single_remote: status=blocked pass=false completion=0 recovery=0 rollback=0 notes=requires_remote_machines=1 configured=0
- multi_host: status=blocked pass=false completion=0 recovery=0 rollback=0 notes=requires_remote_machines=2 configured=0
```
