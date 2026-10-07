import { decimal } from "../values/index.js";
import type { JsonObject, PersonalDraft } from "./personalMvp.js";

/** Exact conversions for percentage controls; no authoritative rates are rounded. */
export function percentageToRate(value: string): string {
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("Enter a percentage such as 5 or 5.25, without the % sign.");
  return decimal(value).times(decimal("0.01")).toString();
}
export function rateToPercentage(value: unknown): string {
  if (value === undefined || value === "") return "";
  return decimal(String(value)).times(decimal("100")).toString();
}

/** Opening account display only. Never writes cash, positions or net worth;
 * unsupported valuation/currency leaves the total unavailable. */
export function openingInvestmentAccountValues(account: JsonObject, draft: PersonalDraft, currency?: string):
  { total: string; cash: string; holdings: string; currency: string } | undefined {
  const unit = String(account.currency ?? currency ?? "");
  const holdings = (draft.objects.Investment ?? []).filter((value): value is JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value)).filter(holding => holding.account_id === account.account_id);
  try {
    if (!unit) return undefined;
    const holdingsValue = holdings.reduce((sum, holding) => {
      if (holding.currency != null && holding.currency !== unit) throw new Error("Currency conversion required");
      const value = holding.market_value ?? (holding.quantity != null && holding.price != null
        ? decimal(String(holding.quantity)).times(decimal(String(holding.price))).toString() : undefined);
      if (value == null) throw new Error("Holding valuation missing");
      return sum.plus(decimal(String(value)));
    }, decimal("0"));
    const cash = decimal(String(account.opening_balance ?? "0"));
    return { total: cash.plus(holdingsValue).toString(), cash: cash.toString(), holdings: holdingsValue.toString(), currency: unit };
  } catch { return undefined; }
}
