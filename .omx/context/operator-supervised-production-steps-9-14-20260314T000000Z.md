Task statement:
- Complete roadmap Steps 9-14 for operator-supervised production readiness implementation.

Desired outcome:
- Add durable runtime action tracking, leases, evidence-grade ingestion, operator supervision surfaces, incident/eval support, and soak validation scaffolding.

Known facts/evidence:
- Step 9 security slice already exists with capability policy, audit store, and enforcement on major tool paths.
- TeamStore, TeamOrchestrator, AutomationManager, and SimulationRunner already control the supervised runtime.
- Ingestion already stores claims, canonical claims, citation spans, and source attributions, but adapters and operator surfaces are still limited.

Constraints:
- Preserve existing behavior where possible.
- Use additive evolution over rewrites.
- Keep changes testable and grounded in the existing roadmap.

Unknowns/open questions:
- Whether all roadmap exit gates can be fully satisfied in one implementation slice.
- How much of soak validation should be live vs harness-based in this cycle.

Likely codebase touchpoints:
- src/research/contracts.ts
- src/research/team-store.ts
- src/research/automation-manager.ts
- src/research/simulation-runner.ts
- src/research/ingestion-service.ts
- src/cli/research.ts
- src/research/reporting.ts
- src/store/migrations.ts
