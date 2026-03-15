# Athena v0.3 Release Readiness

## Release Definition

Athena v0.3 should be understood as:

`a strong-beta autonomous research system with validated operator-supervised modes`

This release is not the finish line for unrestricted autonomy.
It is the point where the core improvement loop, structured state, reporting, automation, and safety rails are solid enough for bounded real use.

## What v0.3 Must Prove

- Athena can hold a goal across multiple iterations
- Athena can persist research and execution state structurally
- Athena can execute and evaluate bounded improvements
- operators can inspect runs, proposals, workflow, and next actions without reading source code
- automation remains inside explicit policy and recovery boundaries

## In Scope

- structured workflow and research state
- claims, proposals, decisions, improvements, and reports
- local and remote execution paths
- automation checkpoints, retry, timeout, and recovery
- operator CLI and TUI surfaces
- security floor and policy enforcement
- regression and smoke coverage for the critical loop paths

## Out of Scope

- unrestricted autonomy
- fully hardened production permissioning
- broad real-world soak coverage across many topologies
- deep external ingestion and evidence attribution at production quality

## Closure Point

v0.3 is ready when this statement is true:

> An operator can give Athena a real improvement goal, let it run through bounded autonomous iterations, inspect what happened, understand why it chose the next action, and recover safely when something goes wrong.
