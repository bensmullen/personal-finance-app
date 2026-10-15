import type { JsonObject, PersonalDraft } from "./personalMvp.js";
import { objects } from "./compiler/shared.js";
import { Currency, Money, RoundingPolicy, decimal } from "../values/index.js";

const record = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
export interface SavedDomainActivity { readonly event: JsonObject; readonly effect: JsonObject; readonly primitive: JsonObject; readonly terms: JsonObject; }
/** Read the original D1 event identity; indirect deposits retain their source link. */
export function domainActivities(model: PersonalDraft): readonly SavedDomainActivity[] {
  const rows: SavedDomainActivity[] = [];
  for (const event of objects(model, "Event")) {
    const ids = event.effect_ids;
    if (!Array.isArray(ids) || ids.length !== 1) continue;
    const effect = objects(model, "EventEffect").find(item => item.event_effect_id === ids[0]);
    if (!effect || !["d1_domain", "d1_refinance", "d1_mortgage_extra"].includes(String(effect.operation))) continue;
    const primitive = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === effect.primitive_instance_id);
    if (!primitive || !record(primitive.parameters)) continue;
    if (!["d1-domain-operation/v1", "d1-mortgage-extra/v1", "d1-refinance/v1"].includes(String(primitive.parameters.adapter))) continue;
    rows.push({ event, effect, primitive, terms: primitive.parameters });
  }
  return rows;
}
export function holdingDomainActivities(model: PersonalDraft, holdingId: string): readonly SavedDomainActivity[] {
  const rows = domainActivities(model);
  return rows.filter(row => row.terms.holdingId === holdingId || row.terms.kind === "indirect_deposit" && rows.some(distribution => distribution.event.event_id === row.terms.linkedOperationId && distribution.terms.kind === "indirect_distribution" && distribution.terms.holdingId === holdingId));
}
/** Contract arithmetic only; D1 still validates funding, lots and settlement. */
export function callExerciseAmount(model: PersonalDraft, holdingId: string, contracts: string): string | undefined {
  const holding = objects(model, "Investment").find(item => item.investment_id === holdingId);
  const account = objects(model, "Account").find(item => item.account_id === holding?.account_id);
  if (!holding || holding.instrument_subtype !== "long_equity_call" || !account || !/^\d+$/.test(contracts) || !decimal(contracts).isPositive() || typeof holding.strike_price !== "string" || typeof holding.contract_multiplier !== "number" && typeof holding.contract_multiplier !== "string") return undefined;
  try {
    const currency = Currency.of(String(account.currency));
    const units = decimal(contracts).times(decimal(String(holding.contract_multiplier)));
    return Money.parse(holding.strike_price, currency).times(units).round(new RoundingPolicy(currency.minorUnitScale, "half_even")).amount.toString();
  } catch { return undefined; }
}
