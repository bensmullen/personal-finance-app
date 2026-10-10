import type { JsonObject } from "../../src/application/personalMvp.js";

const optionFields = new Set(["underlying_investment_id", "strike_price", "expiration_date", "contract_multiplier"]);
const fixedIncomeFields = new Set(["face_value", "maturity_date", "coupon_rate", "interest_convention", "crediting_frequency", "first_credit_date", "settlement_account_id"]);
/** Presentation of the existing D1 product boundary; never removes stored facts. */
export function investmentFieldApplies(name: string, holding: JsonObject): boolean {
  if (name === "instrument_subtype") return holding.investment_type === "option" || holding.investment_type === "bond";
  if (optionFields.has(name)) return holding.investment_type === "option" && holding.instrument_subtype === "long_equity_call";
  if (fixedIncomeFields.has(name)) return holding.investment_type === "bond" && ["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(String(holding.instrument_subtype));
  return true;
}
export function investmentProductNotice(holding: JsonObject): string | undefined {
  if (holding.investment_type === "option" && holding.instrument_subtype !== "long_equity_call") return "Choose a supported long equity call product to review its terms. Other option products cannot execute in this forecast.";
  if (holding.investment_type === "bond" && !["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(String(holding.instrument_subtype))) return "Choose a supported Treasury or CD product to review its terms. Other fixed-income products cannot execute in this forecast.";
  return undefined;
}
