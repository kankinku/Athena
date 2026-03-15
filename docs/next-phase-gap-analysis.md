# Next-Phase Gap Analysis

## Current State

Athena already has the skeleton of an autonomous research system:

- structured run state
- evidence and proposal handling
- execution and simulation paths
- recovery and automation scaffolding
- operator inspection surfaces

The next cycle should not reinvent the product. It should harden the loop.

## Highest-Priority Gaps

### 1. Permissioning and safety depth

Athena has a security floor, but it still needs stronger scoped permissions and clearer high-risk autonomy governance.

### 2. Durable long-running execution

Crash recovery and automation exist, but stronger replay-safe long-duration execution is still needed for high-confidence autonomy.

### 3. Evidence quality

Athena needs deeper ingestion, attribution, contradiction handling, and evidence trust signals.

### 4. Evaluation depth

The evaluate stage needs richer graded validation beyond narrow regression coverage.

### 5. Soak reliability

The loop needs broader real-world soak evidence across local and remote environments.

## Recommended Execution Order

1. permission and policy hardening
2. durable execution and recovery
3. evidence ingestion and attribution
4. richer evaluation and operator observability
5. broader soak validation
