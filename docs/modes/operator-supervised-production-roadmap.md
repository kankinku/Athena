# Athena Operator-Supervised Production Roadmap

## Purpose

This roadmap defines what it means for one operating mode of Athena to be production-ready:

`operator-supervised autonomy`

## Important Framing

Athena itself is not a supervision-first product.

Athena is an autonomous research system.

This roadmap exists because supervised operation is currently the strongest validated deployment mode for that system.

## What This Mode Must Prove

- Athena can make bounded autonomous progress without losing goal alignment
- operators can inspect and intervene at high-risk points
- recovery, rollback, and policy decisions are visible
- evidence is strong enough for operators to trust the loop's recommendations

## Required Capabilities

1. clear operator surfaces
2. policy-bounded execution
3. durable recovery
4. trustworthy reporting
5. repeatable soak evidence

## Success Condition

This mode is ready when operators can safely let Athena run bounded real workloads, step in when needed, and understand what happened without digging into source code or raw runtime artifacts.
