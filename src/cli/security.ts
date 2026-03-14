import { Command } from "@effect/cli";
import { Effect } from "effect";
import { findProjectConfig } from "../config/project.js";
import { SecurityManager } from "../security/policy.js";

export const security = Command.make(
  "security",
  {},
  () =>
    Effect.sync(() => {
      const config = findProjectConfig();
      const status = new SecurityManager(config?.security).getStatus();
      const lines = [
        `enabled=${status.enabled} mode=${status.mode}`,
        `commands  allow=${status.commandRules.allow} review=${status.commandRules.review} block=${status.commandRules.block}`,
        `paths  allow_read=${status.pathRules.allowRead} allow_write=${status.pathRules.allowWrite} protected=${status.pathRules.protected}`,
        "note  use athena.json -> security to tune rules or switch to audit mode while calibrating.",
      ];

      for (const line of lines) {
        console.log(line);
      }
    }),
);
