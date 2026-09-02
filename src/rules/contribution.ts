import { validationIssue, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../lineage/index.js";
import type { Instant } from "../time/index.js";
import { Money } from "../values/index.js";
import type { AnnualContributionLimitRule, RuleApplication } from "./contracts.js";

export type ContributionLimitDecisionKind = "allowed" | "partially_allowed" | "rejected";
export interface ContributionLimitDecision {
  readonly decision: ContributionLimitDecisionKind;
  readonly requested: Money;
  readonly usedBefore: Money;
  readonly annualLimit: Money;
  readonly remainingBefore: Money;
  readonly accepted: Money;
  readonly excess: Money;
  readonly ruleId: AnnualContributionLimitRule["id"];
  readonly diagnostics: readonly ValidationIssue[];
}

export const evaluateAnnualContributionLimit = (rule: AnnualContributionLimitRule, requested: Money, usedBefore: Money, at: Instant): RuleApplication<ContributionLimitDecision> => {
  if (requested.isNegative() || usedBefore.isNegative()) throw new Error("Contribution request and prior usage must be nonnegative");
  if (!requested.currency.equals(rule.annualLimit.currency) || !usedBefore.currency.equals(rule.annualLimit.currency)) throw new Error("Contribution values must use the rule currency");
  const remainingBefore = usedBefore.compare(rule.annualLimit) >= 0 ? Money.zero(rule.annualLimit.currency) : rule.annualLimit.minus(usedBefore);
  const accepted = requested.compare(remainingBefore) > 0 ? remainingBefore : requested;
  const excess = requested.minus(accepted);
  const decision: ContributionLimitDecisionKind = accepted.equals(requested) ? "allowed" : accepted.isPositive() ? "partially_allowed" : "rejected";
  const diagnostics = excess.isPositive() || usedBefore.compare(rule.annualLimit) > 0 ? Object.freeze([validationIssue({ severity: "warning", code: issueCodes.contributionLimitApplied, message: `Contribution rule ${rule.id} limited the requested amount`, entityType: "financial_rule", entityId: rule.id, relatedIds: [rule.target.targetId] })]) : Object.freeze([]);
  const result = Object.freeze({ decision, requested, usedBefore, annualLimit: rule.annualLimit, remainingBefore, accepted, excess, ruleId: rule.id, diagnostics });
  const traceRefs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`rule:${rule.kind}:${rule.id}:${at}`), [rule.id])])!;
  return Object.freeze({ ruleId: rule.id, ruleKind: rule.kind, target: Object.freeze({ ...rule.target }), evaluatedAt: at, result, traceRefs });
};
