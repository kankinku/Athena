# Athena Supervised Mode Production Checklist

This checklist is the exit artifact for Athena's supervised production mode.

It should be read as a mode-specific validation document for the broader autonomous research system.

Use it to verify:
- supervised execution remains bounded
- review points are visible
- recovery works under the tested topology
- evidence is sufficient for operator trust

---

## Status: NOT YET COMPLETE

> This checklist has **not been executed**. All items below are pending operator validation.
> Do not treat this document as evidence of production readiness until each item has a recorded result.

---

## Pre-Validation: Security & Loop Integrity

| # | Check | Result | Date | Operator |
|---|-------|--------|------|----------|
| S-1 | Merge gates persist across resume and block unauthorized merge | _pending_ | | |
| S-2 | web_fetch blocks private/internal hosts (SSRF protection) | _pending_ | | |
| S-3 | Zero-exit experiments classified as `inconclusive`, not `success` | _pending_ | | |
| S-4 | Pipeline resume uses only run-scoped artifacts (no stale fallback) | _pending_ | | |
| S-5 | Background task .pid marker enables recovery after parent crash | _pending_ | | |
| S-6 | Regression escalation respects optimization direction | _pending_ | | |

## Supervised Execution Boundaries

| # | Check | Result | Date | Operator |
|---|-------|--------|------|----------|
| E-1 | Automation policy `supervised-auto` blocks unreviewed actions | _pending_ | | |
| E-2 | Budget ceiling halts loop before exhaustion | _pending_ | | |
| E-3 | Iteration ceiling stops after configured max cycles | _pending_ | | |
| E-4 | High-risk commands blocked by security policy | _pending_ | | |
| E-5 | Operator can pause/resume from CLI | _pending_ | | |

## Observability & Recovery

| # | Check | Result | Date | Operator |
|---|-------|--------|------|----------|
| O-1 | `athena research workflow <run-id>` shows full state history | _pending_ | | |
| O-2 | `athena research incidents` surfaces blocked/failed events | _pending_ | | |
| O-3 | `athena report <session-id\|run-id>` generates readable report | _pending_ | | |
| O-4 | Checkpoint/resume produces consistent state after restart | _pending_ | | |
| O-5 | Rollback plan executes when triggered | _pending_ | | |

## Soak Validation

| # | Check | Result | Date | Operator |
|---|-------|--------|------|----------|
| K-1 | Local overnight run (4h+) completes without unrecoverable failure | _pending_ | | |
| K-2 | Remote single-host run completes with disconnect recovery | _pending_ | | |
| K-3 | Soak artifact reflects real execution (not synthetic) | _pending_ | | |

## Signoff

| Role | Name | Date | Verdict |
|------|------|------|---------|
| Operator | | | |
| Developer | | | |

**Verdict options**: `pass` | `pass-with-conditions` | `fail`

If `pass-with-conditions`, list conditions below:
- (none recorded)
