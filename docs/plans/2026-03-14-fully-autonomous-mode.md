# Fully Autonomous Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a first-class `fully-autonomous` mode to Athena with explicit bounded policy, runtime gating, and operator visibility.

**Architecture:** Extend the existing research runtime instead of creating a parallel autonomy stack. Introduce an explicit autonomy policy into the research contracts, persist it on runs, route automation gating through that policy, and surface the resulting autonomy envelope in CLI and TUI. Keep the first slice narrow: no full durable action journal yet, but no implicit approval semantics either.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, Effect CLI, Ink, existing Athena research runtime and migrations.

---

### Task 1: Add autonomy vocabulary to research contracts

**Files:**
- Modify: `src/research/contracts.ts`
- Test: `src/research/workflow-state.test.ts`

**Step 1: Add the new mode**

Update `AutomationMode` to include `fully-autonomous`.

Add:

```ts
export type RiskTier = "safe" | "moderate" | "high";

export interface AutonomyPolicy {
  maxRiskTier: RiskTier;
  maxCostUsd?: number;
  maxWallClockMinutes?: number;
  maxRetryCount?: number;
  requireRollbackPlan: boolean;
  requireEvidenceFloor?: number;
  allowedToolFamilies?: string[];
  allowedMachineIds?: string[];
}
```

Add `autonomyPolicy: AutonomyPolicy` to the team run contract if no equivalent field already exists.

**Step 2: Run targeted typecheck via build**

Run: `npm run build`

Expected:

- build fails where new fields are now required

**Step 3: Adjust compile errors minimally**

Update any construction sites that instantiate team runs or automation modes so they compile with a default policy.

**Step 4: Run build again**

Run: `npm run build`

Expected:

- build passes for this contract change

**Step 5: Commit**

```bash
git add src/research/contracts.ts
git commit -m "feat: add fully autonomous research policy contracts"
```

### Task 2: Persist autonomy policy on team runs

**Files:**
- Modify: `src/research/team-store.ts`
- Modify: `src/store/migrations.ts`
- Test: `src/research/team-store.test.ts`
- Test: `src/store/migrations-upgrade.test.ts`

**Step 1: Write failing persistence tests**

Add tests that:

- create a run with `fully-autonomous` mode
- persist an `AutonomyPolicy`
- reload the run and assert the policy round-trips

**Step 2: Run the targeted tests**

Run:

```bash
node --import tsx --test src/research/team-store.test.ts src/store/migrations-upgrade.test.ts
```

Expected:

- FAIL with missing column, missing field, or serialization mismatch

**Step 3: Add migration and serialization support**

Update the team-run table schema or serialized payload storage to persist:

- automation mode
- autonomy policy

Prefer the narrowest change that preserves backward compatibility with existing rows.

**Step 4: Re-run the targeted tests**

Run:

```bash
node --import tsx --test src/research/team-store.test.ts src/store/migrations-upgrade.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add src/research/team-store.ts src/store/migrations.ts src/research/team-store.test.ts src/store/migrations-upgrade.test.ts
git commit -m "feat: persist autonomy policy on research runs"
```

### Task 3: Replace implicit approval assumptions in automation gating

**Files:**
- Modify: `src/research/automation-manager.ts`
- Modify: `src/research/team-orchestrator.ts`
- Test: `src/research/automation-manager.test.ts`
- Test: `src/research/review-flow.test.ts`

**Step 1: Write the failing policy-gating tests**

Cover these cases:

- `fully-autonomous` plus safe policy allows low-risk progression
- `fully-autonomous` blocks when retry count exceeds policy
- `fully-autonomous` blocks when rollback plan is missing
- supervised modes preserve current review semantics

**Step 2: Run the targeted tests**

Run:

```bash
node --import tsx --test src/research/automation-manager.test.ts src/research/review-flow.test.ts
```

Expected:

- FAIL on missing policy-aware behavior

**Step 3: Implement minimal policy-aware gating**

Rules for the first slice:

- if mode is not `fully-autonomous`, keep existing behavior
- if mode is `fully-autonomous`, gate execution on:
  - retry count
  - budget ceilings already available
  - presence of rollback plan
  - optional allowed machine list

Return blocked automation state with a clear reason when policy disallows continuation.

**Step 4: Re-run the targeted tests**

Run:

```bash
node --import tsx --test src/research/automation-manager.test.ts src/research/review-flow.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add src/research/automation-manager.ts src/research/team-orchestrator.ts src/research/automation-manager.test.ts src/research/review-flow.test.ts
git commit -m "feat: gate autonomous runs by explicit policy"
```

### Task 4: Surface autonomy mode and policy envelope in CLI

**Files:**
- Modify: `src/cli/research.ts`
- Modify: `src/cli/report.ts`
- Test: `src/research/cli-regression.test.ts`
- Test: `src/research/report-snapshot.test.ts`

**Step 1: Add failing CLI expectations**

Add snapshot or string-based assertions that run detail output includes:

- automation mode
- risk tier
- key budget caps
- blocked reason if policy stops the run

**Step 2: Run the targeted tests**

Run:

```bash
node --import tsx --test src/research/cli-regression.test.ts src/research/report-snapshot.test.ts
```

Expected:

- FAIL due to missing autonomy fields in output

**Step 3: Implement output updates**

Update research detail views and report sections so the new policy is visible in operator-facing output.

**Step 4: Re-run the targeted tests**

Run:

```bash
node --import tsx --test src/research/cli-regression.test.ts src/research/report-snapshot.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add src/cli/research.ts src/cli/report.ts src/research/cli-regression.test.ts src/research/report-snapshot.test.ts
git commit -m "feat: show autonomy policy in research cli and reports"
```

### Task 5: Surface autonomy state in the TUI

**Files:**
- Modify: `src/ui/panels/research-status.tsx`
- Test: `src/ui/panels/research-status.test.tsx`

**Step 1: Write the failing panel test**

Assert that the research status panel renders:

- `MODE fully-autonomous`
- a compact budget or risk indicator
- policy stop state if present

**Step 2: Run the targeted test**

Run:

```bash
node --import tsx --test src/ui/panels/research-status.test.tsx
```

Expected:

- FAIL

**Step 3: Implement the smallest display change**

Keep the panel concise. Add one compact autonomy envelope summary rather than a full policy dump.

**Step 4: Re-run the targeted test**

Run:

```bash
node --import tsx --test src/ui/panels/research-status.test.tsx
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add src/ui/panels/research-status.tsx src/ui/panels/research-status.test.tsx
git commit -m "feat: show autonomous mode in research status panel"
```

### Task 6: Add end-to-end regression coverage for autonomous stop behavior

**Files:**
- Test: `src/e2e/local-research.test.ts`
- Test: `src/e2e/remote-research.test.ts`

**Step 1: Add one narrow end-to-end scenario**

Cover:

- create a run in `fully-autonomous` mode
- allow a low-risk action
- trigger a bounded stop such as retry exhaustion or budget stop
- assert the run lands in a non-progressing, explainable state

**Step 2: Run the targeted tests**

Run:

```bash
node --import tsx --test src/e2e/local-research.test.ts src/e2e/remote-research.test.ts
```

Expected:

- FAIL or expose missing orchestration wiring

**Step 3: Implement only missing glue**

Avoid widening scope. Wire only what is necessary to make the policy stop visible and durable.

**Step 4: Re-run the targeted tests**

Run:

```bash
node --import tsx --test src/e2e/local-research.test.ts src/e2e/remote-research.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add src/e2e/local-research.test.ts src/e2e/remote-research.test.ts
git commit -m "test: cover bounded fully autonomous research flow"
```

### Task 7: Run release-relevant verification

**Files:**
- Modify: none unless failures require follow-up fixes

**Step 1: Run focused safety and research suites**

Run:

```bash
npm run test:research
npm run test:research:safety
npm run build
```

Expected:

- all pass

**Step 2: If failures appear, fix them before proceeding**

Keep fixes local to autonomy-policy fallout. Do not widen scope into durability or ingestion work in this plan.

**Step 3: Commit verification-safe fixes if needed**

```bash
git add <relevant-files>
git commit -m "fix: stabilize autonomous mode regression coverage"
```

## Notes For The Next Plan

This plan intentionally does not include:

- durable action journal
- lease and heartbeat system
- full permission engine redesign
- evidence-ingestion overhaul

Those belong in follow-up plans once `fully-autonomous` exists as an explicit bounded runtime contract.
