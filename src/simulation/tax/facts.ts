import { ValidationError } from "../../diagnostics/index.js";
import type { TaxEligibilityPeriod } from "./contracts.js";
export const activeTaxFact = (period: { readonly effective_date: string; readonly expiration_date?: string }, date: string): boolean => period.effective_date <= date && (period.expiration_date === undefined || date < period.expiration_date);
export const resolveTaxEligibility = (entries: readonly TaxEligibilityPeriod[], at: string): Readonly<Record<string, boolean>> => {
  const facts: Record<string, boolean> = {};
  for (const item of entries.filter(entry => activeTaxFact(entry, at))) {
    if (facts[item.key] !== undefined && facts[item.key] !== item.value) throw new ValidationError({ severity: "error", code: "TAX_FACT_INVALID", message: `Contradictory eligibility for ${item.key}.`, entityType: "tax_facts" });
    facts[item.key] = item.value;
  }
  return Object.freeze(facts);
};
