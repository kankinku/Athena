# Athena Operator-Supervised Production Roadmap

## Purpose

This document defines what it means for Athena to reach `100%` readiness as a `stable operator-supervised research system`, and turns that target into an implementation roadmap with evidence, concrete deliverables, and exit gates.

This roadmap is intentionally narrower than the fully autonomous roadmap:

- the operator remains in the loop for high-risk actions and policy overrides
- the system must still be safe, durable, observable, and evidence-grounded
- success is defined as `real supervised production use`, not unrestricted autonomy

## Readiness Snapshot

Working estimate as of `2026-03-14`:

- operator-supervised production readiness: `70-80%`
- fully autonomous production readiness: `50-60%`

Reason:

- Athena already has structured research state, automation gates, recovery hooks, CLI/TUI/report surfaces, and regression coverage
- the biggest remaining gaps are not feature breadth, but production qualities:
  - permissions
  - durable execution
  - evidence fidelity
  - operator incident handling
  - observability/evals
  - soak validation

## Evidence Base

### L1: Repository evidence

1. Athena is explicitly not yet production-safe from a permissioning perspective.
   - `README.md`
   - current wording states there is still no full permissions/security model and recommends containers or waiting for one

2. Athena already positions itself as a `stable operator-supervised research system`.
   - `README.md`
   - `docs/release-readiness-v0.3.md`

3. The current release boundary explicitly excludes robust ingestion, richer evidence attribution, and scheduler-grade overnight orchestration.
   - `docs/release-readiness-v0.3.md`

4. A minimal security floor exists, but it is regex-based rather than capability-based.
   - `src/security/policy.ts`
   - evidence:
     - command allow/review/block patterns
     - protected path allowlists
     - no first-class role/capability/audit decision model yet

5. Recovery and retry scaffolding already exist, but the control loop is still mostly run-centric rather than action-journal-centric.
   - `src/research/automation-manager.ts`
   - evidence:
     - `tickSession()`
     - `recoverSession()`
     - `maybeRetryRun()`

6. Athena already has the data model for evidence attribution, but not yet the stronger ingestion engine needed for production decisions.
   - `src/research/contracts.ts`
   - `src/research/ingestion-service.ts`
   - evidence:
     - `CitationSpan`
     - `SourceAttribution`
     - canonical claim structures
     - heuristic extraction path in ingestion service

7. The first autonomous-policy slice is now implemented, including stage timeout enforcement and autonomy policy persistence.
   - `src/research/contracts.ts`
   - `src/research/workflow-automation-service.ts`
   - `src/research/team-run-store.ts`
   - `src/research/team-orchestrator.ts`
   - `src/research/automation-manager.ts`

### L2: External official guidance

1. Anthropic, `Building Effective AI Agents` (Published Dec 19, 2024)
   - https://www.anthropic.com/research/building-effective-agents/
   - relevant guidance:
     - the most successful agent systems use simple, composable patterns
     - workflows and agents should be treated as distinct architectural concepts
     - tool use is central to agent reliability

2. Anthropic, `Demystifying evals for AI agents` (Published Jan 9, 2026)
   - https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
   - relevant guidance:
     - good evals prevent reactive production-only debugging
     - the eval harness must record steps, grade outcomes, and aggregate results
     - consistency metrics matter, not just one-off wins

3. OpenAI, `New tools for building agents`
   - https://openai.com/index/new-tools-for-building-agents/
   - relevant guidance:
     - production agents need orchestration support, tracing, and evaluation support
     - visibility into workflow execution is a first-class production requirement

4. Temporal docs
   - https://docs.temporal.io/
   - relevant guidance:
     - durable execution means the system resumes exactly where it left off after crashes, network failures, or outages
     - this is the right bar for long-running research workflows

5. OWASP, `Least Privilege Principle`
   - https://owasp.org/www-community/controls/Least_Privilege_Principle
   - relevant guidance:
     - services and applications should only receive the minimum permissions required for the task
     - least privilege is foundational for broader trust and security models

6. OWASP, `Authorization Cheat Sheet`
   - https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
   - relevant guidance:
     - broken access control remains one of the most serious software risks
     - authorization decisions and violations need logging to remain attributable

7. NIST RBAC project
   - https://csrc.nist.gov/Projects/Role-Based-Access-Control
   - relevant guidance:
     - RBAC remains a standard, auditable way to structure access management
     - RBAC and ABAC tradeoffs should be handled deliberately, not ad hoc

## What `100%` Means For Operator-Supervised Athena

Athena is `100%` ready for operator-supervised production only when all of the following are true:

1. Operators can run Athena continuously on real workloads without granting broad implicit trust.
2. A restart, disconnect, or partial failure does not strand a run in an unrecoverable or ambiguous state.
3. Every proposal and result can be traced back to evidence with source attribution and contradiction visibility.
4. High-risk actions are reviewable in one place, with clear rationale and audit history.
5. Incidents can be reconstructed from traces, workflow history, checkpoints, and policy decisions.
6. Soak validation proves the system behaves correctly across long-running local and remote sessions.

## Roadmap

## Step 9: Formal Security and Permission Model

### Objective

Replace the current regex-based security floor with a production permission model for supervised runs.

### Why this is next

- the repo still calls the missing permission model the largest production gap
- current enforcement is pattern-based, not scope-based
- supervised production is not credible while the agent remains broadly over-privileged

### Scope

- introduce capability-based execution policy for:
  - machine scope
  - workspace scope
  - path scope
  - tool family
  - network allowance
  - destructive action class
- keep operator override capability, but make it explicit and auditable
- do not attempt unrestricted autonomous delegation in this step

### Planned deliverables

- `src/security/contracts.ts`
  - capability model
  - role model
  - policy-decision types
- `src/security/policy.ts`
  - capability-aware enforcement engine
- `src/security/audit-store.ts`
  - persisted security decisions and overrides
- `src/store/migrations.ts`
  - audit/policy tables
- tool integration updates in:
  - `src/tools/file-ops.ts`
  - `src/tools/remote-sync.ts`
  - `src/tools/research-orchestration.ts`
  - remote execution entry points

### Verification

- unit tests for allow/review/block by capability and role
- regression tests for destructive command denial
- regression tests for protected-path writes
- regression tests for operator override audit trail
- CLI visibility for active run capability envelope

### Exit gate

- no high-risk tool path executes without a policy decision
- every override is persisted with actor, rationale, and timestamp
- Athena can be run in enforce mode with per-run scoped permissions

## Step 10: Durable Runtime Execution

### Objective

Make long-running supervised runs replay-safe and recoverable after crashes, disconnects, and partial completion.

### Why this is next

- `recoverSession()` exists, but recovery is still coarse
- current automation flow is run-centric, not action-journal-centric
- supervised production still needs durable execution even with a human in the loop

### Scope

- add persisted action journal entries for:
  - planned
  - issued
  - running
  - verifying
  - committed
  - needs_recovery
- add run lease and heartbeat semantics
- make retries action-aware instead of just re-launching from run summaries

### Planned deliverables

- `src/research/action-journal-store.ts`
- `src/research/runtime-recovery.ts`
- modifications to:
  - `src/research/automation-manager.ts`
  - `src/research/team-orchestrator.ts`
  - `src/research/simulation-runner.ts`
  - `src/scheduler/trigger-scheduler.ts`
  - `src/scheduler/sleep-manager.ts`
  - `src/store/migrations.ts`

### Verification

- crash-restart integration tests
- partial-action replay tests
- remote disconnect recovery tests
- idempotency tests for repeated recovery attempts

### Exit gate

- a process restart never loses the authoritative next action for an active supervised run
- repeated recovery attempts do not duplicate committed actions

## Step 11: Evidence-Grade Ingestion and Attribution

### Objective

Upgrade ingestion so operators can trust the evidence base behind proposals and results.

### Why this is next

- contracts already support citation spans and source attribution
- release docs still say robust external ingestion is deferred
- supervised production requires trustworthy evidence, not just structured state

### Scope

- strengthen adapters for:
  - URL
  - document
  - PDF
  - plain text
  - repo snapshot
- improve reconciliation for repeated ingestion waves
- expose contradiction pressure and evidence coverage gaps

### Planned deliverables

- `src/research/source-adapters/`
- changes in:
  - `src/research/ingestion-service.ts`
  - `src/research/ingestion.ts`
  - `src/research/claim-graph.ts`
  - `src/research/contracts.ts`
  - `src/research/reporting.ts`

### Verification

- ingestion regression suite for:
  - citation span retention
  - source attribution fidelity
  - canonical claim dedupe
  - contradiction capture
  - freshness propagation

### Exit gate

- every operator-facing proposal/report can point to evidence with source locator and contradiction visibility
- evidence strength and model confidence are rendered as separate signals

## Step 12: Operator Supervision Surface

### Objective

Make supervised production operations manageable from Athena’s own CLI/TUI surfaces.

### Why this is next

- Athena already has inspection surfaces
- production use needs a unified supervision queue, not just point-in-time views

### Scope

- add review and intervention surfaces for:
  - approval-needed
  - blocked
  - revisit_due
  - recovery_needed
  - rollback_candidate
- expose budgets, timeout risk, evidence quality, and policy state

### Planned deliverables

- CLI updates:
  - `src/cli/research.ts`
  - `src/cli/report.ts`
- TUI updates:
  - `src/ui/panels/research-status.tsx`
  - related command handlers/hooks

### Verification

- CLI regression tests for operator queues and action output
- TUI rendering tests for blocked/recovery/review states
- end-to-end tests for approve/defer/resume/rollback/archive flows

### Exit gate

- operators can see what needs attention and act on it without reading source code or raw SQLite state

## Step 13: Observability, Evals, and Incident Review

### Objective

Add the monitoring and eval layer needed to keep supervised production quality stable over time.

### Why this is next

- Anthropic’s eval guidance and OpenAI’s agent guidance both treat tracing/evals as core infra
- without this layer, Athena will regress silently as the harness grows

### Scope

- add traceable run/action history
- add eval suites for:
  - proposal quality
  - simulation quality
  - report quality
  - operator intervention correctness
- add incident classes and postmortem artifacts

### Planned deliverables

- trace/event persistence additions
- eval fixtures and benchmark tasks
- report outputs for failed/rolled-back runs
- alertable conditions for:
  - repeated retries
  - stalls
  - permission denials
  - recovery loops

### Verification

- regression suite for unsafe transitions and policy bypass attempts
- eval baseline snapshots stored and compared in CI
- operator incident reports generated from real failure fixtures

### Exit gate

- every meaningful failure mode has both a detection signal and a reproducible regression path

## Step 14: Soak Validation and Production Exit

### Objective

Prove the supervised system behaves correctly under sustained real-world conditions.

### Why this is last

- this phase only has value once permissioning, durability, evidence, supervision, and observability are all in place
- the current repo explicitly says remote validation is not yet equivalent to broad real-world multi-host soak testing

### Scope

- long-duration runs across:
  - local only
  - single remote
  - multi-host remote
- induced failures:
  - network interruption
  - remote host loss
  - process restart
  - stuck action
  - partial result write

### Planned deliverables

- soak test harness
- fault injection scenarios
- production-readiness checklist
- documented SLOs for:
  - completion
  - recovery
  - rollback
  - operator response

### Verification

- repeated soak runs with captured pass/fail reports
- no unrecoverable run states in fault-injection scenarios
- documented evidence that supervised production checklist is green

### Exit gate

- Athena can be described, honestly, as production-ready for operator-supervised research use

## Recommended Immediate Sequence

1. Start with Step 9.
   - It is the gating risk called out by the repo itself.

2. Move directly to Step 10.
   - Security without durable recovery still leaves production operations brittle.

3. Then complete Step 11 and Step 12 together.
   - evidence quality and operator actionability need to rise together

4. Finish with Step 13 and Step 14.
   - evals and soak validation should certify the system that now exists, not a moving target

## Non-Goals For This Roadmap

- replacing operator supervision with full autonomy
- inventing a second orchestration stack
- rewriting the research state model
- polishing the UI before the runtime and security model are production-safe
