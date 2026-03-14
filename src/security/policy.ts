import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { ATHENA_DIR } from "../paths.js";
import type {
  ProtectedPathIntent,
  SecurityActionClass,
  SecurityAuditRecord,
  SecurityActorRole,
  SecurityActorTier,
  SecurityCapabilityPolicy,
  SecurityConfig,
  SecurityDecision,
  SecurityExecutionContext,
  SecurityRolePolicy,
  SecurityRoleRule,
  SecurityMode,
  SecurityStatus,
  SecurityVerdict,
} from "./contracts.js";
import type { SecurityAuditStore } from "./audit-store.js";

interface CompiledRule {
  source: string;
  regex: RegExp;
}

const DEFAULT_BLOCK_COMMAND_PATTERNS = [
  String.raw`(?:^|\s)(?:sudo|su)(?:\s|$)`,
  String.raw`rm\s+-rf\s+(?:/|~|\$HOME\b)`,
  String.raw`mkfs(?:\.[a-z0-9]+)?\b`,
  String.raw`dd\s+[^\n]*\bof=(?:/dev/|\\\\\.\\PhysicalDrive)`,
  String.raw`(?:(?:shutdown|reboot|poweroff|halt)\b)`,
  String.raw`diskutil\s+erase(Disk|Volume)\b`,
  String.raw`format\s+[a-z]:`,
  String.raw`git\s+reset\s+--hard\b`,
];

const DEFAULT_REVIEW_COMMAND_PATTERNS = [
  String.raw`rm\s+-rf\b`,
  String.raw`chmod\s+-R\b`,
  String.raw`chown\s+-R\b`,
  String.raw`scp\b`,
  String.raw`rsync\b`,
  String.raw`ssh\b`,
  String.raw`docker\s+system\s+prune\b`,
  String.raw`kubectl\s+delete\b`,
];

const WINDOWS_SYSTEM_PATTERN = String.raw`^(?:[a-z]:)?/(?:windows/system32|program files|program files \(x86\))(?:/|$)`;
const DEFAULT_ACTOR_TIER_BY_ROLE: Record<SecurityActorRole, SecurityActorTier> = {
  agent: "agent_worker",
  operator: "operator_admin",
  system: "system_runtime",
};
const DEFAULT_TIER_RULES: Record<SecurityActorTier, SecurityRoleRule> = {
  agent_worker: {
    allowedActionClasses: ["inspect", "ingest", "execute"],
  },
  operator_admin: {
    allowedActionClasses: ["inspect", "ingest", "approve", "defer", "revisit", "resume", "rollback", "archive", "promote", "dismiss"],
  },
  operator_reviewer: {
    allowedActionClasses: ["inspect", "ingest", "approve", "defer", "revisit", "promote", "dismiss"],
    capabilityPolicy: {
      allowDestructiveActions: false,
    },
  },
  operator_observer: {
    allowedActionClasses: ["inspect"],
    capabilityPolicy: {
      allowNetworkAccess: false,
      allowDestructiveActions: false,
    },
  },
  system_runtime: {
    allowedActionClasses: ["inspect", "execute", "resume", "rollback"],
  },
};

interface ResolvedActor {
  actorRole: SecurityActorRole;
  actorId: string;
  actorTier: SecurityActorTier;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(value: string): string {
  const normalized = posix.normalize(value.replace(/\\/g, "/").replace(/\/+/g, "/"));
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function compileRules(patterns: string[] | undefined): CompiledRule[] {
  return (patterns ?? []).flatMap((pattern) => {
    try {
      return [{ source: pattern, regex: new RegExp(pattern, "i") }];
    } catch {
      return [];
    }
  });
}

function defaultProtectedPaths(): string[] {
  const athenaAuthDir = normalizePath(join(ATHENA_DIR, "auth"));
  const home = normalizePath(homedir());
  return [
    String.raw`(?:^|/)\.ssh(?:/|$)`,
    String.raw`(?:^|/)\.aws(?:/|$)`,
    String.raw`(?:^|/)\.kube(?:/|$)`,
    String.raw`(?:^|/)\.config/gcloud(?:/|$)`,
    `${escapeRegex(athenaAuthDir)}(?:/|$)`,
    `${escapeRegex(normalizePath(join(home, ".ssh")))}(?:/|$)`,
    String.raw`^/etc(?:/|$)`,
    String.raw`^/root(?:/|$)`,
    WINDOWS_SYSTEM_PATTERN,
  ];
}

function matchesRule(value: string, rules: CompiledRule[]): CompiledRule | null {
  for (const rule of rules) {
    if (rule.regex.test(value)) {
      return rule;
    }
  }
  return null;
}

function buildDecisionMessage(
  kind: "command" | "path",
  verdict: Exclude<SecurityVerdict, "allow">,
  subject: string,
  matchedPattern: string,
  reason: string,
): string {
  const action = verdict === "block" ? "blocked" : "requires approval";
  return `Security policy ${action} this ${kind}: ${reason}. Matched pattern: ${matchedPattern}. Subject: ${subject}`;
}

function normalizeRoots(roots: string[] | undefined): string[] {
  return (roots ?? []).map((root) => normalizePath(root).replace(/\/$/, ""));
}

function pathWithinRoots(path: string, roots: string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

function redactSubject(subjectKind: SecurityAuditRecord["subjectKind"], subject: string): string {
  const digest = createHash("sha256").update(subject).digest("hex").slice(0, 12);
  return `[redacted-${subjectKind}:${digest}]`;
}

function sanitizeReasonForAudit(reason: string): string {
  return reason.replace(/\. Subject: .*$/u, "");
}

function isNetworkAccess(context: SecurityExecutionContext): boolean {
  return context.networkAccess ?? (context.machineId !== undefined && context.machineId !== "local");
}

function defaultToolCategory(context: SecurityExecutionContext): NonNullable<SecurityExecutionContext["toolFamily"]> {
  return context.toolFamily ?? "other";
}

function intersectValues(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  if (left && right) {
    return left.filter((value) => right.includes(value));
  }
  return left ?? right;
}

export class SecurityManager {
  private readonly enabled: boolean;
  private readonly mode: SecurityMode;
  private readonly allowCommands: CompiledRule[];
  private readonly reviewCommands: CompiledRule[];
  private readonly blockCommands: CompiledRule[];
  private readonly allowReadPaths: CompiledRule[];
  private readonly allowWritePaths: CompiledRule[];
  private readonly protectedPaths: CompiledRule[];
  private readonly capabilityPolicy?: SecurityCapabilityPolicy;
  private readonly rolePolicy?: SecurityRolePolicy;
  private readonly allowReadRoots: string[];
  private readonly allowWriteRoots: string[];

  constructor(
    config: SecurityConfig | undefined = undefined,
    private readonly auditStore?: SecurityAuditStore,
  ) {
    this.enabled = config?.enabled ?? true;
    this.mode = config?.mode ?? "enforce";
    this.allowCommands = compileRules(config?.commandPolicy?.allowPatterns);
    this.reviewCommands = compileRules([
      ...DEFAULT_REVIEW_COMMAND_PATTERNS,
      ...(config?.commandPolicy?.reviewPatterns ?? []),
    ]);
    this.blockCommands = compileRules([
      ...DEFAULT_BLOCK_COMMAND_PATTERNS,
      ...(config?.commandPolicy?.blockPatterns ?? []),
    ]);
    this.allowReadPaths = compileRules(config?.pathPolicy?.allowReadPaths);
    this.allowWritePaths = compileRules(config?.pathPolicy?.allowWritePaths);
    this.protectedPaths = compileRules([
      ...defaultProtectedPaths(),
      ...(config?.pathPolicy?.protectedPaths ?? []),
    ]);
    this.capabilityPolicy = config?.capabilityPolicy;
    this.rolePolicy = config?.rolePolicy;
    this.allowReadRoots = normalizeRoots(config?.capabilityPolicy?.allowedReadPathRoots);
    this.allowWriteRoots = normalizeRoots(config?.capabilityPolicy?.allowedWritePathRoots);
  }

  getStatus(): SecurityStatus {
    return {
      enabled: this.enabled,
      mode: this.mode,
      commandRules: {
        allow: this.allowCommands.length,
        review: this.reviewCommands.length,
        block: this.blockCommands.length,
      },
      pathRules: {
        allowRead: this.allowReadPaths.length,
        allowWrite: this.allowWritePaths.length,
        protected: this.protectedPaths.length,
      },
      capabilityPolicy: {
        enabled: this.capabilityPolicy !== undefined,
        machines: this.capabilityPolicy?.allowedMachineIds?.length ?? 0,
        toolCategories: this.capabilityPolicy?.allowedToolCategories?.length ?? 0,
        allowNetworkAccess: this.capabilityPolicy?.allowNetworkAccess ?? null,
        allowDestructiveActions: this.capabilityPolicy?.allowDestructiveActions ?? null,
        allowReadRoots: this.allowReadRoots.length,
        allowWriteRoots: this.allowWriteRoots.length,
      },
      rolePolicy: {
        enabled: this.rolePolicy !== undefined,
        actorBindings: this.rolePolicy?.actorBindings?.length ?? 0,
        tierRules: Object.keys(this.rolePolicy?.tierRules ?? {}).length,
      },
    };
  }

  evaluateAction(actionClass: SecurityActionClass, context: SecurityExecutionContext = {}): SecurityDecision {
    if (!this.enabled) {
      return { verdict: "allow", reason: "security disabled" };
    }
    if (!this.rolePolicy) {
      return { verdict: "allow", reason: "no role policy configured" };
    }
    const actor = this.resolveActor(context);
    const rule = this.resolveRoleRule(actor.actorTier);
    if (!rule.allowedActionClasses?.includes(actionClass)) {
      return {
        verdict: "block",
        reason: `Security role policy blocked action ${actionClass} for actor tier ${actor.actorTier}`,
      };
    }
    return { verdict: "allow", reason: `actor tier ${actor.actorTier} permits action ${actionClass}` };
  }

  evaluateCommand(command: string, context: SecurityExecutionContext = {}): SecurityDecision {
    if (!this.enabled) {
      return { verdict: "allow", reason: "security disabled" };
    }

    const subject = command.trim();
    const capabilityDecision = this.evaluateCommandCapabilities(subject, context);
    if (capabilityDecision) {
      return capabilityDecision;
    }

    const allow = matchesRule(subject, this.allowCommands);
    if (allow) {
      return { verdict: "allow", reason: "matched explicit allow rule", matchedPattern: allow.source };
    }

    const block = matchesRule(subject, this.blockCommands);
    if (block) {
      return {
        verdict: "block",
        reason: buildDecisionMessage("command", "block", subject, block.source, "dangerous command pattern"),
        matchedPattern: block.source,
      };
    }

    const review = matchesRule(subject, this.reviewCommands);
    if (review) {
      return {
        verdict: "review",
        reason: buildDecisionMessage("command", "review", subject, review.source, "high-risk command pattern"),
        matchedPattern: review.source,
      };
    }

    return { verdict: "allow", reason: "no matching command rule" };
  }

  evaluatePath(path: string, intent: ProtectedPathIntent, context: SecurityExecutionContext = {}): SecurityDecision {
    if (!this.enabled) {
      return { verdict: "allow", reason: "security disabled" };
    }

    const normalized = normalizePath(path);
    const capabilityDecision = this.evaluatePathCapabilities(normalized, intent, context);
    if (capabilityDecision) {
      return capabilityDecision;
    }

    const allowRules = intent === "read" ? this.allowReadPaths : this.allowWritePaths;
    const allow = matchesRule(normalized, allowRules);
    if (allow) {
      return { verdict: "allow", reason: "matched explicit allow rule", matchedPattern: allow.source };
    }

    const protectedMatch = matchesRule(normalized, this.protectedPaths);
    if (!protectedMatch) {
      return { verdict: "allow", reason: "no matching path rule" };
    }

    const verdict: SecurityVerdict = intent === "read" ? "review" : "block";
    return {
      verdict,
      reason: buildDecisionMessage(
        "path",
        verdict,
        normalized,
        protectedMatch.source,
        intent === "read" ? "sensitive read path" : "protected write path",
      ),
      matchedPattern: protectedMatch.source,
    };
  }

  assertCommandAllowed(command: string, context: SecurityExecutionContext = {}): void {
    const decision = this.evaluateCommand(command, context);
    this.recordDecision({
      decision,
      subjectKind: "command",
      subject: command.trim(),
      context,
    });
    this.assertDecision(decision, "security.commandPolicy.allowPatterns", "security.mode");
  }

  assertPathAllowed(path: string, intent: ProtectedPathIntent, context: SecurityExecutionContext = {}): void {
    const normalized = normalizePath(path);
    const decision = this.evaluatePath(normalized, intent, context);
    this.recordDecision({
      decision,
      subjectKind: "path",
      subject: normalized,
      intent,
      context,
    });
    this.assertDecision(
      decision,
      intent === "read" ? "security.pathPolicy.allowReadPaths" : "security.pathPolicy.allowWritePaths",
      "security.mode",
    );
  }

  assertActionAllowed(actionClass: SecurityActionClass, context: SecurityExecutionContext = {}): void {
    const decision = this.evaluateAction(actionClass, { ...context, actionClass });
    this.recordDecision({
      decision,
      subjectKind: "action",
      subject: actionClass,
      context: { ...context, actionClass },
    });
    this.assertDecision(decision, "security.rolePolicy", "security.mode");
  }

  private evaluateCommandCapabilities(
    command: string,
    context: SecurityExecutionContext,
  ): SecurityDecision | null {
    const capabilityPolicy = this.getEffectiveCapabilityPolicy(context);
    if (!capabilityPolicy) return null;
    const toolCategory = defaultToolCategory(context);

    if (
      context.machineId !== undefined
      && capabilityPolicy.allowedMachineIds?.length
      && !capabilityPolicy.allowedMachineIds.includes(context.machineId)
    ) {
      return {
        verdict: "review",
        reason: `Security capability policy requires approval for machine ${context.machineId}. Allowed machines: ${capabilityPolicy.allowedMachineIds.join(", ")}`,
      };
    }

    if (
      capabilityPolicy.allowedToolCategories?.length
      && !capabilityPolicy.allowedToolCategories.includes(toolCategory)
    ) {
      return {
        verdict: "review",
        reason: `Security capability policy requires approval for tool category ${toolCategory}. Allowed tool categories: ${capabilityPolicy.allowedToolCategories.join(", ")}`,
      };
    }

    if (capabilityPolicy.allowNetworkAccess === false && isNetworkAccess(context)) {
      return {
        verdict: "review",
        reason: "Security capability policy requires approval for network or remote access",
      };
    }

    if (capabilityPolicy.allowDestructiveActions === false && context.destructive) {
      return {
        verdict: "block",
        reason: "Security capability policy blocked a destructive action outside the approved capability envelope",
      };
    }

    const destructivePattern = matchesRule(command, compileRules(DEFAULT_BLOCK_COMMAND_PATTERNS));
    if (capabilityPolicy.allowDestructiveActions === false && destructivePattern) {
      return {
        verdict: "block",
        reason: "Security capability policy blocked a destructive command outside the approved capability envelope",
        matchedPattern: destructivePattern.source,
      };
    }

    return null;
  }

  private evaluatePathCapabilities(
    path: string,
    intent: ProtectedPathIntent,
    context: SecurityExecutionContext,
  ): SecurityDecision | null {
    const capabilityPolicy = this.getEffectiveCapabilityPolicy(context);
    if (!capabilityPolicy) return null;
    const toolCategory = defaultToolCategory(context);

    if (
      context.machineId !== undefined
      && capabilityPolicy.allowedMachineIds?.length
      && !capabilityPolicy.allowedMachineIds.includes(context.machineId)
    ) {
      return {
        verdict: intent === "read" ? "review" : "block",
        reason: `Security capability policy blocked path access on machine ${context.machineId} outside the approved machine envelope`,
      };
    }

    if (
      capabilityPolicy.allowedToolCategories?.length
      && !capabilityPolicy.allowedToolCategories.includes(toolCategory)
    ) {
      return {
        verdict: intent === "read" ? "review" : "block",
        reason: `Security capability policy blocked path access from tool category ${toolCategory} outside the approved tool envelope`,
      };
    }

    if (capabilityPolicy.allowNetworkAccess === false && isNetworkAccess(context)) {
      return {
        verdict: intent === "read" ? "review" : "block",
        reason: "Security capability policy requires approval for network or remote path access",
      };
    }

    if (capabilityPolicy.allowDestructiveActions === false && (context.destructive || intent === "write")) {
      return {
        verdict: "block",
        reason: "Security capability policy blocked a destructive path action outside the approved capability envelope",
      };
    }

    const roots = normalizeRoots(intent === "read" ? capabilityPolicy.allowedReadPathRoots : capabilityPolicy.allowedWritePathRoots);
    if (roots.length > 0 && !pathWithinRoots(path, roots)) {
      return {
        verdict: intent === "read" ? "review" : "block",
        reason: `Security capability policy ${intent === "read" ? "requires approval for" : "blocked"} path access outside approved ${intent} roots`,
      };
    }

    return null;
  }

  private recordDecision(input: {
    decision: SecurityDecision;
    subjectKind: SecurityAuditRecord["subjectKind"];
    subject: string;
    intent?: ProtectedPathIntent;
    context: SecurityExecutionContext;
  }): void {
    if (!this.auditStore) return;
    const actor = this.resolveActor(input.context);
    this.auditStore.saveDecision({
      decisionId: nanoid(),
      subjectKind: input.subjectKind,
      subject: redactSubject(input.subjectKind, input.subject),
      verdict: input.decision.verdict,
      reason: sanitizeReasonForAudit(input.decision.reason),
      matchedPattern: input.decision.matchedPattern,
      intent: input.intent,
      actorRole: actor.actorRole,
      actorId: actor.actorId,
      actorTier: actor.actorTier,
      actionClass: input.context.actionClass,
      sessionId: input.context.sessionId,
      runId: input.context.runId,
      machineId: input.context.machineId,
      toolName: input.context.toolName,
      toolFamily: input.context.toolFamily,
      networkAccess: isNetworkAccess(input.context),
      destructive: input.context.destructive
        ?? (input.subjectKind === "path"
          ? input.intent === "write"
          : matchesRule(input.subject, this.blockCommands) !== null || /\bkill(?:\s|$)/i.test(input.subject)),
      createdAt: Date.now(),
    });
  }

  private resolveActor(context: SecurityExecutionContext): ResolvedActor {
    const actorRole = context.actorRole ?? "agent";
    const defaultTier = this.rolePolicy?.defaultActorTierByRole?.[actorRole] ?? DEFAULT_ACTOR_TIER_BY_ROLE[actorRole];
    const boundTier = context.actorId
      ? this.rolePolicy?.actorBindings?.find((binding) => binding.actorId === context.actorId)?.actorTier
      : undefined;
    return {
      actorRole,
      actorId: context.actorId ?? `${actorRole}:default`,
      actorTier: context.actorTier ?? boundTier ?? defaultTier,
    };
  }

  private resolveRoleRule(actorTier: SecurityActorTier): SecurityRoleRule {
    const defaults = DEFAULT_TIER_RULES[actorTier] ?? {};
    const overrides = this.rolePolicy?.tierRules?.[actorTier] ?? {};
    return {
      allowedActionClasses: overrides.allowedActionClasses ?? defaults.allowedActionClasses,
      capabilityPolicy: this.mergeCapabilityPolicies(defaults.capabilityPolicy, overrides.capabilityPolicy),
    };
  }

  private getEffectiveCapabilityPolicy(context: SecurityExecutionContext): SecurityCapabilityPolicy | undefined {
    const actor = this.resolveActor(context);
    return this.mergeCapabilityPolicies(this.capabilityPolicy, this.resolveRoleRule(actor.actorTier).capabilityPolicy);
  }

  private mergeCapabilityPolicies(
    base?: SecurityCapabilityPolicy,
    override?: SecurityCapabilityPolicy,
  ): SecurityCapabilityPolicy | undefined {
    if (!base && !override) return undefined;
    return {
      allowedMachineIds: intersectValues(base?.allowedMachineIds, override?.allowedMachineIds),
      allowedToolCategories: intersectValues(base?.allowedToolCategories, override?.allowedToolCategories) as SecurityCapabilityPolicy["allowedToolCategories"],
      allowNetworkAccess: override?.allowNetworkAccess ?? base?.allowNetworkAccess,
      allowDestructiveActions: override?.allowDestructiveActions ?? base?.allowDestructiveActions,
      allowedReadPathRoots: intersectValues(base?.allowedReadPathRoots, override?.allowedReadPathRoots),
      allowedWritePathRoots: intersectValues(base?.allowedWritePathRoots, override?.allowedWritePathRoots),
    };
  }

  private assertDecision(decision: SecurityDecision, allowHint: string, modeHint: string): void {
    if (decision.verdict === "allow") {
      return;
    }

    if (this.mode === "audit") {
      process.stderr.write(`[athena][security:audit] ${decision.reason}\n`);
      return;
    }

    if (decision.verdict === "review") {
      throw new Error(`${decision.reason}. To permit intentionally, add a matching rule to ${allowHint} or temporarily set ${modeHint} to "audit" in athena.json.`);
    }

    throw new Error(`${decision.reason}. If this is truly intentional, narrow the command/path and add an explicit allow rule in ${allowHint}.`);
  }
}

export type {
  SecurityConfig,
  SecurityDecision,
  SecurityExecutionContext,
  SecurityMode,
  SecurityStatus,
  SecurityVerdict,
  ProtectedPathIntent,
} from "./contracts.js";
