# Task Statement

Implement the first Step 9 slice from `docs/operator-supervised-production-roadmap.md`: introduce a formal, capability-aware security model for operator-supervised runs without breaking the current security floor.

# Desired Outcome

- Athena keeps existing allow/review/block behavior
- security decisions become capability-aware instead of regex-only
- decisions can be persisted as audit records
- core high-risk tool paths use richer security context
- CLI surfaces the active security envelope and audit state
- targeted tests and build pass

# Known Facts / Evidence

- `README.md` still calls the missing permission model the biggest production gap
- `src/security/policy.ts` is currently regex-based with protected path allowlists
- `src/remote/connection-pool.ts` and `src/remote/file-sync.ts` enforce security decisions
- `src/tools/file-ops.ts` and `src/tools/remote-sync.ts` call directly into `SecurityManager`
- `docs/operator-supervised-production-roadmap.md` defines Step 9 as capability model + audit persistence + tool enforcement

# Constraints

- Keep the cut small and verifiable
- Preserve existing behavior where capability config is absent
- Avoid broad refactors outside security/runtime/tool boundaries
- Do not revert unrelated work in the dirty tree

# Unknowns / Open Questions

- How much run-scoped capability wiring can be added without introducing a new orchestration layer
- Whether remote execution tools should pass richer context through `RemoteExecutor` or only through direct tool wrappers in this slice

# Likely Codebase Touchpoints

- `src/security/policy.ts`
- `src/security/contracts.ts`
- `src/security/audit-store.ts`
- `src/store/migrations.ts`
- `src/config/project.ts`
- `src/cli/security.ts`
- `src/remote/connection-pool.ts`
- `src/remote/file-sync.ts`
- `src/remote/executor.ts`
- `src/tools/file-ops.ts`
- `src/tools/remote-sync.ts`
- `src/tools/remote-exec.ts`
- `src/tools/research-orchestration.ts`
