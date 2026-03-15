/**
 * Athena CLI — built with @effect/cli.
 *
 * Usage:
 *   athena                          Interactive TUI
 *   athena "prompt"                 TUI with initial prompt
 *   athena -p "prompt"              Print response and exit
 *   athena -c                       Continue most recent session
 *   athena -r <session-id>          Resume specific session
 *   athena auth login|logout|status Auth management
 *   athena sessions                 List recent sessions
 *   athena watch <machine:pid>      Stream task output + metrics
 *   athena replay <session-id>      Replay a past session
 *   athena report [session-id]      Generate experiment writeup
 *   athena init                     Initialize project config
 *   athena doctor                    Diagnose setup
 *   athena security                  Show active security floor status
 *   athena search "query"            Search session histories
 *   athena export [session-id]       Export data to CSV/JSON
 *   athena kill <machine:pid>        Kill a running task
 */

import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Option } from "effect";
import { VERSION } from "../version.js";
import {
  provider, claudeMode, model,
  continueSession, resumeSession,
  print, headless,
  home, hubUrl, hubKey, agent,
  files, prompt,
} from "./options.js";
import { applyEnv } from "./env.js";
import { run } from "./run.js";
import { auth } from "./auth.js";
import { sessions } from "./sessions.js";
import { watch } from "./watch.js";
import { replay } from "./replay.js";
import { report } from "./report.js";
import { initCmd } from "./init-cmd.js";
import { doctor } from "./doctor.js";
import { security } from "./security.js";
import { search } from "./search.js";
import { exportCmd } from "./export.js";
import { kill } from "./kill.js";
import { research } from "./research.js";
import { proposal } from "./proposal.js";
import { meeting } from "./meeting.js";
import { dashboard } from "./dashboard.js";

// ── Root command ─────────────────────────────────────────

const athena = Command.make(
  "athena",
  {
    provider, claudeMode, model,
    continueSession, resumeSession,
    print, headless,
    home, hubUrl, hubKey, agent,
    files, prompt,
  },
  (opts) =>
    Effect.gen(function* () {
      // Set env vars before any runtime imports
      applyEnv({
        home: opts.home,
        hubUrl: opts.hubUrl,
        hubKey: opts.hubKey,
        agent: opts.agent,
      });

      yield* run({
        provider: opts.provider,
        claudeMode: opts.claudeMode,
        model: opts.model,
        continueSession: opts.continueSession,
        resumeSession: opts.resumeSession,
        print: opts.print,
        headless: opts.headless,
        files: opts.files,
        prompt: opts.prompt,
      });
    }),
).pipe(
  Command.withSubcommands([auth, sessions, watch, replay, report, initCmd, doctor, security, search, exportCmd, kill, research, proposal, meeting, dashboard]),
);

// ── Launch ───────────────────────────────────────────────

const cli = Command.run(athena, {
  name: "athena",
  version: `v${VERSION}`,
});

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
