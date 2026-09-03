import { failValidation, validationIssue, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../lineage/index.js";
import { Money } from "../values/index.js";
import type { AnnualContributionLimitRule, RuleApplication } from "./contracts.js";
import { resolvedRuleValue, type ResolvedRule } from "./resolver.js";

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

export const evaluateAnnualContributionLimit = (resolved: ResolvedRule<"annual_contribution_limit">, requested: Money, usedBefore: Money): RuleApplication<ContributionLimitDecision> => {
  const rule = resolvedRuleValue(resolved, "annual_contribution_limit");
  const at = resolved.resolvedAt;
  if (requested.isNegative()) failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: "Requested contribution must be nonnegative", entityType: "financial_rule_application", entityId: rule.id, fieldPath: "requested" });
  if (usedBefore.isNegative()) failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: "Prior contribution usage must be nonnegative", entityType: "financial_rule_application", entityId: rule.id, fieldPath: "usedBefore" });
  if (!requested.currency.equals(rule.annualLimit.currency)) failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: "Requested contribution must use the rule currency", entityType: "financial_rule_application", entityId: rule.id, fieldPath: "requested.currency" });
  if (!usedBefore.currency.equals(rule.annualLimit.currency)) failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: "Prior contribution usage must use the rule currency", entityType: "financial_rule_application", entityId: rule.id, fieldPath: "usedBefore.currency" });
  const remainingBefore = usedBefore.compare(rule.annualLimit) >= 0 ? Money.zero(rule.annualLimit.currency) : rule.annualLimit.minus(usedBefore);
  const accepted = requested.compare(remainingBefore) > 0 ? remainingBefore : requested;
  const excess = requested.minus(accepted);
  const decision: ContributionLimitDecisionKind = accepted.equals(requested) ? "allowed" : accepted.isPositive() ? "partially_allowed" : "rejected";
  const diagnostics = excess.isPositive() || usedBefore.compare(rule.annualLimit) > 0 ? Object.freeze([validationIssue({ severity: "warning", code: issueCodes.contributionLimitApplied, message: `Contribution rule ${rule.id} limited the requested amount`, entityType: "financial_rule", entityId: rule.id, relatedIds: [rule.target.targetId] })]) : Object.freeze([]);
  const result = Object.freeze({ decision, requested, usedBefore, annualLimit: rule.annualLimit, remainingBefore, accepted, excess, ruleId: rule.id, diagnostics });
  const traceRefs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`rule:${rule.kind}:${rule.id}:${at}`), [rule.id])])!;
  return Object.freeze({ ruleId: rule.id, ruleKind: rule.kind, target: Object.freeze({ ...rule.target }), evaluatedAt: at, result, traceRefs });
};
