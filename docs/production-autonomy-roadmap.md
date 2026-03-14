# Athena Production Autonomy Roadmap

## Document Purpose

This document consolidates:

- current-state evidence from the Athena codebase and existing repo docs
- external primary-source references relevant to production agent systems
- a concrete target architecture for moving Athena from operator-supervised beta toward production readiness
- a scoped execution plan for adding a fully autonomous mode without losing safety, auditability, or recovery

This is intended to be the working document for the next development cycle after the current `v0.3` release-hardening boundary.

## Executive Summary

Athena is already beyond prototype status. It has a real research-state model, automation scaffolding, local/remote execution, operator surfaces, and persistence. The current repo correctly positions itself as a `stable operator-supervised research system`, not yet as a fully autonomous production research OS.

Working estimate:

- operator-supervised production readiness: `65-75%`
- fully autonomous production readiness: `40-50%`

The gap is no longer "core architecture missing". The gap is concentrated in six production-critical areas:

1. permissions and security model
2. durable long-running execution
3. evidence-grade ingestion and attribution
4. autonomy governance and stop conditions
5. observability, evals, and soak reliability
6. production-grade operator and incident surfaces

## Current State Evidence

### What Athena already has

- Structured workflow state for research runs:
  - `draft -> ready -> approved -> running -> evaluating -> reported`
  - file: `src/research/workflow-state.ts`
- Structured research contracts and automation modes:
  - `manual`, `assisted`, `supervised-auto`, `overnight-auto`
  - file: `src/research/contracts.ts`
- Team-level orchestration with persisted proposals, decisions, claims, and simulations:
  - file: `src/research/team-orchestrator.ts`
- Runtime automation recovery, retry, checkpointing, and simulation finalization:
  - file: `src/research/automation-manager.ts`
- Simulation launch and budget enforcement:
  - file: `src/research/simulation-runner.ts`
- Local plus remote execution with background process tracking:
  - file: `src/remote/executor.ts`
- Trigger-based sleep and wake orchestration:
  - files: `src/scheduler/trigger-scheduler.ts`, `src/scheduler/sleep-manager.ts`
- Minimal security floor for dangerous commands and sensitive paths:
  - file: `src/security/policy.ts`
- Graph-backed research memory and subgraph retrieval:
  - file: `src/memory/graph-memory.ts`
- Operator surfaces in CLI and TUI:
  - files: `src/cli/research.ts`, `src/ui/panels/research-status.tsx`, `src/ui/layout.tsx`
- SQLite persistence and migrations:
  - file: `src/store/database.ts`

### What the repo itself says is not done yet

The existing docs already define the short-term boundary clearly:

- `docs/release-readiness-v0.3.md`
- `docs/next-phase-gap-analysis.md`
- `README.md`

The strongest explicit constraints are:

- Athena is not yet a fully autonomous research OS
- robust external ingestion is still deferred
- remote validation is not yet broad real-world soak validation
- a real permissions/security model is still the largest missing production component

## External Reference Set

These references should guide the next cycle. They are all primary or official sources.

1. Anthropic, "Building effective agents"
   - https://www.anthropic.com/research/building-effective-agents/
   - Key takeaways for Athena:
   - keep the harness simple
   - separate workflows from agents
   - use explicit stopping conditions
   - prioritize tool clarity, transparency, and sandboxed testing for autonomous loops

2. Anthropic, "Building agents with the Claude Agent SDK"
   - https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk/
   - Key takeaways for Athena:
   - long-running agent reliability improves when the harness, tool interfaces, and eval loop are first-class
   - test sets and failure-driven iteration are mandatory, not optional

3. Anthropic, "Demystifying evals for AI agents"
   - https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
   - Key takeaways for Athena:
   - no single eval catches failures
   - layered evaluation is required for multi-step agents
   - production autonomy requires traceability plus task-level grading

4. OpenAI, "New tools for building agents"
   - https://openai.com/index/new-tools-for-building-agents/
   - Key takeaways for Athena:
   - production agents need built-in tracing, tool integration, and orchestration support
   - agent reliability depends on visibility into workflow execution, not just model quality

5. Temporal documentation
   - https://docs.temporal.io/
   - Key takeaway for Athena:
   - crash-proof or durable execution should be treated as a product requirement for long-running autonomous workflows

These references do not imply Athena should adopt those stacks directly. They define the bar Athena should meet: simple harnesses, bounded autonomy, strong evals, durable execution, and high observability.

## Target Product Definition

### Target A: Production Operator-Supervised Athena

Definition:

- safe enough to run continuously on real research workloads
- operator remains in the loop for high-risk actions and policy overrides
- system is durable across restarts, machine loss, and partial workflow failure
- evidence and lineage are trustworthy enough for real decisions

### Target B: Production Fully Autonomous Athena

Definition:

- Athena can complete bounded research programs without routine human approval
- high-risk actions remain policy-bound, not human-bound
- the system can stop itself, de-scope itself, or escalate when it exceeds risk, uncertainty, or resource budgets
- every material action remains reconstructible via logs, state history, and provenance

This second target is not "remove approvals and hope". It is "replace ad hoc human supervision with explicit policy, budgets, and recovery controls."

## Design Principles For The Next Cycle

1. Preserve the existing structured research model.
   - Athena already has the right skeleton: workflow state, claims, proposals, decisions, simulations.
   - The next cycle should harden this skeleton, not replace it.

2. Add autonomy by policy, not by deleting gates.
   - A fully autonomous mode must still have bounded permissions, risk budgets, stop conditions, and escalation rules.

3. Treat durability as a first-class runtime capability.
   - Overnight or multi-day runs cannot depend on in-memory control state.

4. Separate evidence trust from model confidence.
   - Athena should know the difference between "the model is confident" and "the source graph is strong".

5. Build evals and incident review into the core workflow.
   - Production autonomy without evals will fail silently.

6. Prefer additive evolution.
   - Extend the current runtime, contracts, and persistence layer instead of starting a second orchestration stack.

## Main Gaps To Close

### 1. Security and Permission Model

Current state:

- regex-based security floor exists for commands and sensitive paths
- file: `src/security/policy.ts`

Gap:

- this is not a production permission system
- there are no scoped capabilities, role-based policies, execution sandboxes, or per-run permission budgets

Target:

- a policy engine that evaluates actions against:
  - action type
  - machine scope
  - workspace scope
  - path scope
  - risk level
  - autonomy mode
  - operator policy

Concrete additions:

- add run-scoped capability policies:
  - allowed machines
  - allowed path roots
  - allowed command classes
  - network access rules
  - destructive action rules
- introduce risk-tiered tool execution:
  - `safe`
  - `reviewable`
  - `forbidden`
- persist security decisions and overrides for audit

Likely files:

- modify `src/security/policy.ts`
- add `src/security/contracts.ts`
- add `src/security/audit-store.ts`
- modify `src/research/contracts.ts`
- modify `src/tools/file-ops.ts`
- modify `src/tools/remote-exec.ts`
- add database tables via `src/store/migrations.ts`

### 2. Durable Autonomous Execution

Current state:

- automation state, retry metadata, and recovery exist
- scheduler and sleep support exists
- a lot of runtime control is still effectively process-local

Gap:

- long-running execution is not yet durable enough for production autonomy
- crash recovery exists, but not as a complete workflow execution model

Target:

- every run has a persisted control loop state
- every action step is idempotent or replay-safe
- agent progress can recover after:
  - local process restart
  - transient network failure
  - remote machine disconnect
  - partial action completion

Concrete additions:

- add a persisted action journal:
  - planned action
  - issued action
  - observed outcome
  - compensation action
- add per-run leases and heartbeats
- distinguish:
  - `pending`
  - `issued`
  - `running`
  - `verifying`
  - `committed`
  - `needs_recovery`
- make retry logic action-aware instead of only run-aware

Likely files:

- modify `src/research/automation-manager.ts`
- modify `src/research/team-orchestrator.ts`
- modify `src/scheduler/trigger-scheduler.ts`
- modify `src/scheduler/sleep-manager.ts`
- add `src/research/action-journal-store.ts`
- add `src/research/runtime-recovery.ts`
- modify `src/store/migrations.ts`

### 3. Evidence-Grade Ingestion

Current state:

- ingestion scaffolding exists
- canonical claim normalization exists
- citation spans and source attribution types already exist in contracts

Gap:

- robust extraction from URLs, docs, and papers is still missing
- contradiction detection and source promotion are still shallow

Target:

- ingestion is reliable enough that Athena can justify why a proposal exists and why a decision changed
- evidence survives multiple ingestion waves and dedupes correctly

Concrete additions:

- source adapters for:
  - URL
  - local file
  - PDF
  - plain text
  - repo snapshot
- extraction output must include:
  - claim text
  - citation span
  - source locator
  - method tag
  - confidence
  - contradiction/support tags
- add evidence reconciliation across repeated ingestion passes

Likely files:

- modify `src/research/ingestion-service.ts`
- modify `src/research/ingestion.ts`
- modify `src/research/claim-graph.ts`
- modify `src/research/contracts.ts`
- add `src/research/source-adapters/`
- add storage support in `src/store/migrations.ts`

### 4. Fully Autonomous Mode and Governance

Current state:

- automation modes stop at `overnight-auto`
- file: `src/research/contracts.ts`

Gap:

- Athena has no explicit "fully autonomous" operating mode
- the system lacks policy semantics for when it may continue, stop, or escalate without a human

Target:

- add a new autonomy mode, for example `fully-autonomous`
- the mode must be defined by policy, not by a missing reviewer

Required policy dimensions:

- maximum wall clock budget
- maximum cost budget
- maximum concurrent experiments
- maximum risk tier
- allowed tool families
- allowed machine sets
- uncertainty threshold for escalation
- evidence floor for promotion from proposal to experiment
- rollback guarantee requirement

Required stop and escalation conditions:

- exceeded budget
- repeated action failure
- evidence quality below threshold
- unresolved contradiction pressure above threshold
- policy violation
- environmental instability
- missing rollback path

Likely files:

- modify `src/research/contracts.ts`
- modify `src/research/automation-manager.ts`
- modify `src/research/team-store.ts`
- modify `src/research/team-orchestrator.ts`
- modify `src/cli/research.ts`
- modify `src/ui/panels/research-status.tsx`

### 5. Observability, Evals, and Incident Review

Current state:

- Athena has test coverage and some runtime visibility
- there is not yet a full autonomy-grade tracing and evaluation surface

Gap:

- production autonomy requires:
  - traces
  - incident classes
  - failure replay
  - benchmark tasks
  - soak and chaos testing

Target:

- an eval and incident layer that can answer:
  - what failed
  - why it failed
  - whether it was a model error, tool error, policy error, environment error, or orchestration error

Concrete additions:

- trace every tool call with:
  - inputs
  - normalized action type
  - latency
  - result class
  - policy decision
- add incident records:
  - safety block
  - retry exhaustion
  - host failure
  - evidence conflict
  - unbounded loop risk
- create eval suites:
  - unit
  - integration
  - end-to-end
  - soak
  - chaos

Likely files:

- add `src/research/incident-store.ts`
- add `src/research/evals/`
- modify `src/tools/research-orchestration.ts`
- modify `src/store/migrations.ts`
- extend CI workflows in `.github/workflows/`

### 6. Operator and Production Ops Surface

Current state:

- Athena already has useful operator views

Gap:

- the current surface is not yet a production control plane

Target:

- operators should be able to see:
  - autonomy mode
  - risk envelope
  - current blockers
  - active incidents
  - policy overrides
  - evidence health
  - recovery status

Concrete additions:

- add research run detail views for:
  - autonomy policy
  - audit history
  - recent incidents
  - retry timeline
  - evidence coverage summary
- show full-autonomy state in TUI status surfaces

Likely files:

- modify `src/cli/research.ts`
- modify `src/cli/report.ts`
- modify `src/ui/panels/research-status.tsx`
- possibly add `src/ui/panels/incidents-status.tsx`

## Proposed Architecture Delta

### New Core Concepts

Add these concepts explicitly to the research runtime:

1. `AutonomyPolicy`
   - defines what a run is allowed to do

2. `ActionJournal`
   - records intended, issued, observed, retried, compensated actions

3. `IncidentRecord`
   - standardizes runtime failure and safety events

4. `EvidenceHealth`
   - summarizes source coverage, freshness, contradiction pressure, and citation completeness

5. `RunLease`
   - supports durable ownership and recovery for long-running runs

### Suggested Contract Changes

Primary file:

- `src/research/contracts.ts`

Suggested additions:

- extend `AutomationMode` with `fully-autonomous`
- add `AutonomyPolicy`
- add `RiskTier`
- add `IncidentType`
- add `ActionState`
- add `EvidenceHealthSummary`

### Suggested Persistence Changes

Primary files:

- `src/store/migrations.ts`
- `src/store/database.ts`

Suggested tables:

- `research_action_journal`
- `research_incidents`
- `research_run_leases`
- `research_policy_overrides`
- `research_evidence_attributions`

## Recommended Execution Phases

### Phase 1: Production Safety Foundation

Goal:

- replace the minimal security floor with a real policy layer

Deliverables:

- scoped capability model
- persisted security audit log
- run-level autonomy policy
- safer tool classification

Exit criteria:

- every tool action is policy-checked
- every blocked or overridden action is auditable
- destructive actions cannot occur outside explicit policy

### Phase 2: Durable Runtime

Goal:

- make autonomous runs resumable and replay-safe

Deliverables:

- action journal
- leases and heartbeats
- recovery state machine
- replay-safe retries

Exit criteria:

- Athena can recover active runs after restart without ambiguous state
- retry logic is bounded and auditable

### Phase 3: Evidence and Ingestion Hardening

Goal:

- raise the trustworthiness of proposal and decision inputs

Deliverables:

- real source adapters
- citation spans and attribution persistence
- evidence reconciliation
- stronger contradiction inference

Exit criteria:

- every promoted proposal can point to attributable evidence
- evidence quality is visible in operator surfaces

### Phase 4: Fully Autonomous Mode

Goal:

- add policy-bounded no-review execution

Deliverables:

- `fully-autonomous` mode
- escalation thresholds
- stop conditions
- audit trail for autonomous decisions

Exit criteria:

- Athena can run a bounded research program without routine human approval
- policy violations and uncertainty thresholds force stop or escalation

### Phase 5: Production Evals and Soak Reliability

Goal:

- make the system trustworthy under real operating conditions

Deliverables:

- incident taxonomy
- trace and replay tools
- soak tests
- chaos scenarios
- benchmark task suite

Exit criteria:

- overnight and multi-day runs are repeatedly stable across restart and transient failure scenarios

## File-Level Starting Point

If work begins immediately, these files should be treated as the highest-leverage starting points:

- `src/research/contracts.ts`
- `src/research/automation-manager.ts`
- `src/research/team-orchestrator.ts`
- `src/security/policy.ts`
- `src/store/migrations.ts`
- `src/cli/research.ts`
- `src/ui/panels/research-status.tsx`

Rationale:

- these files define the system's control vocabulary, runtime decisions, persistence boundary, and control surface

## Suggested First Implementation Slice

The smallest meaningful next slice should be:

1. add `fully-autonomous` mode to contracts
2. add `AutonomyPolicy` with bounded budgets and risk tier
3. persist policy on each team run
4. update automation gating to use policy rather than implicit operator review assumptions
5. surface the selected autonomy mode and risk budget in CLI and TUI
6. add regression tests for:
   - blocked unsafe autonomous action
   - allowed low-risk autonomous action
   - stop on budget exhaustion
   - stop on repeated retry exhaustion

Why this first:

- it changes the system's operating model without yet requiring the full ingestion or observability stack
- it converts autonomy from an informal behavior into an explicit contract

## Open Design Decisions

These should be resolved early in the cycle:

1. Should `fully-autonomous` be a new automation mode or a separate policy flag layered over existing modes?
   - recommendation: new mode plus explicit policy object

2. Should Athena build its own durable runtime or adopt an external workflow engine?
   - recommendation: first harden the current in-repo runtime model; evaluate external workflow integration only if recovery logic becomes too complex

3. What is the minimum safe capability set for full autonomy?
   - recommendation: start with repo-local file edits, bounded local execution, and explicitly approved remote scopes only

4. When should Athena escalate to a human even in full autonomy mode?
   - recommendation: policy violation, uncertain evidence, repeated failure, or missing rollback path

## Decision Recommendation

Proceed with the next cycle under this framing:

- near-term product target: production operator-supervised Athena
- architecture target: fully autonomous Athena as a policy-bounded extension of the same runtime

Do not split these into separate systems.

Athena should remain one research runtime with progressively stronger autonomy modes:

- `manual`
- `assisted`
- `supervised-auto`
- `overnight-auto`
- `fully-autonomous`

## Immediate Next Documents To Create

After this roadmap, create:

1. `docs/plans/2026-03-14-fully-autonomous-mode.md`
   - implementation plan for the first slice

2. `docs/security-model-rfc.md`
   - detailed capability and policy design

3. `docs/research-runtime-durability-rfc.md`
   - action journal, lease, and recovery design

4. `docs/evidence-ingestion-rfc.md`
   - source adapters, citations, and contradiction design

These four docs should turn this roadmap into executable engineering work.
