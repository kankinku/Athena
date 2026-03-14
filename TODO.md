# Athena Refactor TODO

Notes:
- Follow `$karpathy-guidelines`.
- Keep each cut small and verifiable.
- Preserve behavior first, then reduce responsibility overlap.

## Step 1

- [x] Fix `recordProposalBrief()` graph/state divergence
- [x] Add blocked automation path regression test

## Step 2

- [x] Split simulation persistence into `simulation-store.ts`
- [x] Split improvement persistence into `improvement-store.ts`
- [x] Split proposal persistence into `proposal-store.ts`
- [x] Split decision/reconsideration persistence into `decision-store.ts`
- [x] Split experiment lineage persistence into `lineage-store.ts`
- [x] Split ingestion persistence into `ingestion-store.ts`
- [x] Split team run persistence into `team-run-store.ts`
- [x] Split workflow transition persistence into `workflow-store.ts`
- [x] Split automation checkpoint persistence into `automation-store.ts`
- [x] Add delegation-preservation tests for each extracted store
- [x] Write a concise `TeamStore` responsibility boundary note
- [x] Separate remaining run/workflow/automation concerns from repository concerns
- [x] Keep existing research tests green

## Step 3

- [x] Split runtime polling side effects out of `layout.tsx`
- [x] Split streaming/input/runtime bridge side effects out of `layout.tsx`
- [x] Split `commands.ts` into registry + handlers
- [x] Add UI command regression tests

## Step 4

- [x] Break `createRuntime()` into builder stages
- [x] Clarify provider/runtime/tool registration boundaries

## Step 5

- [x] Add explicit provider capability model
- [x] Add Claude/OpenAI parity tests

## Step 6

- [x] Extract shared ACP/TUI orchestration bridge
- [x] Remove duplicated monitor/wake/task-poll flow

## Step 7

- [x] Rebuild the default test entrypoint
- [x] Align CI and local test execution paths

## Step 8

- [ ] Add a fully autonomous mode that removes the operator-supervised approval/review dependency while preserving bounded safety, auditability, and recovery controls
