import { domainId } from "../identity/index.js";
import { createFundingPolicy, fundingPolicyId } from "../funding/index.js";
import { instant, civilDate } from "../time/index.js";
import type { PersonalDraft } from "./personalMvp.js";
import { objects, canonicalId, resolveHouseholdScope, type CanonicalObject } from "./compiler/shared.js";
import { compileHouseholdTax, type HouseholdTaxCompilerRequest } from "./compiler/tax.js";

export interface TaxForecastSettlementSetup {
  readonly paymentAccountId: string;
  readonly refundAccountId: string;
  readonly conventions: readonly { readonly jurisdiction: string; readonly monthDay: string; readonly priority: number; readonly confirmed: boolean }[];
}

/** Explicit locations only; unknown local applicability remains a scoped limitation. */
export function forecastTaxJurisdictions(model: PersonalDraft): readonly string[] {
  const compiled = compileHouseholdTax(model);
  if (compiled.status !== "compiled") return [];
  const scope = resolveHouseholdScope(model);
  if (scope.status !== "compiled") return [];
  // Portfolio/domain income may exist without an authored Income stream.
  // These residence records were validated by compileHouseholdTax above.
  const residences = objects(model, "Person").filter(person => scope.value.memberIds.includes(canonicalId(person, "person_id") ?? "")).flatMap(person => (person.residence_jurisdiction_periods ?? []) as readonly CanonicalObject[]);
  const locations = [...compiled.value.incomes.flatMap(income => [...income.residence, ...income.work]), ...residences].flatMap(fact => [String(fact.state_jurisdiction), ...(fact.local_jurisdiction === undefined ? [] : [String(fact.local_jurisdiction)])]).map(value => value.replace(/^US-/, "US:"));
  return [...new Set([...(locations.some(value => value.startsWith("US:")) ? ["US:FEDERAL"] : []), ...locations.map(value => value === "US:PA:PHILADELPHIA" ? `${value}:WAGE` : value === "US:CO:DENVER" ? `${value}:OPT` : value)])].sort();
}

export function compileForecastTaxSettlements(setup: TaxForecastSettlementSetup, start: string, end: string): HouseholdTaxCompilerRequest {
  if (!setup.paymentAccountId || !setup.refundAccountId || !setup.conventions.length) throw new Error("Choose tax payment/refund accounts and confirm a settlement date for each modeled jurisdiction.");
  civilDate(start); civilDate(end);
  const conventions = [...setup.conventions].sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  if (new Set(conventions.map(item => item.jurisdiction)).size !== conventions.length) throw new Error("Tax settlement jurisdictions must be unique.");
  const settlements = [];
  for (let year = Number(start.slice(0, 4)); `${year}-01-01` < end; year++) {
    for (const convention of conventions) {
      if (!convention.confirmed || !/^\d{2}-\d{2}$/.test(convention.monthDay) || !Number.isSafeInteger(convention.priority) || convention.priority < 0) throw new Error("Confirm each forecast settlement date and whole-number payment order.");
      const date = `${year + 1}-${convention.monthDay}`;
      civilDate(date);
      settlements.push({ id: `forecast-tax:${convention.jurisdiction}:${year}`, jurisdiction: convention.jurisdiction, taxYear: String(year), at: instant(`${date}T00:00:00.000Z`), priority: convention.priority });
    }
  }
  return { fundingPolicy: createFundingPolicy({ id: fundingPolicyId("forecast-tax-payments"), orderedSources: [{ kind: "cash_account", accountId: domainId("account", setup.paymentAccountId) }], allowPartial: false, insufficientFundsBehavior: "unfunded" }), refundAccountId: domainId("account", setup.refundAccountId), settlements };
}

export function forecastTaxSetupProblem(model: PersonalDraft, setup: TaxForecastSettlementSetup | undefined, start: string, end: string): string | undefined {
  const jurisdictions = forecastTaxJurisdictions(model);
  if (!jurisdictions.length) return undefined;
  try {
    if (!setup || jurisdictions.some(jurisdiction => !setup.conventions.some(item => item.jurisdiction === jurisdiction && item.confirmed))) throw new Error("Tax payments & refunds: choose accounts and confirm a forecast settlement date for each modeled jurisdiction.");
    const bankIds = new Set(objects(model, "Account").filter(item => ["checking", "savings"].includes(String(item.account_type))).map(item => canonicalId(item, "account_id")));
    if (!bankIds.has(setup.paymentAccountId) || !bankIds.has(setup.refundAccountId)) throw new Error("Tax payments & refunds: choose checking or savings accounts.");
    const compiled = compileHouseholdTax(model, compileForecastTaxSettlements(setup, start, end));
    if (compiled.status !== "compiled") throw new Error(compiled.diagnostics.map(item => item.message).join(" "));
    if (![setup.paymentAccountId, setup.refundAccountId].every(id => id in (compiled.value.accountTaxTreatments ?? {}))) throw new Error("Tax payments & refunds: choose accounts owned by the modeled household.");
  } catch (error) { return error instanceof Error ? error.message : "Tax payments & refunds need setup."; }
  return undefined;
}
