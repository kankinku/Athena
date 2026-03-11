# Draft: Helios Three-Team Research System

## Goal
- Plan a three-team architecture that combines collection, planning/decision, and advanced simulation workflows.
- Ground the design in existing Helios patterns plus MiroFish/autoresearch-inspired concepts.

## Current Findings
- `03-master` is effectively empty as a code surface; actionable implementation anchors are in `02-helios`.
- `02-helios` already has orchestration, session persistence, memory, metrics, experiment tracking, branching, reporting, and consult flows.
- Existing memory is session-scoped tree storage in SQLite, not graph memory.
- Existing experiments are task/run-centric with metrics comparison, not proposal/scenario-centric.
- Runtime composition is centralized in `C:\Users\hanji\Desktop\Project Vault\02-helios\src\init.ts`, which wires providers, tools, memory, metrics, task polling, monitor, branching, and hub integration.
- Core execution boundary is `Orchestrator` + provider/tool streaming in `C:\Users\hanji\Desktop\Project Vault\02-helios\src\core\orchestrator.ts` and `C:\Users\hanji\Desktop\Project Vault\02-helios\src\providers\types.ts`.
- Persistence already uses SQLite migrations for `sessions`, `messages`, `tasks`, `metrics`, and `memory_nodes` in `C:\Users\hanji\Desktop\Project Vault\02-helios\src\store\migrations.ts`.
- Experiment loop primitives already exist: tracked background runs in `C:\Users\hanji\Desktop\Project Vault\02-helios\src\memory\experiment-tracker.ts`, comparison in `C:\Users\hanji\Desktop\Project Vault\02-helios\src\tools\compare-runs.ts`, task finalization in `C:\Users\hanji\Desktop\Project Vault\02-helios\src\core\task-poller.ts`, and git isolation in `C:\Users\hanji\Desktop\Project Vault\02-helios\src\experiments\branching.ts`.
- Collaboration/event surfaces already exist via ACP server and AgentHub client/tools in `C:\Users\hanji\Desktop\Project Vault\02-helios\src\acp\server.ts`, `C:\Users\hanji\Desktop\Project Vault\02-helios\src\hub\client.ts`, and `C:\Users\hanji\Desktop\Project Vault\02-helios\src\tools\hub.ts`.

## Candidate Planning Direction
- Use a hybrid plan: define shared architecture/schemas for a future extracted system, but stage implementation through `02-helios` first.
- Add graph/proposal/simulation layers around existing runtime rather than replacing orchestrator, metrics, or memory primitives.
- Final plan should be decision-complete down to directory layout, event contracts, and GraphRAG node/edge definitions.

## Open Decisions
- Default verification strategy: TypeScript build + migration coverage + runtime contract tests for event flows + simulation/report smoke coverage.

## References
- `C:\Users\hanji\Desktop\Project Vault\02-helios\README.md`
- `C:\Users\hanji\Desktop\Project Vault\02-helios\src\init.ts`
- `C:\Users\hanji\Desktop\Project Vault\02-helios\src\core\orchestrator.ts`
- `C:\Users\hanji\Desktop\Project Vault\02-helios\src\memory\memory-store.ts`
- `C:\Users\hanji\Desktop\Project Vault\02-helios\src\memory\experiment-tracker.ts`
- `C:\Users\hanji\Desktop\Project Vault\02-helios\src\tools\compare-runs.ts`
- `C:\Users\hanji\Desktop\Project Vault\autoresearch\README.md`
- `C:\Users\hanji\Desktop\Project Vault\autoresearch\program.md`
