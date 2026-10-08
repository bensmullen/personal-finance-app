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
  if (/^[A-Z][A-Z0-9_]+$/.test(text)) {
    if (text.includes("COMPENSATION") || text.includes("FACT") || text.includes("ELIGIB")) return "Review annual eligibility facts. Unknown facts cannot establish contribution capacity.";
    if (text.includes("PRIORITY") || text.includes("ORDER")) return "Use distinct whole-number contribution orders. Employee contributions must precede employer matches.";
    if (text.includes("DESTINATION") || text.includes("OWNER")) return "Choose a compatible holding and gross salary belonging to the same person.";
    if (text.includes("MATCH") || text.includes("VESTING")) return "Review the employer contribution method and owned share; employee contributions cannot use employer matching.";
    if (text.includes("UNVESTED")) return "Unvested units must be a nonnegative subset of the holding's opening units.";
    return "These choices could not be saved. Review the amount, dates, account relationships and annual facts. The original reason is in Technical details.";
  }
  return text || "These choices could not be saved. Review the marked fields.";
}
