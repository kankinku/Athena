/**
 * `athena report [id]` — generate an experiment writeup from session or run data.
 * Accepts either a session-id or a run-id. Run-ids are resolved to their session.
 * Outputs markdown to stdout (pipeable: `athena report > results.md`)
 *
 * Without a provider, outputs raw structured data instead of an AI-generated writeup.
 */

import { Effect, Option } from "effect";
import { Command, Args, Options } from "@effect/cli";

const targetArg = Args.text({ name: "id" }).pipe(
  Args.withDescription("Session ID or Run ID to report on (default: most recent session)"),
  Args.optional,
);

const provider = Options.choice("provider", ["claude", "openai"]).pipe(
  Options.withAlias("P"),
  Options.withDescription("Provider to use for generating the writeup (omit for raw data)"),
  Options.optional,
);

export const report = Command.make(
  "report",
  { targetArg, provider },
  ({ targetArg: targetOpt, provider: providerOpt }) =>
    Effect.promise(async () => {
      const { SessionStore } = await import("../store/session-store.js");
      const { TeamStore } = await import("../research/team-store.js");
      const { createRuntime } = await import("../init.js");
      const { buildWriteupSystemPrompt } = await import("../tools/writeup.js");
      const { buildResearchReportInput } = await import("../research/reporting.js");

      const agentId = process.env.AGENTHUB_AGENT ?? "";
      const store = new SessionStore(agentId);
      const teamStore = new TeamStore();

      // Resolve id — accepts session-id OR run-id
      const targetId = Option.getOrUndefined(targetOpt);
      let resolvedId: string;

      if (targetId) {
        // Try as session-id first
        const session = store.getSession(targetId);
        if (session) {
          resolvedId = targetId;
        } else {
          // Try as run-id — resolve to its session
          const run = teamStore.getTeamRun(targetId);
          if (run) {
            resolvedId = run.sessionId;
            process.stderr.write(`Resolved run "${targetId}" to session "${resolvedId}"\n`);
          } else {
            process.stderr.write(`"${targetId}" not found as session or run ID.\n`);
            process.exit(1);
          }
        }
      } else {
        const sessions = store.listSessions(1);
        if (sessions.length === 0) {
          process.stderr.write("No sessions found.\n");
          process.exit(1);
        }
        resolvedId = sessions[0].id;
        process.stderr.write(`Using most recent session: ${resolvedId}\n`);
      }

      // Gather structured research state
      const reportInput = buildResearchReportInput(resolvedId, teamStore, store, {
        transcriptLimit: 400,
      });
      if (!reportInput.trim()) {
        process.stderr.write("Session has no reportable research state.\n");
        process.exit(1);
      }

      // Create a runtime to get a provider for the writeup
      const providerName = Option.getOrUndefined(providerOpt) as "claude" | "openai" | undefined;

      // Graceful fallback: if no provider is configured, output raw data
      let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
      try {
        runtime = await createRuntime({ provider: providerName });
      } catch {
        // Runtime creation failed — fall through to raw output
      }

      const activeProvider = runtime?.orchestrator.currentProvider;
      if (!activeProvider) {
        if (providerName) {
          process.stderr.write(`Provider "${providerName}" not available. Outputting raw report data.\n`);
        } else {
          process.stderr.write("No active provider. Outputting raw report data (use -P to generate AI writeup).\n");
        }
        process.stdout.write(reportInput);
        process.stdout.write("\n");
        runtime?.cleanup();
        return;
      }

      process.stderr.write("Generating report...\n");

      const session = await activeProvider.createSession({
        systemPrompt: buildWriteupSystemPrompt(),
      });

      try {
        for await (const event of activeProvider.send(session, reportInput, [])) {
          if (event.type === "text" && event.delta) {
            process.stdout.write(event.delta);
          }
        }
        process.stdout.write("\n");
      } finally {
        await activeProvider.closeSession(session).catch(() => {});
        runtime!.cleanup();
      }
    }),
);
