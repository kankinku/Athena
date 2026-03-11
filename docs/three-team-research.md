# Three-Team Research Workflow

Athena now includes a staged research foundation built around three cooperating phases:

1. Collection team
2. Planning team
3. Simulation team

## Core Runtime Surfaces

- Graph memory: `src/memory/graph-memory.ts`
- Workflow contracts: `src/research/contracts.ts`
- Team run persistence: `src/research/team-store.ts`
- Team orchestration: `src/research/team-orchestrator.ts`
- Simulation execution and budget enforcement: `src/research/simulation-runner.ts`
- Research tools: `src/tools/research-orchestration.ts`
- Reporting input builder: `src/research/reporting.ts`
- Decision engine: `src/research/decision-engine.ts`
- Ingestion scaffolding: `src/research/ingestion.ts`

## Retrieval and Handoffs

`ContextGate` now includes:

- active task summaries
- team handoff summaries
- recent proposal and simulation state
- bounded graph context extracted from research roots

This means checkpoints preserve not only conversation summaries, but also the current research graph and cross-team state.

## Decision Layer and Scorecards

Proposal handling now includes:

- standardized scorecards with weighted decision scores
- explicit decision records (`adopt`, `trial`, `defer`, `reject`, `revisit`)
- reconsideration triggers for deferred or revisitable outcomes

Simulation results and budget overruns propagate into the same decision trail, so operator reporting can explain why a proposal moved forward or stopped.

## Experiment Ledger and Lineage

Athena now tracks experiment lineage records that connect:

- proposals to simulations
- simulations to baselines
- validation outcomes to decision propagation

This creates an initial ledger that is more structured than a flat run log.

## Operator Views

Use:

```bash
athena research runs
athena research proposals
athena research simulations
athena research decisions [proposal-id]
athena research lineage [proposal-id]
athena research ingestion
athena research graph <root-id>
```

These commands expose the current research state without querying SQLite directly.

## Ingestion Scaffolding

Athena includes an initial ingestion layer for registering sources before full claim extraction automation:

- ingestion source records in SQLite
- `ingestion_register_source` research tool
- helper utilities for turning a source record into a candidate pack scaffold

## Reporting

`writeup` and `athena report` now prioritize:

- `ProposalBrief`
- `SimulationRun`
- `ExperimentResult`
- recent session excerpts

instead of relying only on raw transcript replay.

## Budget Enforcement

Simulation runs support hard stop conditions through `ExperimentBudget`:

- `maxIterations`
- `maxCostUsd`
- `maxInputTokens`
- `maxWallClockMinutes`

During task polling, active simulation runs are inspected and terminated if any configured budget is exceeded. Exceeded runs are recorded as discarded with budget-overrun notes in the simulation result payload.

## Smoke Validation

Run:

```bash
npm run smoke:research
```

The smoke flow validates that:

- migrations initialize in a clean `ATHENA_HOME`
- team runs, proposals, simulations, decisions, lineage, and ingestion sources can be persisted
- report input generation includes proposal, decision, ledger, and ingestion sections
- checkpoint briefings include handoff and graph context
