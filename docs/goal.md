# Goal

This document defines the project-wide goal for Athena.

It is not a backlog, not a milestone checklist, and not a per-run objective.

It is the highest-level purpose that should shape architecture, runtime behavior, product decisions, and future improvements.

## Single Project Goal

Athena exists to autonomously move a target system toward an explicit goal by repeatedly discovering, selecting, and applying the next safe, evidence-backed improvement.

## Core Operating Stages

Athena should operate through this project-wide loop:

1. define the target goal clearly
2. collect the most relevant internal and external material
3. shortlist the best candidate methods or directions
4. use structured planning or agent interaction to choose the next bounded improvement
5. execute or simulate that improvement
6. evaluate the result against the goal
7. keep, discard, revisit, and repeat

This means research collection and planning are not side features.

They are core stages of the system.

## What The Goal Requires

To satisfy that goal, Athena must be able to:

1. accept a clear target from the user or operator
2. collect fresh internal and external material, including methods, repos, prior runs, metrics, and constraints
3. reduce that material into a ranked set of candidate approaches
4. use structured planning, review, or multi-agent interaction to decide the next bounded change
5. execute or simulate that change within policy and budget
6. evaluate the result and keep improvements while discarding regressions
7. preserve memory, state, and reports so the loop can continue across time
8. repeat until convergence, policy block, or missing human-only input

## What Research Means In This Project

Research in Athena is not just reading.

It means:

- finding current methods worth considering
- finding reference repositories or implementations
- finding evidence about tradeoffs, failures, and constraints
- comparing those findings against the current target system
- turning that collection into a usable decision set for the next improvement

If Athena cannot do that well, it cannot choose the right next move well.

## What Planning Means In This Project

Planning in Athena is not just writing a todo list.

It means:

- comparing candidate methods
- deciding which option is most appropriate now
- bounding the scope of the next improvement
- defining rollback and evaluation expectations
- producing an executable next action

When multi-agent interaction or a meeting structure is used, its purpose is to improve decision quality for the next bounded move.

It is not ceremony for its own sake.

## What Every Subsystem Is For

- loop control exists to keep work pointed at the goal
- research exists to gather and compare the material needed for the next move
- planning exists to turn candidate directions into one bounded next move
- execution exists to apply or simulate the chosen move
- evaluation exists to decide keep, discard, revisit, or redesign
- memory and reporting exist to preserve continuity and inspectability
- safety and governance exist to keep the loop bounded and recoverable

## What This Goal Rejects

The project goal is not:

- building a generic chat interface
- maximizing tool count for its own sake
- collecting research without improving the target system
- performing broad rewrites without bounded evidence
- becoming an unrestricted autonomous system
- making the UI the center of the product

## Decision Rule

If a proposed feature does not improve at least one of these, it is not core:

- goal alignment
- evidence quality
- bounded execution
- evaluation quality
- recovery and continuation
- operator visibility

## Project Success Definition

Athena is succeeding as a project when it can:

- keep an improvement loop running on itself or another project
- collect current, relevant material before choosing the next move
- choose the next bounded improvement without losing the goal
- use planning or agent interaction to turn research into an executable next action
- reopen and continue when new evidence changes the decision
- stop only for success, policy boundaries, or human-only input
- leave behind enough state and reporting for the loop to be inspected and resumed

## Related Documents

- [Vision](./vision.md)
- [Non-Goals](./non-goals.md)
- [Success Criteria](./success-criteria.md)
- [Architecture Overview](./architecture-overview.md)
- [Onboarding](./onboarding.md)
