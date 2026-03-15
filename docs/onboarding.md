# Onboarding

This is the best place to start if you are new to Athena.

## First Sentence To Keep In Mind

Athena is an autonomous research system that repeatedly moves a target system toward a goal through planning, improvement, evaluation, and redesign.

## Start Here

Read these documents in order:

1. [Glossary](./glossary.md)
2. [Vision](./vision.md)
3. [Architecture Overview](./architecture-overview.md)
4. [Current State Mapping](./current-state-mapping.md)
5. [State Machine](./state-machine.md)
6. [Module Autoresearch](./module-autoresearch.md)
7. [Execution Gate](./execution-gate.md)
8. [Verification Pipeline](./verification-pipeline.md)
9. [Guardrails](./guardrails.md)

## What To Understand First

### Athena Is A Loop Runner

Athena is not best understood as a chat UI, a coding agent, or a literature review assistant.

Its center is the improvement loop:

```text
goal -> plan -> improve -> evaluate -> redesign -> repeat
```

### Research Supports Improvement

Athena reads papers, docs, repos, metrics, logs, and prior runs because they can justify a better next move.

Research is a support function for the loop, not the product identity.

### The Orchestrator Is A Directional Controller

The orchestrator keeps Athena pointed at the goal.

It decides what kind of work should happen next, when the system has enough evidence, when to retry, and when to stop or escalate.

### Supervision Is A Mode, Not The Core Definition

Athena can run in supervised modes, and those modes are currently the strongest validated operating modes in the repo.

That does not change the product definition.

Athena remains an autonomous research system first.

## Practical Mental Model

In practice, Athena works like this:

1. A goal is defined.
2. Athena gathers evidence that can support the next bounded improvement.
3. Athena selects or proposes the next change.
4. Athena executes or simulates the change within policy and budget.
5. Athena evaluates the result.
6. Athena redesigns the next move.
7. The loop repeats until convergence, stop conditions, or escalation.

## Operator And Builder Perspective

Operators are mainly responsible for:

- defining goals
- setting budgets and policy boundaries
- approving or overriding higher-risk moves
- reviewing reports and intervention points

Builders are mainly responsible for:

- improving the loop runtime
- improving evidence quality
- improving execution safety
- improving evaluation quality and recovery behavior

## If You Only Read Three Documents

Read these:

1. [Glossary](./glossary.md)
2. [Vision](./vision.md)
3. [Architecture Overview](./architecture-overview.md)
