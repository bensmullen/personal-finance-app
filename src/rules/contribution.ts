import { failValidation, validationIssue, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../lineage/index.js";
import { Money } from "../values/index.js";
import type { AnnualContributionLimitRule, RuleApplication } from "./contracts.js";
import { resolvedRuleValue, type ResolvedRule } from "./resolver.js";

export const contributionBucketIdentity = (rule: AnnualContributionLimitRule): string => `${rule.target.targetType}:${rule.target.targetId}:${rule.bucketKey ?? rule.target.targetId}:${rule.calendarYear}`;

export interface CommittedContributionUsage {
  readonly contributionId: string;
  readonly bucketIdentity: string;
  readonly character: string;
  readonly amount: Money;
}
export interface ContributionBucketDecision {
  readonly requested: Money;
  readonly accepted: Money;
  readonly excess: Money;
  readonly policy: "reject" | "auto_cap";
  readonly buckets: readonly (ContributionLimitDecision & { readonly bucketIdentity: string; readonly consumedAmount?: Money; readonly facts: Readonly<Record<string, string | boolean>> })[];
  readonly applications: readonly RuleApplication<ContributionLimitDecision>[];
}

/** Pure simultaneous evaluation. Usage must be supplied from committed execution. */
export const evaluateContributionBuckets = (
  resolved: readonly ResolvedRule<"annual_contribution_limit">[], requested: Money, character: string,
  usage: readonly CommittedContributionUsage[], policy: "reject" | "auto_cap" = "reject",
  qualifications: Readonly<Record<string, { readonly maximumAccepted: Money; readonly qualifyingCeiling: Money }>> = {},
): ContributionBucketDecision => {
  if (policy !== "reject" && policy !== "auto_cap") throw new Error("CONTRIBUTION_POLICY_INVALID");
  if (!resolved.length) throw new Error("CONTRIBUTION_LIMIT_BINDING_REQUIRED");
  for (const qualification of Object.values(qualifications)) {
    if (!qualification.maximumAccepted.currency.equals(requested.currency) || !qualification.qualifyingCeiling.currency.equals(requested.currency) || qualification.qualifyingCeiling.isNegative()) throw new Error("CONTRIBUTION_QUALIFICATION_INVALID");
  }
  if (new Set(resolved.map(binding => binding.resolvedAt)).size !== 1) throw new Error("CONTRIBUTION_LIMIT_INSTANT_MISMATCH");
  const identities = new Set<string>();
  const applications = [...resolved].sort((a, b) => String(a.rule.id).localeCompare(String(b.rule.id))).map(binding => {
    const rule = resolvedRuleValue(binding, "annual_contribution_limit");
    const key = contributionBucketIdentity(rule);
    if (identities.has(key)) throw new Error("CONTRIBUTION_LIMIT_BUCKET_AMBIGUOUS");
    identities.add(key);
    if (rule.includedCharacters !== undefined && !rule.includedCharacters.includes(character)) throw new Error("CONTRIBUTION_CHARACTER_NOT_INCLUDED");
    const seen = new Set<string>();
    let used = Money.zero(requested.currency);
    for (const entry of usage.filter(entry => entry.bucketIdentity === key)) {
      if (seen.has(entry.contributionId)) throw new Error("CONTRIBUTION_USAGE_DUPLICATE");
      seen.add(entry.contributionId);
      if (entry.amount.isNegative()) throw new Error("CONTRIBUTION_USAGE_INVALID");
      if (rule.includedCharacters === undefined || rule.includedCharacters.includes(entry.character)) used = used.plus(entry.amount);
    }
    return evaluateAnnualContributionLimit(binding, requested, used);
  });
  const maximum = applications.reduce((amount, application) => {
    const capacity = qualifications[application.ruleId]?.maximumAccepted ?? application.result.accepted;
    if (capacity.isNegative() || capacity.compare(requested) > 0) throw new Error("CONTRIBUTION_QUALIFICATION_INVALID");
    return capacity.compare(amount) < 0 ? capacity : amount;
  }, requested);
  const accepted = policy === "reject" && !maximum.equals(requested) ? Money.zero(requested.currency) : maximum;
  const finalApplications = applications.map(application => Object.freeze({ ...application, result: Object.freeze({ ...application.result, accepted, excess: requested.minus(accepted),
    decision: accepted.equals(requested) ? "allowed" as const : accepted.isPositive() ? "partially_allowed" as const : "rejected" as const }) }));
  return Object.freeze({ requested, accepted, excess: requested.minus(accepted), policy,
    applications: Object.freeze(finalApplications), buckets: Object.freeze(finalApplications.map((application, index) => {
      const rule = [...resolved].sort((a, b) => String(a.rule.id).localeCompare(String(b.rule.id)))[index]!.rule;
      const consumedAmount = qualifications[rule.id] === undefined ? accepted : accepted.compare(qualifications[rule.id]!.qualifyingCeiling) < 0 ? accepted : qualifications[rule.id]!.qualifyingCeiling;
      if (consumedAmount.compare(application.result.remainingBefore) > 0) throw new Error("CONTRIBUTION_QUALIFICATION_INVALID");
      return Object.freeze({ ...application.result, accepted, excess: requested.minus(accepted),
        decision: accepted.equals(requested) ? "allowed" as const : accepted.isPositive() ? "partially_allowed" as const : "rejected" as const,
        bucketIdentity: contributionBucketIdentity(rule),
        ...(qualifications[rule.id] === undefined ? {} : { consumedAmount }),
        facts: Object.freeze({ ...rule.capacityFacts }) });
    })) });
};

/** Called only after the accepted financial transaction has committed. */
export const committedContributionUsage = (decision: ContributionBucketDecision, contributionId: string, character: string): readonly CommittedContributionUsage[] => {
  if (!contributionId.trim()) throw new Error("CONTRIBUTION_ID_REQUIRED");
  return Object.freeze(decision.accepted.isZero() ? [] : decision.buckets.map(bucket => Object.freeze({ contributionId, character, bucketIdentity: bucket.bucketIdentity, amount: bucket.consumedAmount ?? decision.accepted })));
};

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
