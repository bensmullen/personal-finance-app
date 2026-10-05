import { failValidation, issueCodes } from "../../diagnostics/index.js";
import type { Money } from "../../values/index.js";
import type { TaxCoreRule, TaxIncomeFacts, TaxJurisdictionFacts } from "./contracts.js";

/** Authoritative fact establishing equality, not a deduction/rate assumption. */
export const recognizedGrossTaxableBaseEligibilityKey = (jurisdiction: string): string => `recognized_gross_equals_legal_taxable_base:${jurisdiction}`;
export const recognizedGrossAgiEligibilityKey = (jurisdiction: string): string => `recognized_gross_equals_legal_agi:${jurisdiction}`;

/** Rules own the legal-base binding; unavailable legal relationships never default to federal income. */
export const recognizeTaxLegalBases = (rule: TaxCoreRule, income: TaxIncomeFacts, facts: TaxJurisdictionFacts): {
  readonly explicitTaxableBase?: Money;
  readonly adjustedGrossIncome?: Money;
  readonly additionalTaxBases?: Readonly<Record<string, Money>>;
} => {
  if (rule.income?.basis !== "explicit_taxable_base") return {};
  if (facts.eligibility?.[recognizedGrossTaxableBaseEligibilityKey(rule.jurisdiction)] !== true) failValidation({ severity: "error", code: issueCodes.ruleInputInvalid,
    message: `Legal taxable-base recognition for ${rule.jurisdiction} requires an explicit authoritative equality fact; no federal/coarse base is substituted.`, entityType: "tax_calculation" });
  const gross = income.wages.plus(income.taxableInterest).plus(income.ordinaryDividends).plus(income.qualifiedDividends).plus(income.shortTermGains).plus(income.longTermGains)
    .plus(income.traditionalDistributions.minus(income.traditionalDistributionBasisRecovered)).plus(income.taxableRothDistributions);
  if (rule.income.maximumAdjustedGrossIncome !== undefined && facts.eligibility?.[recognizedGrossAgiEligibilityKey(rule.jurisdiction)] !== true) failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: `Explicit legal AGI recognition for ${rule.jurisdiction} is missing.`, entityType: "tax_calculation" });
  // Additional legal categories have no generic mapping. Their missing bases stay explicit.
  return { explicitTaxableBase: gross, ...(rule.income.maximumAdjustedGrossIncome === undefined ? {} : { adjustedGrossIncome: gross }) };
};
