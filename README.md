# Athena

> [!CAUTION]
> Athena includes policy enforcement and a security floor, but it does not yet have a fully hardened production permissions model. Treat it as strong-beta software. Use isolated workspaces, backups, and containers for anything important.

**Version:** 0.2.1 · **Status:** Internal Beta (v0.3 target) · **Node.js 20+** required

Athena is a terminal-native autonomous research system.

## Primary Goal

Athena's primary goal is simple:

> move a target system toward a user-defined goal by repeatedly collecting the right material, choosing the right next improvement, and applying it safely

Athena reaches that goal through these core activities:

- research collects current methods, reference repos, prior evidence, and constraints
- comparison reduces that material into the strongest candidate directions
- planning or agent interaction turns the best candidate into one bounded next move
- execution applies or simulates the chosen move
- evaluation decides whether to keep or discard it
- memory and reporting preserve state across long runs
- policy and budgets keep the loop bounded

Its core loop is:

```text
goal → collect evidence → shortlist and compare → plan the next bounded move → execute → evaluate → keep, discard, or revisit → repeat
```

## One-Line Definition

Athena is a terminal-native autonomous research system that uses Claude or OpenAI models to plan, execute, evaluate, and redesign improvements across local and remote machines.

## Core Rules

- the goal is more important than the current chat turn
- the next bounded improvement is more important than a broad rewrite
- current evidence is more important than stale assumptions
- evidence is more important than intuition
- improvements are kept, regressions are discarded
- the loop stops only on success, policy block, or missing human-only input

## Current Product Position

Athena is a strong-beta autonomous research loop runtime.

The most validated operating mode today is `supervised-auto`, but the product center is still autonomous improvement.

**What the codebase includes today:**

- structured research state: workflow history, proposals, decisions, canonical claims, iteration cycles, improvements, and reports
- **Loop Cascade**: when a simulation regression triggers a revisit, the orchestrator automatically cascades back to the collection stage, increments the iteration counter, and records an `IterationCycleRecord` for audit and reporting
- **Docker Runtime**: local commands can be routed through a disposable Docker container (`enableDocker()`), eliminating Windows platform dependencies
- **URL Ingestion hardening**: 5 MB response size cap, 30-second AbortController timeout, content-type validation, boilerplate claim filtering, and `UrlIngestionDiagnostics` for observability
- local and remote execution over SSH, including Windows-safe sync fallbacks (rsync → scp)
- automation policy, retry, timeout, checkpoint, and recovery paths
- graph-backed memory and handoff context
- **TUI Research Detail Panel**: live iteration cycles and proposal scores visible in the TUI alongside run status
- TUI and CLI surfaces for inspection, review, reporting, and control
- security policy enforcement for dangerous commands and sensitive paths
- 296-test suite covering auth, providers, remote execution, automation, TUI state, research flows, and ingestion

**Known remaining gaps:**

- fully hardened permission model for unattended production use
- soak validation on real overnight workloads
- no stable public API (internals may change across minor versions)

## Core Loop

```text
goal
  → collect evidence          (ingestion-service, source-adapters)
  → shortlist and compare     (claim-graph, decision-engine, proposal scorecard)
  → plan the next move        (team-orchestrator, structured planning, conditional agent interaction)
  → execute or simulate       (simulation-runner, remote executor)
  → evaluate                  (result decision, drift calibration)
  → keep / discard / revisit  (result decision, cascadeIteration, reconsideration triggers)
  → repeat
```

Athena is best suited to goals like:

- benchmark a training loop and find the next safe improvement
- explore several implementation changes and keep the best one
- run a long improvement program overnight across local and remote machines
- use external evidence to justify system changes instead of guessing

## Operating Modes

| Mode | Description | Auto-execute |
|------|-------------|-------------|
| `manual` | Athena structures state and recommends actions; operator executes manually | None |
| `assisted` | Bounded low-risk actions only; operator actively present | Evidence collection, reports |
| `supervised-auto` | Autonomous progress within policy; operator monitors asynchronously | Full loop, policy-gated |
| `overnight-auto` | Long-running bounded loop within budgets and gates | Full loop within budget |
| `fully-autonomous` | Loop continues under explicit autonomy policy envelope | Full loop, evidence floor enforced |

The validated story today is strongest in `supervised-auto`. The long-term direction is not to replace the loop — it is to let the same loop run with stronger policy, better evidence, stronger recovery, and tighter stop conditions.

## System Shape

Athena has five layers:

| Layer | Purpose | Key files |
|-------|---------|-----------|
| **Loop Control** | Goal, stage, automation policy, retry, recovery | `core/orchestrator.ts`, `research/team-orchestrator.ts`, `research/automation-manager.ts` |
| **Research and Evidence** | Ingest external sources, extract claims, build candidate packs | `research/ingestion-service.ts`, `research/source-adapters/`, `research/decision-engine.ts` |
| **Execution and Experimentation** | Run improvements locally, over SSH, or in Docker | `remote/connection-pool.ts`, `remote/docker-runtime.ts`, `research/simulation-runner.ts` |
| **Memory and Reporting** | Graph memory, experiment lineage, operator reports | `memory/graph-memory.ts`, `research/reporting.ts`, `ui/panels/research-status.tsx` |
| **Safety and Governance** | Command policy, path policy, approval gates, audit log | `security/policy.ts`, `security/audit-store.ts`, `research/execution-gate.ts` |

See [Architecture Overview](docs/architecture-overview.md) for the full layer breakdown and file mappings.

## Install

```bash
npm install -g @snoglobe/athena
```

## Authentication

**Claude:**

```bash
# Option A: Claude CLI
claude login

# Option B: API key
export ANTHROPIC_API_KEY="sk-ant-..."
# then in TUI: /claude-mode api
```

**OpenAI:** start Athena and complete the OAuth login flow in the TUI.

**Check auth status:**

```bash
athena auth status
```

## Security Floor

Athena enforces a security floor on all command execution and file path access.

- dangerous shell patterns are blocked by default (`rm -rf`, `dd if=`, etc.)
- sensitive paths (`~/.ssh`, cloud credentials, OS config) are protected
- protected writes are blocked in `enforce` mode; flagged for review in `audit` mode
- risky-but-common commands (SSH, package installs) surface for explicit approval

```bash
# inspect active policy
athena security
```

Configure in `athena.json`:

```json
{
  "security": {
    "mode": "enforce",
    "commandPolicy": {
      "allowPatterns": ["^git status$"]
    },
    "pathPolicy": {
      "allowWritePaths": ["^/workspace/project/tmp/"]
    }
  }
}
```

## Docker Runtime (Windows / Isolated Execution)

On Windows or when platform-independent execution is needed, route local commands through a disposable Docker container instead of the host shell:

```typescript
await connectionPool.enableDocker({
  image: "ubuntu:22.04",     // default
  volumes: ["/workspace:/workspace"],
  env: { MY_VAR: "value" },
});
// subsequent pool.exec("local", ...) calls run inside Docker
```

Resource limits applied automatically: `--memory=512m --cpus=1 --network=none --rm`.

Falls back transparently to the host shell when Docker is unavailable.

## Quickstart

```bash
# 1. authenticate
athena auth login --provider claude

# 2. start with a real improvement goal
athena "Benchmark the current training loop, identify the first safe improvement, implement it, evaluate it, and report the result"

# 3. inspect structured run state in the TUI, or from the CLI:
athena research runs
athena research workflow <run-id>
athena research iterations <run-id>   # per-cycle cascade history
athena research proposals
athena research next-actions

# 4. generate a report (accepts session-id or run-id)
athena report <session-id|run-id>
```

## CLI Reference

**Root commands:**

```text
athena [prompt]               Interactive TUI (with optional initial prompt)
athena -p "prompt"            Print response and exit (non-interactive)
athena -c                     Continue the most recent session
athena -r <session-id>        Resume a specific session
athena auth login|logout|status
athena init                   Initialize project config (athena.json)
athena doctor                 Diagnose setup issues
athena security               Show active security floor status
athena sessions               List recent sessions
athena watch <machine:pid>    Stream task output and metrics
athena replay <session-id>    Replay a past session
athena search "query"         Search session histories
athena export [session-id]    Export data to CSV or JSON
athena kill <machine:pid>     Kill a running remote task
athena research ...
athena report [session-id|run-id]
```

The supported root product surface is the goal-driven research runtime.

Older change-management commands remain in the codebase as internal or experimental subsystems and are not part of the supported root CLI.

**Research operator views:**

| Command | Purpose |
|---------|---------|
| `athena research runs` | Show recent and active runs |
| `athena research workflow <run-id>` | Inspect workflow state history |
| `athena research automation <run-id>` | Inspect automation checkpoints and retry state |
| `athena research iterations <run-id>` | Per-cycle iteration cascade history |
| `athena research proposals [--state <state>]` | Inspect proposal queue |
| `athena research scorecard <proposal-id>` | Evidence and scoring detail (9-axis scorecard) |
| `athena research decisions [id] [--tag <tag>]` | Inspect decision records |
| `athena research claims [id]` | Canonical claims and evidence attribution |
| `athena research ingestion` | Ingested source list and evidence health |
| `athena research ingest <value> --type url\|document\|text\|repo` | Ingest a new source |
| `athena research graph [root-id]` | Graph memory subgraph |
| `athena research simulations` | Experiment and simulation history |
| `athena research lineage <proposal-id>` | Experiment lineage chain |
| `athena research improvements` | Self-improvement suggestions |
| `athena research queue` | Review and intervention queue |
| `athena research incidents` | Blocked, risky, or failed runtime incidents |
| `athena research journal <run-id>` | Action journal and recovery trail |
| `athena research operate <id> --kind run\|proposal\|improvement --action ...` | Apply bounded operator actions |
| `athena research revisit <proposal-id>` | Trigger manual revisit |
| `athena research budget` | Budget usage and remaining capacity |
| `athena research next-actions` | Best next actions ranked by priority |
| `athena research review <proposal-id>` | Start or advance proposal review |
| `athena research evals` | Evaluation fixtures |
| `athena research checklist` | Supervised production checklist |
| `athena research soak` | Soak harness artifacts |
| `athena research git-notify` | Git-triggered change detection |
| `athena report [session-id\|run-id]` | Generate an operator-facing report |

## Remote Execution

Athena keeps the improvement loop alive across machines:

- execute locally (host shell or Docker container)
- launch and track work over SSH (`ssh2`)
- sync files to remote machines (rsync, scp fallback on Windows)
- stream output, metrics, and resource usage
- recover interrupted automation paths with checkpoint + resume

## TUI

The TUI provides live visibility into the running loop:

- **Research Status Panel** — active run, workflow state, evidence health, automation policy
- **Research Detail Panel** — last 3 iteration cycles with reason and transition, top 5 proposals with scores
- **Metrics Dashboard** — real-time time-series metrics
- **Task List Panel** — active background processes and their status
- **Sticky Notes** — operator notes persistent across the session
- `Ctrl+T` — Task overlay
- `Ctrl+G` — Metrics overlay
- `Esc` / `Ctrl+C` — Interrupt or quit

## Reports

`athena report <session-id|run-id>` generates a structured operator report including:

- run summary and workflow state
- **Iteration Cycles** section — full cascade history with reasons and transitions
- top claims by confidence and freshness
- evidence coverage gaps (`no_claims_extracted`, `all_claims_low_confidence`, etc.)
- proposal scorecard summary
- decision and recommendation

## Verification

```bash
# fast suite
npm run test:research
npm run test:phase5
npm run test:phase6

# full release suite
npm run test:release
npm run build
```

Use `npm run test:research`, `npm run test:phase5`, and `npm run build` as the core verification path for the loop runtime.

### Internal Beta (v0.3) criteria

| # | Criterion |
|---|-----------|
| IB-01~03 | Loop cascade runs 2+ cycles automatically; proposals are evidence-backed; failure redesigns to a different path |
| IB-04~05 | High-risk actions blocked by policy; budget/iteration ceiling stops loop safely |
| IB-06 | Operator can inspect full run state from CLI alone |
| IB-07~08 | `tsc --noEmit` 0 errors; core test suite fully passes |
| IB-09 | Windows local execution succeeds |
| IB-10 | Consistent one-line definition across README, vision, glossary |

See [Beta Criteria](docs/beta-criteria.md) and [Bounded Autonomy](docs/bounded-autonomy.md) for the full specification.

## Documentation Map

| Document | Purpose |
|----------|---------|
| [Goal](docs/goal.md) | Project-wide goal and decision rule |
| [Glossary](docs/glossary.md) | Term definitions |
| [Onboarding](docs/onboarding.md) | First-run guide |
| [Vision](docs/vision.md) | Product direction |
| [Architecture Overview](docs/architecture-overview.md) | Layer breakdown and key files |
| [Current State Mapping](docs/current-state-mapping.md) | Codebase → concept map |
| [Bounded Autonomy](docs/bounded-autonomy.md) | Per-mode policy boundaries and stop conditions |
| [Beta Criteria](docs/beta-criteria.md) | Internal and limited beta release criteria |
| [Validation Checklist](docs/validation-checklist.md) | 7-scenario operator validation suite |
| [Loop Proof](docs/loop-proof.md) | Evidence template for representative runs |
| [Release Decision Flow](docs/release-decision-flow.md) | Go/no-go process |
| [Release Readiness v0.3](docs/release-readiness-v0.3.md) | Current readiness status |
| [Production Autonomy Roadmap](docs/production-autonomy-roadmap.md) | Path to unattended production |
| [Operator Runbook](docs/operator-runbook.md) | Day-to-day operations reference |
| [Module Autoresearch](docs/module-autoresearch.md) | Per-module improvement research spec |
| [Supervised Production Tutorial](docs/modes/operator-supervised-production-tutorial.md) | End-to-end supervised run walkthrough |

## Summary

Athena is an autonomous research system whose core value is repeatedly moving a target system closer to its goal through evidence-backed planning, execution, evaluation, and redesign.
