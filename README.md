# Athena

> [!CAUTION]
> **Important:** Athena does not currently have a permissions/security model. The agent runs basically unrestricted. You are responsible for any losses of data/other adverse outcomes from running it. If you have stuff you care about, then back it up (whether or not you use Athena, backing up is a good idea!), run Athena in a container, or wait until it has a permissions system.

![Athena screenshot](https://raw.githubusercontent.com/snoglobe/athena/main/media/screnshot.png)

An autonomous research agent inspired by [Andrej Karpathy's 'autoresearch'](https://github.com/karpathy/autoresearch). Autoresearch works very well within Athena, just have to tune the prompt slightly.

It can operate seamlessly over SSH (even multiple machines), keeps the model in a loop, has tools to view/compare metrics, shows metrics directly in the UI, and has a memory system. 

You can leave it to work overnight and don't have to worry about it exiting the loop early to stupidly ask you something or because it has to wait for something. And hopefully you'll wake up to results.

## Current Status

Athena is currently in a `v0.3` short-term closure state as a:

`stable operator-supervised research system`

Today, that means the repo already includes:

- structured research state with canonical claims, proposal scoring, workflow history, automation policy, and self-improvement records
- operator-facing control surfaces for inspection, approval, review, and reporting
- safety rails for persistence, migrations, automation gates, CLI/report regressions, and simulation launch failures

If you want the exact release boundary for this milestone, see:

- `docs/release-readiness-v0.3.md`
- `docs/pr-summary-research-stack.md`
- `docs/next-phase-gap-analysis.md`

## Install

```bash
npm install -g @snoglobe/athena
```

Requires Node.js 20+.

## Auth

**Claude** (default) — either:
- Install the [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) and run `claude login`
- Or set `ANTHROPIC_API_KEY` and use `/claude-mode api`
- Claude CLI usage is ban-free; conforms to Anthropic's usage policy

**OpenAI** — OAuth login on first run (requires ChatGPT Plus or Pro).

## Usage

```
athena [options]

Options:
  -p, --provider <claude|openai>  Model provider (default: claude)
  --claude-mode <cli|api>         Claude auth mode (cli = Agent SDK, api = API key)
  -v, --version                   Show version
  -h, --help                      Show help
```

Type a goal and Athena takes over:

```
> Train a 125M parameter GPT on TinyStories to loss < 1.0
```

It will write training scripts, launch runs, parse metrics from stdout, set up monitoring intervals, compare experiments, and keep iterating until the goal is met or you interrupt.

## Commands

| Command | Description |
|---|---|
| `/switch <claude\|openai>` | Switch model provider |
| `/model <model-id>` | Set model |
| `/models` | List available models |
| `/reasoning <level>` | Set reasoning effort (Claude: `medium` `high` `max` / OpenAI: `none` `minimal` `low` `medium` `high` `xhigh`) |
| `/claude-mode <cli\|api>` | Switch Claude auth mode |
| `/machine add <id> <user@host[:port]>` | Add remote machine (`--key <path>`, `--auth <agent\|key>`) |
| `/machine rm <id>` | Remove machine |
| `/machines` | List machines and connection status |
| `/metric [name ...]` | Show metric sparklines |
| `/metrics clear` | Clear all metrics |
| `/resume` | List recent sessions |
| `/resume <n>` | Resume a past session |
| `/writeup` | Generate experiment writeup from conversation |
| `/sticky <text>` | Pin a note to the sidebar |
| `/stickies` | List sticky notes |
| `/memory [path]` | Browse the agent's memory tree |
| `athena research <view> [target]` | Inspect structured research state from the CLI |
| `athena report [session-id]` | Generate an operator-facing research report |
| `/status` | Provider, model, cost, state |
| `/clear` | Clear conversation |
| `/help` | Show all commands |

## Research Operator Views

Athena now exposes the research system as a first-class operator surface.

```bash
athena research runs
athena research workflow <run-id>
athena research automation <run-id>
athena research proposals --state revisit_due
athena research scorecard <proposal-id>
athena research decisions <proposal-or-decision-id>
athena research claims
athena research claims <canonical-claim-id>
athena research improvements
athena research next-actions
athena report <session-id>
```

### Research Views

| View | What it shows |
|---|---|
| `runs` | Run-level stage, workflow state, and high-level status |
| `workflow <run-id>` | Workflow transition history for a run |
| `automation <run-id>` | Automation mode, approval gates, retry/checkpoint/timeout state |
| `proposals` | Proposal queue with evidence/freshness/contradiction summary |
| `scorecard <proposal-id>` | Detailed scoring axes and claim-support summary |
| `decisions [id]` | Decision list or detail view with drift notes |
| `claims` / `claims <id>` | Canonical claim inventory and per-claim evidence detail |
| `revisit due` | Proposals that need reconsideration |
| `improvements` | Self-improvement proposals and evaluations |
| `review <id> --kind ... --action ...` | Apply an operator approval/review action safely |
| `next-actions` | The most actionable operator follow-ups right now |

## Research Workflow

Athena's research loop now persists an explicit workflow state:

```text
draft -> ready -> approved -> running -> evaluating -> reported
                                            \-> revisit_due
                                            \-> failed
```

- `draft` / `ready` / `approved` cover intake and authorization
- `running` means collection or experiment execution is active
- `evaluating` means Athena is scoring evidence or simulation results
- `reported` means the run has a stable reportable outcome
- `revisit_due` means new evidence or contradiction pressure requires another pass

Use `athena research workflow <run-id>` when you need the exact transition history.

## Automation Modes

Athena tracks automation policy per run:

```text
manual
assisted
supervised-auto
overnight-auto
```

- `manual` keeps proposal, experiment, and revisit approval gated
- `assisted` lowers friction but still assumes active operator review
- `supervised-auto` allows bounded autonomous progress under policy
- `overnight-auto` is intended for unattended execution with checkpoints, retry limits, and timeout windows

Use `athena research automation <run-id>` to inspect:
- approval requirements
- retry counts and retry policy
- checkpoint cadence and recent checkpoints
- timeout budget for the run

If automation is blocked by policy, the run state will surface the reason. The operator then resolves it via `athena research review ...` rather than by guessing internal state transitions.

## Self-Improvement Loop

Athena now records a safe self-improvement foundation rather than self-editing blindly.

- Each finished run can emit an improvement proposal
- Each improvement proposal gets an evaluation outcome
- Rollback guidance is preserved with the proposal
- Operators can inspect proposals with `athena research improvements`

This means Athena can accumulate reusable lessons about:
- automation policy
- workflow guardrails
- evaluation strategy
- decision policy
- reporting quality
- research strategy

## Operator Review Actions

Athena now supports explicit operator-side approval/review actions.

### Proposal actions

```bash
athena research review <proposal-id> --kind proposal --action approve
athena research review <proposal-id> --kind proposal --action scope_trial
athena research review <proposal-id> --kind proposal --action defer
athena research review <proposal-id> --kind proposal --action revisit
athena research review <proposal-id> --kind proposal --action archive
```

### Improvement actions

```bash
athena research review <improvement-id> --kind improvement --action queue
athena research review <improvement-id> --kind improvement --action start_review
athena research review <improvement-id> --kind improvement --action promote
athena research review <improvement-id> --kind improvement --action dismiss
```

Safety rules:

- proposal review actions move proposal status through guarded transitions
- improvement review actions enforce terminal-state safety
- promoting an improvement automatically dismisses duplicate items with the same `mergeKey`
- automation blocks stay visible in run state until the operator resolves them

## Operator Runbook

When checking the system, this sequence is the fastest way to understand current state:

1. `athena research runs`
2. `athena research next-actions`
3. `athena research workflow <run-id>`
4. `athena research automation <run-id>`
5. `athena research proposals`
6. `athena research scorecard <proposal-id>`
7. `athena research improvements`
8. `athena report <session-id>`

When you need to actively move work forward:

1. inspect `athena research next-actions`
2. inspect the blocking item with `workflow`, `automation`, `proposals`, or `improvements`
3. apply `athena research review <id> --kind ... --action ...`
4. re-check `athena research proposals` or `athena research improvements`
5. confirm the overall system state again with `athena report <session-id>`

Use this when you want to answer:
- What is Athena doing right now?
- Which proposal is blocked or needs revisit?
- Is automation still within policy?
- What changed the latest decision?
- Did the last run teach Athena anything reusable?
- Which item needs explicit operator approval?
- Was the approval/review action applied safely?

## Keys

| Key | Action |
|---|---|
| `Ctrl+T` | Task output overlay |
| `Ctrl+G` | Metrics overlay |
| `Escape` | Interrupt / close overlay |
| `Ctrl+C` | Interrupt / exit |
| `Tab` | Autocomplete command |
| `↑` `↓` | History / menu navigation |
| `PageUp` `PageDown` | Scroll conversation |
| `Ctrl+A` `Ctrl+E` | Start / end of line |
| `Ctrl+W` | Delete word backward |
| `Ctrl+U` | Clear line |

Mouse scroll works in terminals that support SGR mouse reporting.

## Remote Machines

Athena can run workloads on remote machines over SSH. The `local` machine is always available.

```bash
# Add a GPU box
/machine add gpu1 researcher@10.0.0.5 --key ~/.ssh/id_rsa

# Add with custom port
/machine add gpu2 user@hostname:2222
```

Machines are stored in `~/.athena/machines.json` and auto-connect on startup.

The agent prefers remote machines for heavy compute and uses `local` for lightweight tasks. Or if you don't have a remote machine.

## How It Works

Athena runs an autonomous loop:

1. **Understand the goal** — break it into experiments
2. **Launch** via `remote_exec_background` — stdout is captured, metrics are parsed live
3. **Monitor** via `start_monitor` — periodic check-ins review progress
4. **Compare** via `compare_runs` — keep improvements, discard regressions
5. **Iterate** — plan and launch the next experiment
6. **Stop** only when the goal is achieved or it hits an unrecoverable error

### Metric Tracking

Training scripts print metrics to stdout. Athena parses them automatically:

```python
# key=value format (detected via metric_names)
print(f"loss={loss:.4f} acc={acc:.4f} lr={lr:.6f}")

# Custom patterns (detected via metric_patterns)
print(f"Step {step}: Loss {loss:.4f}")
```

Live sparklines appear in the dashboard. The agent uses `show_metrics` and `compare_runs` to make decisions.

### Memory

Long sessions get checkpointed when the context window fills up. The agent's memory persists as a virtual filesystem:

```
/goal                    → "Train TinyStories to loss < 1.0"
/best                    → "Run #3: lr=3e-4, cosine → loss=0.83"
/experiments/
  4521                   → config, metrics, verdict
  4380                   → config, metrics, verdict
/observations/
  cosine-schedule-helps  → "cosine decay outperforms linear by ~15%"
```

After a checkpoint, the agent receives its memory tree and continues where it left off.

### Consult

The agent can ask the other provider for a second opinion:

```
# If running on Claude, consult asks OpenAI (and vice versa)
consult("I'm stuck at loss=0.9 — what should I try next?")
```

## Models

**Claude** (200k context):
- `claude-opus-4-6` — higher-end reasoning/coding (default)
- `claude-sonnet-4-6` — balanced speed vs reasoning

**OpenAI** (~400k context):
- `gpt-5.4` — latest flagship, recommended (default)
- `gpt-5.3-codex` — codex
- `gpt-5.3-codex-spark` — research preview, text-only
- `gpt-5.2-codex` — codex
- `gpt-5.2`
- `gpt-5.1-codex-max` — max compute
- `gpt-5.1`
- `gpt-5.1-codex` — codex

## Tools

The agent has access to 19 tools:

| Tool | What it does |
|---|---|
| `remote_exec` | Run a quick command (ls, pip install, git clone) |
| `remote_exec_background` | Launch a long-running process with metric tracking |
| `remote_upload` / `remote_download` | rsync files between machines |
| `read_file` / `write_file` / `patch_file` | File operations on any machine |
| `list_machines` | Show configured machines |
| `task_output` | Tail stdout/stderr of a background task |
| `show_metrics` | Query metrics with sparklines |
| `compare_runs` | Side-by-side comparison of two runs |
| `clear_metrics` | Wipe stale metric data |
| `kill_task` | Kill a running process |
| `web_fetch` | Fetch web pages, docs, papers |
| `sleep` | Sleep with composable triggers (timer, process exit, metric threshold, file change, resource usage) |
| `start_monitor` / `stop_monitor` | Periodic monitoring loop |
| `memory_ls` / `memory_read` / `memory_write` / `memory_rm` | Persistent memory |
| `consult` | Ask the other AI provider |

## Data

Everything is stored locally in `~/.athena/`:

```
~/.athena/
  athena.db          SQLite database (sessions, metrics, memory)
  machines.json      Remote machine configs
  auth/
    auth.json        OAuth tokens and API keys
  preferences.json   Last provider, claude mode
```

## Development

```bash
git clone https://github.com/snoglobe/athena.git
cd athena
npm install
npm run dev          # tsx src/index.tsx
npm run test:research
npm run smoke:research
npm run build        # tsc
npm start            # node dist/index.js
```

## License

MIT
