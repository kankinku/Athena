import { Command } from "@effect/cli";
import { Effect } from "effect";
import { findProjectConfig } from "../config/project.js";
import { SecurityAuditStore } from "../security/audit-store.js";
import { SecurityManager } from "../security/policy.js";

export const security = Command.make(
  "security",
  {},
  () =>
    Effect.sync(() => {
      const config = findProjectConfig();
      const auditStore = new SecurityAuditStore();
      const status = new SecurityManager(config?.security, auditStore).getStatus();
      const audit = auditStore.summarize();
      const lines = [
        `enabled=${status.enabled} mode=${status.mode}`,
        `commands  allow=${status.commandRules.allow} review=${status.commandRules.review} block=${status.commandRules.block}`,
        `paths  allow_read=${status.pathRules.allowRead} allow_write=${status.pathRules.allowWrite} protected=${status.pathRules.protected}`,
        `capabilities  enabled=${status.capabilityPolicy.enabled} machines=${status.capabilityPolicy.machines} tool_categories=${status.capabilityPolicy.toolCategories} allow_network=${status.capabilityPolicy.allowNetworkAccess ?? "n/a"} allow_destructive=${status.capabilityPolicy.allowDestructiveActions ?? "n/a"} read_roots=${status.capabilityPolicy.allowReadRoots} write_roots=${status.capabilityPolicy.allowWriteRoots}`,
        `roles  enabled=${status.rolePolicy.enabled} bindings=${status.rolePolicy.actorBindings} tier_rules=${status.rolePolicy.tierRules}`,
        `audit  total=${audit.total} allow=${audit.allow} review=${audit.review} block=${audit.block} last_at=${audit.lastDecisionAt ?? "n/a"}`,
        "note  use athena.json -> security to tune rules or switch to audit mode while calibrating.",
      ];

      for (const line of lines) {
        console.log(line);
      }
    }),
);
