import { domainId } from "../../src/identity/index.js";
import { instant } from "../../src/time/index.js";
import { Ratio, RoundingPolicy, decimal, money } from "../../src/values/index.js";
import type { TaxCalculationInput, TaxCoreRule, TaxIncomeFacts } from "../../src/rules/index.js";

/** Synthetic, test-only rules. None of these values purport to be tax law. */
export const taxRule = (number = 1, overrides: Partial<TaxCoreRule> = {}): TaxCoreRule => ({
  id: domainId("tax-rule", `81000000-0000-4000-8000-${String(number).padStart(12, "0")}`),
  kind: "tax_core", target: { targetType: "jurisdiction", targetId: domainId("jurisdiction", "82000000-0000-4000-8000-000000000001") },
  version: "synthetic-v1", jurisdiction: "TEST:US", filingStatus: "single",
  effectiveFrom: instant("2024-01-01T00:00:00.000Z"), effectiveUntil: instant("2025-01-01T00:00:00.000Z"),
  applicability: [], provenance: { type: "synthetic_test_only", description: "T1A mechanics fixture; not tax law" }, rounding: new RoundingPolicy(2, "half_even"),
  income: {
    basis: "recognized_income", ordinaryBrackets: [{ lower: money("0"), rate: Ratio.parse("0.1") }, { lower: money("10000"), rate: Ratio.parse("0.2") }],
    standardDeduction: money("1000"), capitalTreatment: "preferential",
    preferentialBrackets: [{ lower: money("0"), rate: Ratio.parse("0") }, { lower: money("20000"), rate: Ratio.parse("0.15") }, { lower: money("40000"), rate: Ratio.parse("0.2") }],
    capitalLossDeductionLimit: money("3000"), traditionalContributionDeduction: true,
  }, ...overrides,
});
export const taxInput = (income: Partial<TaxIncomeFacts> = {}, overrides: Partial<TaxCalculationInput> = {}): TaxCalculationInput => ({
  income: {
    wages: money("0"), taxableInterest: money("0"), ordinaryDividends: money("0"), qualifiedDividends: money("0"), shortTermGains: money("0"), longTermGains: money("0"),
    traditionalContributions: money("0"), eligibleTraditionalDeduction: money("0"), traditionalDistributions: money("0"), traditionalDistributionBasisRecovered: money("0"),
    rothContributions: money("0"), rothDistributions: money("0"), taxableRothDistributions: money("0"), ...income,
  }, withholding: money("0"), estimatedPayments: money("0"), priorPaymentCredit: money("0"), ...overrides,
});
export const syntheticPayroll: NonNullable<TaxCoreRule["payroll"]> = [
  { key: "social", rate: Ratio.parse("0.062"), basis: "per_employee", threshold: money("0"), wageBase: money("100000") },
  { key: "medicare", rate: Ratio.parse("0.0145"), basis: "per_employee", threshold: money("0") },
  { key: "additional", rate: Ratio.parse("0.009"), basis: "combined_wages", threshold: money("200000") },
];
export const syntheticRmd: NonNullable<TaxCoreRule["rmd"]> = { minimumAge: 73, divisors: [{ age: 73, divisor: decimal("26.5") }, { age: 74, divisor: decimal("25.5") }] };
