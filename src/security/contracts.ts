export type SecurityMode = "audit" | "enforce";
export type SecurityVerdict = "allow" | "review" | "block";
export type ProtectedPathIntent = "read" | "write";
export type SecurityActorRole = "agent" | "operator" | "system";
export type SecurityActorTier =
  | "agent_worker"
  | "operator_admin"
  | "operator_reviewer"
  | "operator_observer"
  | "system_runtime";
export type SecurityActionClass =
  | "inspect"
  | "ingest"
  | "approve"
  | "defer"
  | "revisit"
  | "resume"
  | "rollback"
  | "archive"
  | "promote"
  | "dismiss"
  | "execute";
export type SecuritySubjectKind = "command" | "path" | "action";
export type SecurityToolFamily =
  | "shell"
  | "filesystem"
  | "remote-sync"
  | "research-orchestration"
  | "other";

export interface SecurityCapabilityPolicy {
  allowedMachineIds?: string[];
  allowedToolCategories?: SecurityToolFamily[];
  allowNetworkAccess?: boolean;
  allowDestructiveActions?: boolean;
  allowedReadPathRoots?: string[];
  allowedWritePathRoots?: string[];
}

export interface SecurityRoleRule {
  allowedActionClasses?: SecurityActionClass[];
  capabilityPolicy?: SecurityCapabilityPolicy;
}

export interface SecurityRolePolicy {
  defaultActorTierByRole?: Partial<Record<SecurityActorRole, SecurityActorTier>>;
  actorBindings?: Array<{ actorId: string; actorTier: SecurityActorTier }>;
  tierRules?: Partial<Record<SecurityActorTier, SecurityRoleRule>>;
}

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
  capabilityPolicy?: SecurityCapabilityPolicy;
  rolePolicy?: SecurityRolePolicy;
}

export interface SecurityExecutionContext {
  actorRole?: SecurityActorRole;
  actorId?: string;
  actorTier?: SecurityActorTier;
  actionClass?: SecurityActionClass;
  sessionId?: string;
  runId?: string;
  machineId?: string;
  toolName?: string;
  toolFamily?: SecurityToolFamily;
  networkAccess?: boolean;
  destructive?: boolean;
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
  capabilityPolicy: {
    enabled: boolean;
    machines: number;
    toolCategories: number;
    allowNetworkAccess: boolean | null;
    allowDestructiveActions: boolean | null;
    allowReadRoots: number;
    allowWriteRoots: number;
  };
  rolePolicy: {
    enabled: boolean;
    actorBindings: number;
    tierRules: number;
  };
}

export interface SecurityAuditRecord {
  decisionId: string;
  subjectKind: SecuritySubjectKind;
  subject: string;
  verdict: SecurityVerdict;
  reason: string;
  matchedPattern?: string;
  intent?: ProtectedPathIntent;
  actorRole?: SecurityActorRole;
  actorId?: string;
  actorTier?: SecurityActorTier;
  actionClass?: SecurityActionClass;
  sessionId?: string;
  runId?: string;
  machineId?: string;
  toolName?: string;
  toolFamily?: SecurityToolFamily;
  networkAccess?: boolean;
  destructive?: boolean;
  createdAt: number;
}

export interface SecurityAuditSummary {
  total: number;
  allow: number;
  review: number;
  block: number;
  lastDecisionAt?: number;
}
