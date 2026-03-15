# Glossary

This glossary locks the terms Athena should use across product, architecture, and operations documents.

## Core Product Terms

### Athena

Athena is an autonomous research system.

Its job is to move a target system toward a goal by repeating a bounded improvement loop:

```text
goal -> plan -> improve -> evaluate -> redesign -> repeat
```

### Autonomous Research System

A system that can repeatedly:

- understand a goal
- gather evidence
- choose the next improvement
- execute or simulate the change
- evaluate the result
- redesign the next move

without collapsing into a single one-shot answer.

### Improvement Loop

The main operating loop of Athena.

This is the product center. Everything else exists to support this loop.

### Goal

The target Athena is trying to improve.

Examples:

- reduce training latency
- improve benchmark quality
- validate a safer implementation path
- identify the next bounded experiment

## Support Terms

### Research

Research is evidence gathering in service of the next improvement.

Research is not the product identity. It exists to justify better loop decisions.

### Evidence

The set of papers, repos, docs, metrics, run outputs, prior decisions, and observations Athena uses to justify a proposed improvement.

### Proposal

A bounded candidate improvement inside the loop.

A proposal is not just an idea. It is a durable unit Athena can score, review, run, defer, or revisit.

### Evaluation

The step where Athena compares the result of a change against the goal, budget, guardrails, and expected metrics.

### Redesign

The step where Athena updates its next move after seeing the result of an evaluation.

## Runtime Terms

### Orchestrator

The directional controller that keeps the loop pointed at the goal.

The orchestrator is not the product itself. It decides what should happen next, what evidence matters, and when the system should pause, retry, escalate, or continue.

### Autoresearch

Structured self-improvement inside Athena.

It means:

- generate variations
- execute or simulate them
- compare the outcomes
- keep promising improvements
- discard regressions

### Run

A single bounded execution of Athena's improvement loop for a given goal.

### Workflow State

The durable lifecycle state of a run inside the research runtime.

In code today, the workflow states are:

- `draft`
- `ready`
- `approved`
- `running`
- `evaluating`
- `reported`
- `revisit_due`
- `archived`
- `failed`

### Automation Mode

The policy envelope that determines how much of the loop Athena may execute autonomously.

In code today, the modes are:

- `manual`
- `assisted`
- `supervised-auto`
- `overnight-auto`
- `fully-autonomous`

## Governance Terms

### Supervised Mode

An operating mode in which Athena can make bounded progress while an operator remains the strongest safety and override layer.

Supervision is a deployment mode, not Athena's core identity.

### Guardrail

A rule that constrains what the loop may do.

Examples:

- risk limits
- required approvals
- rollback requirements
- protected paths
- budget ceilings

### Verification

The checks Athena uses to confirm whether a change should be kept, retried, redesigned, or discarded.

## Preferred Language

Prefer:

- "Athena is an autonomous research system."
- "Athena runs an improvement loop."
- "Research supports improvement selection."
- "The orchestrator keeps the loop pointed at the goal."
- "Supervised mode is Athena's strongest validated operating mode."

Avoid:

- "Athena is mainly an operator-supervised system."
- "Athena is primarily a research assistant."
- "Athena is just a coding agent."
- "The orchestrator is the product."
- "Research is the end goal."
