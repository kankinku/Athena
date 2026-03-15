# Change Proposal Schema

This document describes Athena's proposal artifact at two levels:

- the product meaning of a proposal
- the exact runtime fields currently defined in code

The exact runtime contract lives in `src/research/contracts.ts` as `ProposalBrief`.

## Product Meaning

A proposal is Athena's durable representation of the next bounded improvement candidate.

It is the unit that lets Athena move from:

```text
possible improvement -> scored candidate -> bounded action inside the loop
```

## Exact Runtime Contract

In code today, `ProposalBrief` contains:

- `proposalId`
- `title`
- `summary`
- `targetModules`
- `expectedGain`
- `expectedRisk`
- `codeChangeScope`
- `staticScores`
- `scorecard`
- `status`
- `experimentBudget`
- `stopConditions`
- `reconsiderConditions`
- `claimIds`
- `claimSupport`

## Interpretation Of Important Fields

### Identity

- `proposalId` identifies the proposal across reports, decisions, and experiments

### Intent

- `title` and `summary` explain what Athena thinks should change

### Scope

- `targetModules` and `codeChangeScope` define where the change is expected to land

### Expected Outcome

- `expectedGain` describes the improvement Athena is trying to create
- `expectedRisk` describes the main downside or failure pressure Athena expects

### Evaluation And Gating

- `scorecard` contains evidence-backed scoring information
- `experimentBudget` constrains how much experimentation is allowed
- `stopConditions` define when Athena should stop pushing the proposal
- `reconsiderConditions` define when Athena should revisit it later

### Evidence Links

- `claimIds` link the proposal to evidence-backed claims
- `claimSupport` summarizes coverage, freshness, contradictions, and unresolved gaps

## What This Schema Is Not

This is not a generic PR template and not a raw patch description.

In Athena, a proposal is a loop artifact. It exists so the system can score, compare, run, defer, revisit, or reject a candidate improvement.

## Documentation Rule

If this document and the code ever disagree, the exact runtime source of truth is:

- `src/research/contracts.ts`
