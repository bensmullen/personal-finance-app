import type { PayrollContributionPlan } from "../../src/application/personalMvp.js";
/** Eligibility filters mirror the existing D1 destination contract; the adapter still validates saves. */
export function payrollCharacters(accountType: unknown): readonly PayrollContributionPlan["character"][] {
  if (accountType === "hsa" || accountType === "hsa_investment") return ["employee_hsa", "employer_hsa"];
  if (accountType === "roth_401k") return ["roth_401k"];
  if (accountType === "traditional_401k") return ["traditional_401k", "after_tax_401k", "employer_401k"];
  return [];
}
export function authoringFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("HISTORICAL_SCOPE_CONFLICT")) return "The prior-history and future contribution facts for the same holding and year disagree. Review both named eligibility scopes below and make their shared facts consistent before saving prior usage.";
  if (text.includes("OPENING_USAGE_SCOPE_REQUIRED")) return "Define the historical account or employer plan for every retirement holding in the boundary year, then save each scope before confirming prior usage.";
  if (text.includes("CONTRIBUTION_LAW_YEAR_UNAVAILABLE")) return "Historical contribution limits here cover 2026. Choose a 2026 boundary and eligibility year; later historical years require supported law coverage.";
  if (text.includes("CONTRIBUTION_AGE_REQUIRED")) return "Enter age at the end of the contribution year in the affected annual eligibility facts, then save that scope.";
  if (text.includes("PLAN_COMPENSATION_REQUIRED")) return "Enter annual pay eligible for the affected employer plan, then save its annual eligibility facts.";
  if (text.includes("ROTH_CATCHUP_PLAN_AND_PRIOR_WAGES_REQUIRED")) return "For catch-up eligibility, record whether this employer plan has a Roth feature and, when it does, last year’s wages with that employer.";
  if (text.includes("HSA_FULL_YEAR_ELIGIBILITY_AND_COVERAGE_REQUIRED")) return "Confirm full-year HSA eligibility and choose self or family coverage in the affected scope. Partial-year eligibility is not modeled here.";
  if (text.includes("HSA_FAMILY_ALLOCATION")) return "Review your share of the family HSA allowance in annual eligibility facts. It must be known and within the supported family limit.";
  if (text.includes("IRA_TAXABLE_COMPENSATION_REQUIRED")) return "Enter full-year IRA-eligible earned pay in the affected annual eligibility facts, then save that scope.";
  if (text.includes("IRA_FILING_STATUS_REQUIRED")) return "Choose the contribution year’s filing status in the affected IRA eligibility facts.";
  if (text.includes("ROTH_MAGI_REQUIRED")) return "Enter income for Roth IRA eligibility from the contribution year’s tax worksheet, then save that scope.";
  if (text.includes("IRA_SPOUSE_RESIDENCE_REQUIRED")) return "Record whether you lived with your spouse in that contribution year, then save the IRA eligibility facts.";
  if (text.includes("OPENING_USAGE_SPLIT_INVALID")) return "The amount excluding catch-up cannot exceed the total. A January 1 boundary requires zero prior usage in that year.";
  if (text.includes("OPENING_USAGE_CATCHUP_INVALID")) return "Review the total and catch-up split against the saved age and employer Roth eligibility facts. The recorded catch-up exceeds the supported allowance or uses the wrong contribution character.";
  if (text.includes("OPENING_USAGE_CONFIRMATION_REQUIRED")) return "Choose a valid forecast boundary and confirm all earlier contributions, including known zero amounts.";
  if (/UNSUPPORTED|COMPLEXITY/.test(text)) return "This financial feature is not supported here. Keep the recorded facts and import a model using a supported contribution path.";
  if (/AMOUNT|FIXED_AMOUNT/.test(text)) return "Review the contribution amount. Use dollars in the account currency with valid currency precision; personal purchases must be greater than zero.";
  if (/RATE/.test(text)) return "Review the contribution percentage. Payroll rates and owned shares must be between 0 and 100%.";
  if (/CURRENCY|CHECKING|SAVINGS/.test(text)) return "Choose checking or savings in the destination account currency. Retirement and brokerage accounts cannot fund this purchase.";
  if (/DATE|SCHEDULE/.test(text)) return "Review the activity dates and supported schedule before saving.";
  if (/immutable|cannot.*change|not mutable/i.test(text)) return "This fact was set when the record was created. Import corrected records to change it safely.";
  if (/^[A-Z][A-Z0-9_]+$/.test(text)) {
    if (text.includes("COMPENSATION") || text.includes("FACT") || text.includes("ELIGIB")) return "Review annual eligibility facts. Unknown facts cannot establish contribution capacity.";
    if (text.includes("PRIORITY") || text.includes("ORDER")) return "Use distinct whole-number contribution orders. Employee contributions must precede employer matches.";
    if (text.includes("DESTINATION") || text.includes("OWNER")) return "Choose a compatible holding and gross salary belonging to the same person.";
    if (text.includes("MATCH") || text.includes("VESTING")) return "Review the employer contribution method and owned share; employee contributions cannot use employer matching.";
    if (text.includes("UNVESTED")) return "Unvested units must be a nonnegative subset of the holding's opening units.";
    return "These choices could not be saved. Review the amount, dates, account relationships and annual facts. The original reason is in Technical details.";
  }
  return "Nothing was saved. Review the required facts and account relationships, then try again. The original reason is in Technical details.";
}
