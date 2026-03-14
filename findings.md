# Findings

## Repository Audit

### Package and positioning
- Package name is `@snoglobe/athena`, version `0.2.1`.
- CLI entrypoint is `dist/bootstrap.js`; development entrypoint is `src/bootstrap.ts`.
- The project positions itself as an autonomous ML research agent TUI with local and SSH execution, persistent research state, and operator review surfaces.

### Declared quality bar
- README claims the repository is in a `v0.3` short-term closure state as a stable operator-supervised research system.
- The docs explicitly mention a release boundary, a PR summary, and a next-phase gap analysis, which suggests some planning already exists inside the repo.

### Implemented operator surface
- The CLI root supports interactive TUI, print/headless execution, session resume/continue, auth, sessions, watch, replay, report, init, doctor, search, export, kill, and `research` subcommands.
- `athena research` already exposes operator views for runs, workflow, automation, proposals, simulations, decisions, lineage, ingestion, claims, improvements, review actions, and next actions.
- `athena report` builds a structured operator-facing report from persisted research state and uses an authenticated provider only for the final writeup generation step.

### Implemented research core
- Research state persists through SQLite-backed `TeamStore` tables for runs, proposals, scorecards, decisions, triggers, lineage, ingestion sources, automation checkpoints, and improvement proposals/evaluations.
- `TeamOrchestrator` advances runs through workflow states, records proposal briefs, updates scorecards from claim support, records simulation results, and emits improvement proposals/evaluations.
- The smoke script exercises run creation, automation policy, ingestion, proposal recording, simulation result handling, report generation, claim merge behavior, revisit flow, and improvement artifacts.

### Minimum baseline verification
- `npm run build` passes.
- `npm run test:research` passes.
- `npm run test:research:safety` passes.
- `npm run smoke:research` passes.
- Based on the repository's own release-readiness definition, the current codebase already satisfies its stated v0.3 minimum functional baseline.

### Concrete remaining gaps from code and runtime behavior
- TUI does not expose the research operator state directly. The layout currently focuses on conversation, tasks, metrics, stickies, and overlays rather than research workflow/review panels.
- Ingestion remains mostly structured scaffolding. The main ingestion module builds candidate packs from pre-extracted claims and uses heuristic tag inference instead of a full external URL/document extraction pipeline.
- Automation policy is strongly persisted and inspectable, but the deeper runtime linkage to scheduler-grade unattended execution still appears limited compared with the ambition described in the README/docs.
- `athena doctor` is not reliable in this Windows environment. Running it reported false negatives like missing `git` and missing `python`, even though both are available in the shell. The implementation hardcodes `/bin/bash` for shell checks.
- Actual interactive usage still depends on provider authentication. Tests pass without live credentials, but real report/TUI agent behavior still requires Claude or OpenAI auth setup.

### Documented release boundary
- `docs/release-readiness-v0.3.md` defines the minimum bar as a stable operator-supervised research system, not a fully autonomous research OS.
- `docs/next-phase-gap-analysis.md` already frames the post-v0.3 backlog around test depth, ingestion depth, operator UX, self-improvement promotion, and runtime automation integration.

### Research stack implementation status
- The repository contains a substantial research domain model: workflow states, proposal scoring, automation policy, checkpoints, improvement proposals/evaluations, and persistence-backed operator views.
- The main implemented value is structured state and safe operator review, not full autonomous runtime closure.
- The clearest remaining gaps in code are:
  - external ingestion beyond scaffolded source-to-claim helpers
  - runtime automation that actually executes retries/resumes/timeouts end-to-end
  - promotion of improvement proposals into reusable system policy

### Verification state
- `npm run build` passes.
- `npm run test:research` passes.
- `npm run test:research:safety` passes.
- `npm run smoke:research` passes.
- This strongly supports that the research stack reaches its own documented baseline.

### Broader product risk outside research tests
- The automated coverage is concentrated in `src/research` and migration upgrade checks.
- Major unverified areas include:
  - provider auth flows and model execution against Claude/OpenAI
  - remote SSH/rsync execution paths
  - TUI interaction paths and overlays
  - AgentHub flows
  - cross-platform environment diagnostics and setup flow

### Environment and operator usability risks observed locally
- `athena doctor` reports missing auth for both providers, no `athena.json`, and missing `ssh`, `rsync`, and `git` in this environment.
- The doctor implementation uses shell checks that are Unix-leaning, so Windows environments may get incomplete or misleading dependency results.

### Confirmed user-facing entrypoints
- `src/bootstrap.ts` dispatches either ACP mode (`--acp`) or the standard CLI.
- `src/cli/index.ts` wires a full root CLI with TUI run mode plus subcommands such as `auth`, `sessions`, `watch`, `replay`, `report`, `doctor`, `search`, `export`, `kill`, and `research`.
- `src/cli/research.ts` contains implemented operator views for runs, workflow, automation, proposals, simulations, decisions, lineage, ingestion, revisit, scorecard, budget anomalies, claims, improvements, review actions, next-actions, and graph inspection.
- `src/cli/report.ts` generates a provider-backed markdown report from stored session and research state rather than being a placeholder.

### Verification status
- `npm run build` passes.
- `npm run test:research` passes with 27 passing tests.
- `npm run test:research:safety` passes with 11 passing tests.
- `npm run smoke:research` passes.
- Some CLI regression tests emit expected Claude-auth warnings while still passing, which shows parts of the operator surface are intentionally testable from persisted state without a live authenticated provider.

### Confirmed execution-layer blockers on Windows
- `src/remote/connection-pool.ts` hardcodes `/bin/bash` for local command execution and background launch.
- `src/remote/connection-pool.ts` also defaults local background logs to `/tmp/...`, which is not a native Windows path convention.
- A direct runtime probe confirmed the problem:
  - importing `dist/remote/connection-pool.js` and calling `pool.exec("local", "echo hello")` returned `exitCode: 1`
  - calling `pool.execBackground("local", "echo hello")` failed with `Failed to spawn background process`
- `src/remote/file-sync.ts` shells out to `rsync`, and `rsync` is not installed in this Windows environment, so remote sync is currently unavailable here.
