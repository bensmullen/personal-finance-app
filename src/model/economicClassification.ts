/** Economic classification depends on canonical account type, never a label. */
export type AccountEconomicClass = "household_cash" | "investment_wrapper" | "retirement_wrapper" | "restricted_wrapper" | "unsupported";

export const classifyAccountEconomics = (accountType: unknown): AccountEconomicClass => {
  if (["checking", "savings", "cash"].includes(String(accountType))) return "household_cash";
  if (accountType === "taxable_brokerage") return "investment_wrapper";
  if (["traditional_401k", "roth_401k", "traditional_ira", "roth_ira", "403b", "457b", "sep_ira", "simple_ira"].includes(String(accountType))) return "retirement_wrapper";
  if (["hsa", "hsa_investment", "529"].includes(String(accountType))) return "restricted_wrapper";
  return "unsupported";
};

export const isHouseholdCashAccount = (accountType: unknown): boolean => classifyAccountEconomics(accountType) === "household_cash";
