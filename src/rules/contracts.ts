import type { DomainId } from "../identity/index.js";
import type { CalculationTraceRef } from "../lineage/index.js";
import type { Instant } from "../time/index.js";
import type { Money, Ratio, RoundingPolicy } from "../values/index.js";

export type FinancialRuleId = DomainId<"tax-rule">;
export type RuleId = FinancialRuleId;
export type RuleKind = "proportional_income_tax" | "annual_contribution_limit" | "product_operation_eligibility" | "fixed_fee";
export type RuleTargetType = "person" | "household" | "account" | "liability";

export interface RuleTarget {
  readonly targetType: RuleTargetType;
  readonly targetId: DomainId<string>;
}

interface EffectiveDatedRule {
  readonly id: RuleId;
  readonly kind: RuleKind;
  readonly target: RuleTarget;
  readonly effectiveFrom: Instant;
  readonly effectiveUntil?: Instant;
}

export interface ProportionalIncomeTaxRule extends EffectiveDatedRule {
  readonly kind: "proportional_income_tax";
  readonly effectiveRate: Ratio;
  readonly postingRounding: RoundingPolicy;
}

export interface AnnualContributionLimitRule extends EffectiveDatedRule {
  readonly kind: "annual_contribution_limit";
  readonly target: RuleTarget & { readonly targetType: "account" };
  readonly calendarYear: number;
  readonly calendar: "utc";
  readonly annualLimit: Money;
}

export type ProductOperationKind = "contribution" | "withdrawal" | "extra_principal";

interface ProductOperationEligibilityRuleBase extends EffectiveDatedRule {
  readonly kind: "product_operation_eligibility";
  readonly allowed: boolean;
}

export type ProductOperationEligibilityRule =
  | ProductOperationEligibilityRuleBase & {
      readonly target: RuleTarget & { readonly targetType: "account" };
      readonly operation: "contribution" | "withdrawal";
    }
  | ProductOperationEligibilityRuleBase & {
      readonly target: RuleTarget & { readonly targetType: "liability" };
      readonly operation: "extra_principal";
    };

export interface FixedFeeRule extends EffectiveDatedRule {
  readonly kind: "fixed_fee";
  readonly target: RuleTarget & { readonly targetType: "account" };
  readonly amount: Money;
}

export type FinancialRule = ProportionalIncomeTaxRule | AnnualContributionLimitRule | ProductOperationEligibilityRule | FixedFeeRule;
export type RuleCatalog = readonly FinancialRule[];

export interface RuleApplication<Result> {
  readonly ruleId: RuleId;
  readonly ruleKind: RuleKind;
  readonly target: RuleTarget;
  readonly evaluatedAt: Instant;
  readonly result: Result;
  readonly traceRefs: readonly CalculationTraceRef[];
}
