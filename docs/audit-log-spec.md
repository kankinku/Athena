# Audit Log Specification

This document defines what Athena must record to make autonomous improvement inspectable and recoverable.

## Why It Exists

Autonomy without durable history becomes guesswork.

Athena needs audit records for:
- what action was planned
- what action was issued
- what happened
- what evidence or policy justified it
- how recovery or rollback was handled

## Required Event Families

- proposal creation and updates
- evidence collection and impact analysis
- review or meeting decisions
- execution start, progress, completion, and failure
- verification outcomes
- rollback and recovery events
- policy decisions and blocks

## Design Rule

The audit layer should make it possible to reconstruct the life of a run without replaying the entire conversation history.
