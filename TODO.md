# Athena Refactor TODO

Notes:
- Follow `$karpathy-guidelines`.
- Keep each cut small and verifiable.
- Preserve behavior first, then reduce responsibility overlap.
- For operator-supervised production work, use `docs/operator-supervised-production-roadmap.md` as the source of truth for scope, evidence, deliverables, and exit gates.

## Step 1

- [x] Fix `recordProposalBrief()` graph/state divergence
- [x] Add blocked automation path regression test

## Step 2

- [x] Split simulation persistence into `simulation-store.ts`
- [x] Split improvement persistence into `improvement-store.ts`
- [x] Split proposal persistence into `proposal-store.ts`
- [x] Split decision/reconsideration persistence into `decision-store.ts`
- [x] Split experiment lineage persistence into `lineage-store.ts`
- [x] Split ingestion persistence into `ingestion-store.ts`
- [x] Split team run persistence into `team-run-store.ts`
- [x] Split workflow transition persistence into `workflow-store.ts`
- [x] Split automation checkpoint persistence into `automation-store.ts`
- [x] Add delegation-preservation tests for each extracted store
- [x] Write a concise `TeamStore` responsibility boundary note
- [x] Separate remaining run/workflow/automation concerns from repository concerns
- [x] Keep existing research tests green

## Step 3

- [x] Split runtime polling side effects out of `layout.tsx`
- [x] Split streaming/input/runtime bridge side effects out of `layout.tsx`
- [x] Split `commands.ts` into registry + handlers
- [x] Add UI command regression tests

## Step 4

- [x] Break `createRuntime()` into builder stages
- [x] Clarify provider/runtime/tool registration boundaries

## Step 5

- [x] Add explicit provider capability model
- [x] Add Claude/OpenAI parity tests

## Step 6

- [x] Extract shared ACP/TUI orchestration bridge
- [x] Remove duplicated monitor/wake/task-poll flow

## Step 7

- [x] Rebuild the default test entrypoint
- [x] Align CI and local test execution paths

## Step 8

- [~] Add a fully autonomous mode that removes the operator-supervised approval/review dependency while preserving bounded safety, auditability, and recovery controls
  - [x] Add `fully-autonomous` automation mode and persisted autonomy policy
  - [x] Gate autonomous progression on evidence floor, trial decision, retry caps, rollback plan, budget, machine, and tool constraints
  - [x] Surface autonomy envelope in CLI, reports, and TUI
  - [x] Remove synthetic operator-approval startup semantics from autonomous flow
  - [x] Enforce stage timeout and stage-start timing in automation runtime
  - [ ] Add durable action journal and replay-safe recovery for autonomous runs
  - [ ] Add formal capability/RBAC-backed security policy for autonomous execution
  - [ ] Add long-running multi-host soak validation for autonomous mode

## Operator-Supervised Production Roadmap

Target:
- [ ] Reach `100%` readiness for operator-supervised real-world production use

Definition of done:
- [ ] Operators can safely run Athena continuously on real workloads with bounded permissions, durable recovery, trustworthy evidence, and actionable incident visibility

Execution rule:
- [ ] Do not mark Steps `9-14` complete unless their roadmap exit gate is satisfied in `docs/operator-supervised-production-roadmap.md`

## Step 9

- [ ] Ship a formal security and permission model for operator-supervised runs
- [ ] Add `src/security/contracts.ts` for capability, role, and policy decision types
- [ ] Upgrade `src/security/policy.ts` from regex floor to capability-aware enforcement
- [ ] Define run-scoped capabilities for machines, workspaces, path roots, command classes, network access, and destructive actions
- [ ] Add `src/security/audit-store.ts` plus migrations for decision and override persistence
- [ ] Enforce security policy in file ops, remote sync/exec, and research orchestration entry points
- [ ] Expose the active capability envelope in operator-facing CLI views
- [ ] Add regression tests for allow/review/block, protected writes, and operator overrides
- [ ] Exit gate: no high-risk execution path runs without an explicit, persisted policy decision

## Step 10

- [ ] Harden durable runtime execution for long-running supervised research sessions
- [ ] Add `src/research/action-journal-store.ts` and migrations for persisted action lifecycle state
- [ ] Record action states: `pending`, `issued`, `running`, `verifying`, `committed`, `needs_recovery`
- [ ] Add run leases and heartbeats for active runtime ownership
- [ ] Make replay and recovery idempotent across restart, disconnect, and partial completion
- [ ] Separate run-level retry logic from action-level retry logic
- [ ] Extend automation manager, orchestrator, simulation runner, and scheduler to use the journal
- [ ] Add crash-recovery, restart, and partial-action replay integration tests
- [ ] Exit gate: a restart never loses the authoritative next action for an active supervised run

## Step 11

- [ ] Build evidence-grade ingestion and attribution for production decisions
- [ ] Add stronger source adapters for URL, document, PDF, plain text, and repo snapshot ingestion
- [ ] Persist citation spans, source attribution, and evidence freshness consistently across repeated ingests
- [ ] Strengthen canonical claim dedupe and evidence reconciliation across multiple ingestion waves
- [ ] Distinguish model confidence from evidence strength in operator-facing summaries
- [ ] Add contradiction tracking and evidence coverage gaps to ingestion and reporting outputs
- [ ] Add ingestion regression tests for citation fidelity, claim dedupe, contradiction capture, and evidence lineage
- [ ] Exit gate: every proposal/report shown to operators can point to attributable evidence with locator and contradiction context

## Step 12

- [ ] Complete operator supervision surfaces for real operations
- [ ] Add review queues for approvals, blocked runs, revisit requests, recovery-needed runs, and rollback candidates
- [ ] Expand TUI/CLI run visibility with incident-focused drill-down for automation blocks, workflow history, and policy decisions
- [ ] Add operator actions for approve, defer, resume, rollback, and archive from the same supervision surface
- [ ] Surface budget burn, timeout risk, evidence quality, and policy state as first-class indicators
- [ ] Add end-to-end tests for operator review and intervention flows
- [ ] Exit gate: operators can identify what needs attention and act on it without reading source code or raw DB state

## Step 13

- [ ] Add production observability, evals, and incident review loops
- [ ] Persist traceable run/action history suitable for incident reconstruction
- [ ] Add task-level eval fixtures for proposal quality, simulation quality, report quality, and operator intervention correctness
- [ ] Add automated regression suites for failure modes, unsafe transitions, and policy bypass attempts
- [ ] Add alertable signals for repeated retries, stalled runs, recovery loops, and permission denials
- [ ] Add operator-facing incident and postmortem artifacts for failed or rolled-back runs
- [ ] Exit gate: every major failure mode has both a detection signal and a reproducible regression path

## Step 14

- [ ] Validate supervised production readiness under sustained load
- [ ] Run long-duration soak tests across local-only, single-remote, and multi-host execution paths
- [ ] Add network interruption, remote host loss, process restart, stuck action, and partial-result recovery scenarios
- [ ] Validate checkpoint, resume, retry, and rollback behavior under induced failures
- [ ] Measure and document operational SLOs for completion, recovery, rollback, and operator response
- [ ] Produce a documented supervised-production checklist with pass/fail evidence
- [ ] Exit only when the supervised production checklist is green and documented
