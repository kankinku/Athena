/**
 * tool-approval.ts
 *
 * 에이전트 도구 호출에 대한 승인 게이트.
 * OpenAI 가이드 권고: tool approvals를 항상 켜고 위험한 동작을 사람 승인으로 감싸라.
 *
 * 도구를 위험도 레벨(safe / reviewable / forbidden)로 분류하고,
 * 에이전트 역할 및 모듈 범위에 따라 자동 승인 또는 사람 승인을 결정한다.
 */

import type {
  SecurityActorRole,
  SecurityActorTier,
  SecurityToolFamily,
  SecurityCapabilityPolicy,
} from "./contracts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolRiskLevel = "safe" | "reviewable" | "forbidden";

export interface ToolApprovalRequest {
  toolName: string;
  toolFamily: SecurityToolFamily;
  actorRole: SecurityActorRole;
  actorId: string;
  actorTier?: SecurityActorTier;
  moduleScope?: string;          // 에이전트가 속한 모듈
  targetPaths?: string[];         // 도구가 접근하려는 경로
  destructive?: boolean;
  networkAccess?: boolean;
  sessionId?: string;
  runId?: string;
}

export interface ToolApprovalResult {
  approved: boolean;
  riskLevel: ToolRiskLevel;
  reason: string;
  requiresOperatorApproval: boolean;
  suggestedAction?: string;
}

// ─── Tool Classification ──────────────────────────────────────────────────────

const TOOL_RISK_MAP: Record<string, ToolRiskLevel> = {
  // safe — 읽기 전용, 정보 조회
  "memory_ls": "safe",
  "memory_read": "safe",
  "show_metrics": "safe",
  "compare_runs": "safe",
  "task_output": "safe",
  "list_machines": "safe",
  "web_fetch": "safe",
  "consult": "safe",

  // reviewable — 수정 가능, 사전 검증 필요
  "read_file": "safe",
  "write_file": "reviewable",
  "patch_file": "reviewable",
  "memory_write": "reviewable",
  "memory_rm": "reviewable",
  "remote_exec": "reviewable",
  "remote_exec_background": "reviewable",
  "remote_upload": "reviewable",
  "remote_download": "safe",
  "sleep": "safe",
  "start_monitor": "reviewable",
  "stop_monitor": "safe",
  "kill_task": "reviewable",
  "clear_metrics": "reviewable",

  // forbidden — 직접 호출 불가, 시스템 파괴/보안 위반 위험
  "rm_rf": "forbidden",
  "format_disk": "forbidden",
  "drop_database": "forbidden",
  "truncate_table": "forbidden",
  "disable_security": "forbidden",
  "override_policy": "forbidden",
  "raw_sql_exec": "forbidden",
  "shell_exec_root": "forbidden",
  "modify_permissions": "forbidden",
  "delete_backups": "forbidden",
  "export_credentials": "forbidden",
  "bypass_approval": "forbidden",
};

const FAMILY_RISK_MAP: Record<SecurityToolFamily, ToolRiskLevel> = {
  "shell": "reviewable",
  "filesystem": "reviewable",
  "remote-sync": "reviewable",
  "research-orchestration": "safe",
  "other": "reviewable",
};

// ─── ToolApprovalGate ─────────────────────────────────────────────────────────

export class ToolApprovalGate {
  private capabilityPolicy?: SecurityCapabilityPolicy;

  constructor(capabilityPolicy?: SecurityCapabilityPolicy) {
    this.capabilityPolicy = capabilityPolicy;
  }

  /**
   * 도구 호출 승인 여부를 판단한다.
   */
  evaluate(request: ToolApprovalRequest): ToolApprovalResult {
    const riskLevel = this.classifyRisk(request);

    // forbidden → 무조건 차단
    if (riskLevel === "forbidden") {
      return {
        approved: false,
        riskLevel,
        reason: `Tool '${request.toolName}' is forbidden`,
        requiresOperatorApproval: false,
      };
    }

    // operator는 모든 도구 사용 가능
    if (request.actorRole === "operator") {
      return {
        approved: true,
        riskLevel,
        reason: "Operator has full tool access",
        requiresOperatorApproval: false,
      };
    }

    // system은 safe 도구만 자동 승인
    if (request.actorRole === "system") {
      if (riskLevel === "safe") {
        return {
          approved: true,
          riskLevel,
          reason: "System can use safe tools",
          requiresOperatorApproval: false,
        };
      }
      return {
        approved: false,
        riskLevel,
        reason: "System cannot use reviewable tools without operator approval",
        requiresOperatorApproval: true,
        suggestedAction: "Request operator to approve this tool use",
      };
    }

    // agent — 위험도 + 범위 검사
    if (request.actorRole === "agent") {
      return this.evaluateAgentRequest(request, riskLevel);
    }

    // fallback
    return {
      approved: false,
      riskLevel,
      reason: `Unknown actor role: ${request.actorRole}`,
      requiresOperatorApproval: true,
    };
  }

  /**
   * 도구의 위험도를 분류한다.
   */
  classifyRisk(request: ToolApprovalRequest): ToolRiskLevel {
    // 도구 이름으로 직접 분류
    const byName = TOOL_RISK_MAP[request.toolName];
    if (byName) {
      // destructive 플래그가 있으면 한 단계 상승
      if (request.destructive && byName === "safe") return "reviewable";
      if (request.destructive && byName === "reviewable") return "forbidden";
      return byName;
    }

    // 도구 패밀리로 분류
    return FAMILY_RISK_MAP[request.toolFamily] ?? "reviewable";
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private evaluateAgentRequest(
    request: ToolApprovalRequest,
    riskLevel: ToolRiskLevel,
  ): ToolApprovalResult {
    // safe 도구 — 자동 승인
    if (riskLevel === "safe") {
      return {
        approved: true,
        riskLevel,
        reason: `Safe tool '${request.toolName}' auto-approved for agent`,
        requiresOperatorApproval: false,
      };
    }

    // reviewable 도구 — 범위 검사 필요
    // capability policy 확인
    if (this.capabilityPolicy) {
      // 네트워크 접근 검사
      if (request.networkAccess && this.capabilityPolicy.allowNetworkAccess === false) {
        return {
          approved: false,
          riskLevel,
          reason: "Network access is not allowed by capability policy",
          requiresOperatorApproval: true,
        };
      }

      // destructive 액션 검사
      if (request.destructive && this.capabilityPolicy.allowDestructiveActions === false) {
        return {
          approved: false,
          riskLevel,
          reason: "Destructive actions are not allowed by capability policy",
          requiresOperatorApproval: true,
        };
      }

      // 도구 패밀리 검사
      if (this.capabilityPolicy.allowedToolCategories) {
        if (!this.capabilityPolicy.allowedToolCategories.includes(request.toolFamily)) {
          return {
            approved: false,
            riskLevel,
            reason: `Tool family '${request.toolFamily}' is not in allowed categories`,
            requiresOperatorApproval: true,
          };
        }
      }

      // 경로 검사 (write)
      if (request.targetPaths && this.capabilityPolicy.allowedWritePathRoots) {
        const roots = this.capabilityPolicy.allowedWritePathRoots;
        const outOfScope = request.targetPaths.filter((p) =>
          !roots.some((root) => {
            const re = new RegExp(root);
            return re.test(p);
          }),
        );
        if (outOfScope.length > 0) {
          return {
            approved: false,
            riskLevel,
            reason: `Path(s) out of allowed write scope: ${outOfScope.join(", ")}`,
            requiresOperatorApproval: true,
          };
        }
      }
    }

    // reviewable + agent_worker tier → 운영자 승인 필요
    if (request.actorTier === "agent_worker") {
      return {
        approved: false,
        riskLevel,
        reason: `Reviewable tool '${request.toolName}' requires operator approval for agent_worker tier`,
        requiresOperatorApproval: true,
        suggestedAction: "Submit tool approval request to operator",
      };
    }

    // reviewable + 그 외 tier → 자동 승인 (capability 내에서)
    return {
      approved: true,
      riskLevel,
      reason: `Reviewable tool '${request.toolName}' auto-approved within capability scope`,
      requiresOperatorApproval: false,
    };
  }
}
