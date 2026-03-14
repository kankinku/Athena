# Athena Operator-Supervised Production Tutorial

## Purpose

This tutorial explains how to verify Athena's operator-supervised production path end to end.

Use this when you want to:

- confirm the supervised runtime is healthy
- generate a soak artifact
- read the current production checklist
- understand why the result is `green`, `red`, or `blocked`
- collect the evidence needed to close roadmap `Steps 9-14`

This document is practical on purpose. It assumes you are running Athena locally from this repository and using PowerShell.

## What "done" means here

For the operator-supervised roadmap, `100%` does not mean "the code exists".

It means:

- the supervised feature set is implemented
- the validation commands pass
- the soak artifact is recorded
- the checklist is `green`
- the result is backed by real topology coverage, not placeholder numbers

If the checklist is `blocked`, that usually means the environment is incomplete.

If the checklist is `red`, that means Athena exercised the topology but found a real failure.

## Files You Will Use

- `docs/operator-supervised-production-roadmap.md`
- `docs/supervised-production-checklist.md`
- `docs/supervised-production-evidence-2026-03-14.md`
- `src/research/soak-harness.ts`
- `src/cli/research.ts`

## Prerequisites

1. Install dependencies and make sure the repo builds.
2. Have a valid provider setup for normal Athena use.
3. For smoke verification only, a temporary `ANTHROPIC_API_KEY=test-key` environment variable is enough.
4. If you want `single_remote` or `multi_host` coverage, configure remote machines first.

## Topology Rules

Athena evaluates three supervised topologies:

- `local_only`
- `single_remote`
- `multi_host`

Expected requirements:

- `local_only`: no remote machine required
- `single_remote`: at least `1` configured remote machine
- `multi_host`: at least `2` configured remote machines

If the required remote machines do not exist, Athena will mark the missing topology as `blocked`.

## Step 1: Run Verification First

Run the focused verification suite:

```powershell
node --import tsx --test src/security/policy.test.ts src/security/audit-store.test.ts src/cli/security.test.ts src/research/review-flow.test.ts src/research/cli-regression.test.ts src/research/soak-harness.test.ts src/store/migrations-upgrade.test.ts
```

Then run the build:

```powershell
npm run build
```

Do not move to the soak step unless both commands succeed.

## Step 2: Prepare an Isolated Athena Home

Use a clean Athena home for repeatable evidence capture:

```powershell
New-Item -ItemType Directory -Force -Path .tmp-soak-home | Out-Null
$env:ATHENA_HOME = (Resolve-Path .tmp-soak-home).Path
$env:ANTHROPIC_API_KEY = "test-key"
```

This prevents an older soak artifact from being reused accidentally.

## Step 3: Run the Supervised Soak Command

Generate the soak artifact:

```powershell
node --import tsx src/bootstrap.ts research soak
```

What this currently does:

- runs a real local smoke execution
- inspects configured remote machines
- writes a soak artifact to `$env:ATHENA_HOME\supervised-production-soak.json`
- prints the current supervised checklist summary

Expected output shape:

```text
artifact  <path-to-supervised-production-soak.json>
generated_at  <timestamp>
machines  local[,remote1,...]
# Athena Supervised Production Checklist
...
```

## Step 4: Read the Checklist

Read the latest checklist from the recorded artifact:

```powershell
node --import tsx src/bootstrap.ts research checklist
```

Interpretation:

- `overall=green`: all required exercised topologies passed
- `overall=blocked`: one or more required topologies could not be exercised in this environment
- `overall=red`: Athena exercised the topology and found a real failure

## Step 5: Understand the Output

Each checklist line has this shape:

```text
- <scenario>: status=<pass|fail|blocked> pass=<true|false> completion=<n> recovery=<n> rollback=<n> notes=<...>
```

Meaning:

- `status=pass`: the scenario passed its thresholds
- `status=fail`: the scenario ran but did not meet thresholds
- `status=blocked`: the scenario was not runnable in the current environment
- `completion`: completed attempts / total attempts
- `recovery`: successful recoveries / induced failures
- `rollback`: rollback exercises / induced failures
- `notes`: the exact blocking or failure reason

Examples:

- `requires_remote_machines=1 configured=0`
  - `single_remote` is blocked because no remote machine exists
- `requires_remote_machines=2 configured=1`
  - `multi_host` is blocked because only one remote machine exists
- `unrecoverable=1|recovery_gap`
  - the scenario ran and produced a real recovery failure

## Step 6: Configure Remote Machines

Athena loads remote machines from:

```text
$env:ATHENA_HOME\machines.json
```

The JSON shape follows `src/remote/types.ts`:

```json
[
  {
    "id": "gpu-1",
    "host": "10.0.0.21",
    "port": 22,
    "username": "ubuntu",
    "authMethod": "key",
    "keyPath": "C:\\Users\\you\\.ssh\\id_ed25519"
  },
  {
    "id": "gpu-2",
    "host": "10.0.0.22",
    "port": 22,
    "username": "ubuntu",
    "authMethod": "key",
    "keyPath": "C:\\Users\\you\\.ssh\\id_ed25519"
  }
]
```

After editing `machines.json`, re-run:

```powershell
node --import tsx src/bootstrap.ts research soak
node --import tsx src/bootstrap.ts research checklist
```

## Step 7: What Counts as a Green Exit

You may treat supervised production as closed only when all of the following are true:

1. The focused verification suite passes.
2. `npm run build` passes.
3. `research soak` records the artifact successfully.
4. `research checklist` returns `overall=green`.
5. `docs/supervised-production-checklist.md` is updated with the current green output.
6. `docs/supervised-production-evidence-*.md` records the commands and observed output.

## Step 8: Update the Evidence Docs

Once you have a meaningful run, copy the real command outputs into:

- `docs/supervised-production-checklist.md`
- `docs/supervised-production-evidence-2026-03-14.md` or a newer dated evidence file

Do not replace blocked or red output with hand-written "expected green" text.

## Current Known State

As of `2026-03-14`, the repository is in this state:

- supervised features are largely implemented
- local smoke can pass
- remote topology proof is environment-dependent
- without configured remote machines, the checklist is expected to remain `blocked`

That is not a code failure. It is an environment completeness issue.

## Recommended Operator Flow

For each serious verification pass, use this sequence:

```powershell
node --import tsx --test src/security/policy.test.ts src/security/audit-store.test.ts src/cli/security.test.ts src/research/review-flow.test.ts src/research/cli-regression.test.ts src/research/soak-harness.test.ts src/store/migrations-upgrade.test.ts
npm run build
node --import tsx src/bootstrap.ts research soak
node --import tsx src/bootstrap.ts research checklist
```

If the result is `blocked`, fix topology.

If the result is `red`, fix runtime behavior.

If the result is `green`, update the evidence documents and close the remaining roadmap exit gate.
