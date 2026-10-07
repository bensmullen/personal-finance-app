import type { FinancialRuleId, RuleTarget } from "../contracts.js";
import type { Instant } from "../../time/index.js";
import type { CalculationTraceRef } from "../../lineage/index.js";
import type { DecimalAmount, Money, Ratio, RoundingPolicy } from "../../values/index.js";

export type FilingStatus = "single" | "married_joint" | "married_separate" | "head_of_household" | "qualifying_surviving_spouse";
export type AlphaState = "PA" | "NY" | "NJ" | "CO" | "CA" | "AZ" | "GA" | "MA";
/** Positive only for full-year residency in this taxing jurisdiction in the selected tax year. */
export const fullYearResidentEligibilityKey = (jurisdiction: string): string => `full_year_resident:${jurisdiction}`;
/**
 * Positive only after establishing base-standard-deduction eligibility and that
 * age/blindness, dependent, itemized, senior, tips, overtime, vehicle-interest
 * and other unimplemented deduction mechanics do not affect the calculation.
 * Missing/false facts gate 2026 federal selection; Phase A never infers this fact.
 */
export const federalBaseDeductionOnlyEligibilityKey = "federal_base_deduction_only";
export interface TaxJurisdictionFacts {
  /** Authoritative taxing jurisdictions, never mailing-city labels. Empty arrays mean explicitly none. */
  readonly residenceJurisdictions: readonly string[];
  readonly workJurisdictions: readonly string[];
  readonly residenceMunicipality?: string;
  readonly residencePsdCode?: string;
  readonly workMunicipality?: string;
  readonly workPsdCode?: string;
  /** Legal decisions for the selected jurisdiction/year, including the stable keys above. */
  readonly eligibility?: Readonly<Record<string, boolean>>;
}
export type TaxApplicability =
  | { readonly fact: "residenceJurisdictions" | "workJurisdictions"; readonly includes: string; readonly present: boolean }
  | { readonly fact: "residenceMunicipality" | "residencePsdCode" | "workMunicipality" | "workPsdCode"; readonly equals: string }
  | { readonly fact: "eligibility"; readonly key: string; readonly equals: boolean };

export interface TaxSource {
  readonly authority: string;
  readonly url: string;
  readonly reference: string;
  readonly verifiedOn: string;
}
/** A catalog coverage boundary, never a zero-rate or fallback liability rule. */
export interface TaxLawCoverageGap {
  readonly jurisdiction: string;
  readonly taxYear?: number;
  readonly effectiveFrom?: Instant;
  readonly effectiveUntil?: Instant;
  readonly reason: string;
  readonly sources?: readonly TaxSource[];
}
export type TaxProvenance =
  | { readonly type: "synthetic_test_only"; readonly description: string }
  | { readonly type: "projected_current_law"; readonly baseRuleId: FinancialRuleId; readonly baseYear: number; readonly policy: "nominal_carry_forward"; readonly sources: readonly TaxSource[]; readonly scope: string; readonly limitations: readonly string[] }
  | { readonly type: "verified_law"; readonly sources: readonly TaxSource[]; readonly scope: string; readonly limitations: readonly string[] };

export interface TaxBracket {
  readonly lower: Money;
  readonly rate: Ratio;
  /** Published schedule intercept, when the authority rounds cumulative bracket taxes. */
  readonly baseTax?: Money;
}
export interface IncomeTaxDefinition {
  /** Supplied legal taxable bases bypass recognition/deductions; never inferred from federal income. */
  readonly basis: "recognized_income" | "explicit_taxable_base";
  readonly ordinaryBrackets: readonly TaxBracket[];
  readonly standardDeduction: Money;
  readonly capitalTreatment: "ordinary" | "preferential";
  readonly preferentialBrackets?: readonly TaxBracket[];
  readonly capitalLossDeductionLimit: Money;
  readonly traditionalContributionDeduction: boolean;
  readonly minimumTaxableBase?: Money;
  readonly maximumAdjustedGrossIncome?: Money;
  /** Separately characterized legal bases, e.g. MA short gains and combined surtax base. */
  readonly additionalTaxes?: readonly {
    readonly key: string;
    readonly inputBase: string;
    readonly brackets: readonly TaxBracket[];
    /** Required reconciliation to ordinary taxable income plus these supplied legal bases. */
    readonly composedFrom?: readonly string[];
  }[];
}
export interface PayrollTaxDefinition {
  readonly key: string;
  readonly rate: Ratio;
  readonly basis: "per_employee" | "combined_wages";
  readonly wageBase?: Money;
  readonly threshold: Money;
}
export interface TaxCoreRule {
  readonly id: FinancialRuleId;
  readonly kind: "tax_core";
  /** Shared economic target identifies the taxing jurisdiction, never a household. */
  readonly target: RuleTarget & { readonly targetType: "jurisdiction" };
  readonly version: string;
  readonly jurisdiction: string;
  readonly filingStatus: FilingStatus | "all";
  readonly effectiveFrom: Instant;
  readonly effectiveUntil: Instant;
  readonly applicability: readonly TaxApplicability[];
  readonly provenance: TaxProvenance;
  readonly rounding: RoundingPolicy;
  readonly income?: IncomeTaxDefinition;
  readonly payroll?: readonly PayrollTaxDefinition[];
  readonly niit?: { readonly rate: Ratio; readonly threshold: Money };
  readonly periodicEmployeeTax?: { readonly amount: Money; readonly wageThreshold: Money; readonly unit: "calendar_month" | "calendar_year" };
  readonly rmd?: { readonly minimumAge: number; readonly divisors: readonly { readonly age: number; readonly divisor: DecimalAmount }[] };
}

export interface TaxIncomeFacts {
  readonly wages: Money;
  readonly taxableInterest: Money;
  /** Excludes qualified dividends, which are supplied separately. */
  readonly ordinaryDividends: Money;
  readonly qualifiedDividends: Money;
  /** Net realized gains/losses by character, including explicitly supplied carryovers. */
  readonly shortTermGains: Money;
  readonly longTermGains: Money;
  readonly traditionalContributions: Money;
  /** IRA deduction eligibility/phaseouts are supplied facts, never inferred. */
  readonly eligibleTraditionalDeduction: Money;
  readonly traditionalDistributions: Money;
  readonly traditionalDistributionBasisRecovered: Money;
  readonly rothContributions: Money;
  readonly rothDistributions: Money;
  /** Explicit taxable portion after nonqualified distribution basis/ordering analysis. */
  readonly taxableRothDistributions: Money;
}
export interface TaxCalculationInput {
  readonly income: TaxIncomeFacts;
  readonly withholding: Money;
  readonly estimatedPayments: Money;
  readonly priorPaymentCredit: Money;
  readonly basicDeductionElection?: Money;
  readonly explicitTaxableBase?: Money;
  readonly adjustedGrossIncome?: Money;
  readonly modifiedAdjustedGrossIncome?: Money;
  readonly netInvestmentIncome?: Money;
  readonly additionalTaxBases?: Readonly<Record<string, Money>>;
  /** One annual employee payroll taxable-wage total across employers; separate from income recognition wages. */
  readonly employeeWages?: readonly { readonly employeeKey: string; readonly wages: Money }[];
  readonly periodicWages?: { readonly unit: "calendar_month" | "calendar_year"; readonly wages: Money };
  readonly rmd?: { readonly age: number; readonly priorYearEndBalance: Money };
  readonly unsupportedConcepts?: readonly string[];
}
export interface TaxComponent {
  readonly key: string;
  readonly base: Money;
  readonly liability: Money;
}
export interface TaxCoreResult {
  /** This result covers only the named components of this jurisdiction rule. */
  readonly coveredComponents: readonly string[];
  readonly grossBases: TaxIncomeFacts;
  readonly taxableTraditionalDistributions: Money;
  readonly taxableRothDistributions: Money;
  readonly capitalLossDeduction: Money;
  readonly unusedCapitalLoss: Money;
  readonly traditionalDeductionApplied: Money;
  readonly basicDeductionApplied: Money;
  readonly ordinaryTaxableBase: Money;
  readonly preferentialTaxableBase: Money;
  readonly ordinaryTax: Money;
  readonly preferentialTax: Money;
  readonly additionalIncomeTaxes: readonly TaxComponent[];
  readonly payrollTaxes: readonly TaxComponent[];
  readonly niit: Money;
  readonly periodicEmployeeTax: Money;
  readonly requiredMinimumDistribution?: Money;
  readonly totalLiability: Money;
  readonly payments: { readonly withholding: Money; readonly estimated: Money; readonly priorCredit: Money; readonly total: Money };
  readonly balanceDue: Money;
  readonly refundableAmount: Money;
  readonly appliedRules: readonly { readonly id: FinancialRuleId; readonly version: string }[];
  readonly catalogFingerprint: string;
  readonly traceRefs: readonly CalculationTraceRef[];
}
