/**
 * improvement-policy.ts
 *
 * 반복되는 improvement proposal을 재사용 가능한 정책으로 승격한다.
 * gap 문서 지적사항: mergeKey 기반 중복 병합, promotion flow, review APIs 부재.
 *
 * 흐름:
 * 1. ImprovementProposal이 여러 번 생성되면 mergeKey로 중복 감지
 * 2. promoted 된 proposal은 ReusablePolicy로 변환
 * 3. ReusablePolicy는 이후 자동으로 적용됨
 */

import { nanoid } from "nanoid";
import type { ImprovementProposalRecord, ImprovementTargetArea } from "./contracts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReusablePolicy {
  policyId: string;
  mergeKey: string;
  targetArea: ImprovementTargetArea;
  title: string;
  description: string;
  rules: PolicyRule[];
  sourceImprovementIds: string[];
  promotedAt: number;
  promotedBy: string;
  active: boolean;
}

export interface PolicyRule {
  ruleId: string;
  condition: string;        // 적용 조건 (예: "모듈 위험도 >= high")
  action: string;           // 적용 동작 (예: "회의 라운드를 4로 제한")
  priority: number;         // 높을수록 먼저 적용
}

export interface MergeAnalysis {
  mergeKey: string;
  occurrences: number;
  improvementIds: string[];
  targetArea: ImprovementTargetArea;
  promotionReady: boolean;  // 3회 이상 반복되면 승격 추천
  suggestedPolicy: string;
}

// ─── ImprovementPolicyEngine ──────────────────────────────────────────────────

export class ImprovementPolicyEngine {
  private policies: Map<string, ReusablePolicy> = new Map();

  /**
   * improvement proposal 목록에서 mergeKey 중복을 분석한다.
   */
  analyzeMerges(proposals: ImprovementProposalRecord[]): MergeAnalysis[] {
    const grouped = new Map<string, ImprovementProposalRecord[]>();

    for (const p of proposals) {
      if (!grouped.has(p.mergeKey)) {
        grouped.set(p.mergeKey, []);
      }
      grouped.get(p.mergeKey)!.push(p);
    }

    const analyses: MergeAnalysis[] = [];
    for (const [mergeKey, items] of grouped) {
      if (items.length >= 2) { // 2회 이상 반복
        analyses.push({
          mergeKey,
          occurrences: items.length,
          improvementIds: items.map((i) => i.improvementId),
          targetArea: items[0].targetArea,
          promotionReady: items.length >= 3,
          suggestedPolicy: this.suggestPolicy(items),
        });
      }
    }

    return analyses.sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * improvement proposal을 재사용 정책으로 승격한다.
   */
  promote(
    mergeKey: string,
    proposals: ImprovementProposalRecord[],
    promotedBy: string,
  ): ReusablePolicy {
    const matching = proposals.filter((p) => p.mergeKey === mergeKey);
    if (matching.length === 0) {
      throw new Error(`No proposals found with mergeKey: ${mergeKey}`);
    }

    const policy: ReusablePolicy = {
      policyId: `pol_${nanoid(8)}`,
      mergeKey,
      targetArea: matching[0].targetArea,
      title: matching[0].title,
      description: `${matching.length}회 반복 관찰된 개선 패턴의 자동 적용 정책`,
      rules: this.extractRules(matching),
      sourceImprovementIds: matching.map((p) => p.improvementId),
      promotedAt: Date.now(),
      promotedBy,
      active: true,
    };

    this.policies.set(policy.policyId, policy);
    return policy;
  }

  /**
   * 활성 정책 목록을 반환한다.
   */
  listActivePolicies(): ReusablePolicy[] {
    return Array.from(this.policies.values()).filter((p) => p.active);
  }

  /**
   * 주어진 target area에 해당하는 활성 정책을 반환한다.
   */
  getPoliciesForArea(area: ImprovementTargetArea): ReusablePolicy[] {
    return this.listActivePolicies().filter((p) => p.targetArea === area);
  }

  /**
   * 정책을 비활성화한다.
   */
  deactivate(policyId: string): boolean {
    const policy = this.policies.get(policyId);
    if (!policy) return false;
    policy.active = false;
    return true;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private suggestPolicy(proposals: ImprovementProposalRecord[]): string {
    // 가장 최근 proposal의 hypothesis를 기반으로 정책 제안
    const latest = proposals.sort((a, b) => b.createdAt - a.createdAt)[0];
    return `${latest.targetArea} 영역에서 반복 관찰: "${latest.title}" → 자동 적용 정책으로 승격 검토`;
  }

  private extractRules(proposals: ImprovementProposalRecord[]): PolicyRule[] {
    // 각 proposal의 hypothesis에서 규칙을 추출
    const rules: PolicyRule[] = [];

    for (const p of proposals) {
      rules.push({
        ruleId: `rule_${nanoid(6)}`,
        condition: `${p.targetArea} 영역에서 유사 상황 발생`,
        action: p.hypothesis,
        priority: p.priorityScore,
      });
    }

    // 중복 제거 (같은 action)
    const seen = new Set<string>();
    return rules.filter((r) => {
      if (seen.has(r.action)) return false;
      seen.add(r.action);
      return true;
    });
  }
}
