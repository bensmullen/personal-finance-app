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
