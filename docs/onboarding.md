# Onboarding

This is the best place to start if you are new to Athena.

## First Sentence To Keep In Mind

Athena exists to move a target system toward a goal by repeatedly collecting the right material, choosing the next safe improvement, and applying it.

## Start Here

Read these documents in order:

1. [Goal](./goal.md)
2. [Glossary](./glossary.md)
3. [Vision](./vision.md)
4. [Architecture Overview](./architecture-overview.md)
5. [Current State Mapping](./current-state-mapping.md)
6. [State Machine](./state-machine.md)
7. [Module Autoresearch](./module-autoresearch.md)
8. [Execution Gate](./execution-gate.md)
9. [Verification Pipeline](./verification-pipeline.md)
10. [Guardrails](./guardrails.md)

## What To Understand First

### Athena Is A Loop Runner

Its center is the improvement loop:

```text
goal -> collect -> compare -> plan -> execute -> evaluate -> redesign -> repeat
```

The important point is that collection and planning are part of the core loop, not side work around it.

### Research Supports Improvement

Athena reads papers, docs, repos, metrics, logs, and prior runs because they help determine the next move.

Research is not separate from the product. It is one of the core stages required to make the right improvement decision.

### The Orchestrator Is A Directional Controller

The orchestrator keeps Athena pointed at the goal.

It decides what kind of work should happen next, when the system has enough evidence, when to retry, and when to stop or escalate.

### Supervision Is A Mode, Not The Core Definition

Supervision is a safety envelope, not the product identity.

Athena remains an autonomous improvement runtime first.

## Practical Mental Model

In practice, Athena works like this:

1. A goal is defined.
2. Athena gathers relevant current material, including methods, repos, prior runs, and constraints.
3. Athena compares candidates and selects the next bounded change through planning or structured agent interaction.
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

1. [Goal](./goal.md)
2. [Vision](./vision.md)
3. [Architecture Overview](./architecture-overview.md)

## Feature Classification

All features in Athena are classified as Core, Conditional, Support, or Experimental.

See [Feature Map](./feature-map.md) for the complete list with document references.

The short rule:

- **Core** — directly constructs one of the six loop stages (collect, compare, plan, execute, evaluate, repeat)
- **Conditional** — needed only on specific coordination paths, not the default loop path
- **Support** — needed for operator observation, intervention, or persistence, but does not construct the loop
- **Experimental** — not yet integrated with the core loop; not part of the supported product surface
