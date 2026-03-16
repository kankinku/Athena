# State Machine

This document explains Athena's state model at two levels:

- the product-level loop shape
- the exact runtime workflow states currently enforced in code

## Product-Level Loop

Athena is built around a repeating improvement loop:

```text
goal -> collect -> compare -> plan -> improve -> evaluate -> keep, discard, or revisit -> repeat
```

This is the product-level mental model.

It explains what Athena is trying to do, but it is not the exact enum used by the runtime.

## Exact Runtime Workflow States

The current research runtime uses `ResearchWorkflowState` in `src/research/contracts.ts`.

The valid states are:

- `draft`
- `ready`
- `approved`
- `running`
- `evaluating`
- `reported`
- `revisit_due`
- `archived`
- `failed`

## How The Runtime States Map To The Product Loop

| Product Loop Step | Runtime State |
|---|---|
| goal captured and bounded | `draft` |
| collection, comparison, and next-move planning are being prepared | `ready` |
| bounded approval or release gate is satisfied | `approved` |
| execution or simulation is active | `running` |
| result comparison and keep/discard/revisit judgment are active | `evaluating` |
| the current loop pass has been summarized | `reported` |
| the result should be revisited later | `revisit_due` |
| the run is closed and retained for history | `archived` |
| the run failed and needs recovery or restart | `failed` |

## Exact Transition Rules

The runtime transition rules are currently enforced in `src/research/workflow-state.ts`.

Valid transitions today are:

- `draft -> ready | failed | archived`
- `ready -> approved | running | draft | failed | archived`
- `approved -> running | draft | failed | archived`
- `running -> evaluating | failed | archived`
- `evaluating -> reported | revisit_due | running | failed | archived`
- `reported -> revisit_due | archived`
- `revisit_due -> approved | archived | failed`
- `failed -> draft | ready | archived`

`archived` is terminal.

## Why This Distinction Matters

The product loop should stay simple:

```text
goal -> collect -> compare -> plan -> improve -> evaluate -> keep, discard, or revisit -> repeat
```

The runtime state machine must stay exact so that:

- automation can checkpoint and recover
- reports can explain where a run stands
- operator intervention points are visible
- invalid transitions are rejected

## Related Runtime Records

The runtime also tracks:

- `TeamRunRecord` for the current run envelope
- `WorkflowTransitionRecord` for state transition history
- `AutomationPolicy` and `AutomationRuntimeState` for autonomy and recovery behavior

Those exact structures are defined in:

- `src/research/contracts.ts`

## Documentation Rule

If this document and the code ever disagree, the exact runtime source of truth is:

- `src/research/contracts.ts`
- `src/research/workflow-state.ts`
