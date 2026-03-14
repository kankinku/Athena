import { homedir } from "node:os";
import { join } from "node:path";
import { ATHENA_DIR } from "../paths.js";

export type SecurityMode = "audit" | "enforce";
export type SecurityVerdict = "allow" | "review" | "block";
export type ProtectedPathIntent = "read" | "write";

export interface SecurityConfig {
  enabled?: boolean;
  mode?: SecurityMode;
  commandPolicy?: {
    allowPatterns?: string[];
    reviewPatterns?: string[];
    blockPatterns?: string[];
  };
  pathPolicy?: {
    allowReadPaths?: string[];
    allowWritePaths?: string[];
    protectedPaths?: string[];
  };
}

export interface SecurityDecision {
  verdict: SecurityVerdict;
  reason: string;
  matchedPattern?: string;
}

export interface SecurityStatus {
  enabled: boolean;
  mode: SecurityMode;
  commandRules: {
    allow: number;
    review: number;
    block: number;
  };
  pathRules: {
    allowRead: number;
    allowWrite: number;
    protected: number;
  };
}

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/");
  return /^[a-z]:\//i.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
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

function buildDecisionMessage(kind: "command" | "path", verdict: Exclude<SecurityVerdict, "allow">, subject: string, matchedPattern: string, reason: string): string {
  const action = verdict === "block" ? "blocked" : "requires approval";
  return `Security policy ${action} this ${kind}: ${reason}. Matched pattern: ${matchedPattern}. Subject: ${subject}`;
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

  constructor(config: SecurityConfig | undefined = undefined) {
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
    };
  }

  evaluateCommand(command: string): SecurityDecision {
    if (!this.enabled) {
      return { verdict: "allow", reason: "security disabled" };
    }

    const subject = command.trim();
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

  evaluatePath(path: string, intent: ProtectedPathIntent): SecurityDecision {
    if (!this.enabled) {
      return { verdict: "allow", reason: "security disabled" };
    }

    const normalized = normalizePath(path);
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
      reason: buildDecisionMessage("path", verdict, normalized, protectedMatch.source, intent === "read" ? "sensitive read path" : "protected write path"),
      matchedPattern: protectedMatch.source,
    };
  }

  assertCommandAllowed(command: string): void {
    const decision = this.evaluateCommand(command);
    this.assertDecision(decision, "security.commandPolicy.allowPatterns", "security.mode");
  }

  assertPathAllowed(path: string, intent: ProtectedPathIntent): void {
    const decision = this.evaluatePath(path, intent);
    this.assertDecision(
      decision,
      intent === "read" ? "security.pathPolicy.allowReadPaths" : "security.pathPolicy.allowWritePaths",
      "security.mode",
    );
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
      throw new Error(`${decision.reason}. To permit intentionally, add a matching rule to ${allowHint} or temporarily set ${modeHint} to \"audit\" in athena.json.`);
    }

    throw new Error(`${decision.reason}. If this is truly intentional, narrow the command/path and add an explicit allow rule in ${allowHint}.`);
  }
}
