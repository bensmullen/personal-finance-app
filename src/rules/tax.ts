import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../lineage/index.js";
import type { Instant } from "../time/index.js";
import { Money, Ratio, RoundingPolicy, decimal } from "../values/index.js";
import type { ProportionalIncomeTaxRule, RuleApplication } from "./contracts.js";

export type ResolvedProportionalTaxRule = ProportionalIncomeTaxRule;

export const calculateProportionalTax = (base: Money, taxRate: Ratio, postingRounding: RoundingPolicy): Money => {
  if (taxRate.value.isNegative() || taxRate.value.compare(decimal("1")) > 0) throw new Error("Tax ratio must be from 0 to 1");
  if (base.isNegative()) throw new Error("Tax base cannot be negative");
  return new Money(base.amount.times(taxRate.value).round(postingRounding), base.currency);
};

export const applyProportionalIncomeTaxRule = (rule: ProportionalIncomeTaxRule, taxableBase: Money, at: Instant): RuleApplication<Money> => {
  const tax = calculateProportionalTax(taxableBase, rule.effectiveRate, rule.postingRounding);
  const traceRefs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`rule:${rule.kind}:${rule.id}:${at}`), [rule.id])])!;
  return Object.freeze({ ruleId: rule.id, ruleKind: rule.kind, target: Object.freeze({ ...rule.target }), evaluatedAt: at, result: tax, traceRefs });
};
