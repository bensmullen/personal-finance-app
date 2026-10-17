import type { Money } from "../../../values/index.js";
import { complete, contextIssues, day, diagnostic, incomplete, law, min, positive, trace, validMoney, zero, type Context, type Outcome, type OwnerId, type Predicate, type PropertyId } from "./common.js";

export interface LandParcel {
  readonly id: PropertyId;
  readonly owner: OwnerId;
  readonly propertyClass: "nondepreciable_land" | "rental_building" | "commercial_building" | "land_with_improvements" | "cost_segregated" | "other";
  readonly fairValue: Money;
  readonly domestic: Predicate;
  readonly realProperty: Predicate;
  readonly qualifyingUse: Predicate;
  readonly notHeldForSale: Predicate;
  readonly depreciationHistory: "verified_never_depreciable" | "depreciable" | "unknown";
  readonly sources: readonly string[];
}
export interface ExchangeInput {
  readonly context: Context;
  readonly exchangeId: string;
  readonly relinquished: LandParcel;
  readonly replacement: LandParcel;
  readonly transferDate: string;
  readonly signedIdentificationDate: string;
  readonly receiptDate: string;
  /** Documented legal due date, including supported extensions; not actual filing date. */
  readonly federalReturnDueDate: string;
  readonly adjustedBasis: Money;
  readonly basisSources: readonly string[];
  readonly cashPaid: Money;
  readonly cashReceived: Money;
  readonly nonLikeBootReceived: Money;
  readonly liabilitiesRelieved: Money;
  readonly liabilitiesAssumed: Money;
  readonly qualifyingCosts: Money;
  readonly predicates: {
    readonly likeKind: Predicate;
    readonly sameTaxpayerOwnership: Predicate;
    readonly qualifiedIntermediary: Predicate;
    readonly noActualOrConstructiveReceipt: Predicate;
    readonly signedIdentificationDelivered: Predicate;
    readonly dueDateAndExtensionsVerified: Predicate;
    readonly ordinaryDebtPrincipalOnly: Predicate;
    readonly costsQualify: Predicate;
    readonly bootValuationAndTreatmentVerified: Predicate;
    readonly unrelatedParties: Predicate;
    readonly deferredOneForOneOnly: Predicate;
    readonly noOtherPropertyGiven: Predicate;
    readonly noSellerFinancingOrSpecialStructures: Predicate;
    readonly noRecaptureOrSpecialGainCategories: Predicate;
  };
}
export type ExchangeResult =
  | { readonly eligibility: "ineligible"; readonly reasons: readonly string[] }
  | { readonly eligibility: "eligible"; readonly exchangeId: string; readonly relinquished: PropertyId; readonly replacement: PropertyId;
      readonly realizedGainOrLoss: Money; readonly recognizedGain: Money; readonly recognizedLoss: Money;
      readonly deferredGainOrLoss: Money; readonly replacementBasis: Money; readonly nonLikeBootBasis: Money;
      readonly netDebtBoot: Money; readonly taxableBoot: Money; readonly costsAgainstBoot: Money; readonly costsToBasis: Money };

const requiredPredicates = [
  "likeKind", "sameTaxpayerOwnership", "qualifiedIntermediary", "noActualOrConstructiveReceipt",
  "signedIdentificationDelivered", "dueDateAndExtensionsVerified", "ordinaryDebtPrincipalOnly", "costsQualify",
  "bootValuationAndTreatmentVerified", "unrelatedParties", "deferredOneForOneOnly", "noOtherPropertyGiven",
  "noSellerFinancingOrSpecialStructures", "noRecaptureOrSpecialGainCategories",
] as const;

/** Form 8824 lines 15–25 for the approved non-depreciable land subset only. */
export const evaluateLandExchange = (input: ExchangeInput): Outcome<ExchangeResult> => {
  const t = trace(input.context, input, "1031");
  const issues = contextIssues(input.context), negatives: string[] = [];
  const r = input.relinquished, p = input.replacement;
  for (const parcel of [r, p]) {
    if (parcel.propertyClass !== "nondepreciable_land" || parcel.depreciationHistory !== "verified_never_depreciable") issues.push(diagnostic("DEPRECIABLE_OR_UNVERIFIED_PROPERTY_UNSUPPORTED", parcel.id, "unsupported"));
    if (!parcel.id || !parcel.owner || !parcel.sources.length) issues.push(diagnostic("PROPERTY_PROVENANCE_REQUIRED", parcel.id));
    for (const [key, fact] of Object.entries({ domestic: parcel.domestic, realProperty: parcel.realProperty, qualifyingUse: parcel.qualifyingUse, notHeldForSale: parcel.notHeldForSale })) {
      if (!fact || fact.value === "unknown" || !fact.evidence.length) issues.push(diagnostic(`PROPERTY_${key}_UNKNOWN`, parcel.id, "legal_unknown"));
      else if (!fact.value) {
        if (key === "domestic") issues.push(diagnostic("FOREIGN_PROPERTY_UNSUPPORTED", parcel.id, "unsupported"));
        else negatives.push(`${parcel.id}:${key}`);
      }
    }
  }
  for (const key of requiredPredicates) {
    const fact = input.predicates[key];
    if (!fact || fact.value === "unknown" || !fact.evidence.length) issues.push(diagnostic(`EXCHANGE_${key}_UNKNOWN`, "1031", "legal_unknown"));
    else if (fact.value === false) {
      if (["unrelatedParties", "deferredOneForOneOnly", "noOtherPropertyGiven", "noSellerFinancingOrSpecialStructures", "noRecaptureOrSpecialGainCategories", "ordinaryDebtPrincipalOnly", "costsQualify", "bootValuationAndTreatmentVerified", "dueDateAndExtensionsVerified"].includes(key)) issues.push(diagnostic(`EXCHANGE_${key}_UNSUPPORTED`, "1031", "unsupported"));
      else negatives.push(key);
    }
  }
  if (!input.exchangeId || r.id === p.id || !input.basisSources.length) issues.push(diagnostic("EXCHANGE_ID_OR_BASIS_PROVENANCE_INVALID", "1031", "invalid"));
  if (r.owner !== input.context.owner || p.owner !== input.context.owner) negatives.push("taxpayer_ownership_mismatch");
  const amounts = [r.fairValue, p.fairValue, input.adjustedBasis, input.cashPaid, input.cashReceived, input.nonLikeBootReceived, input.liabilitiesRelieved, input.liabilitiesAssumed, input.qualifyingCosts];
  if (!validMoney(amounts, true)) issues.push(diagnostic("EXCHANGE_MONEY_INVALID", "1031", "invalid"));
  try {
    const start = day(input.transferDate), identified = day(input.signedIdentificationDate), received = day(input.receiptDate), due = day(input.federalReturnDueDate);
    if (Number(input.transferDate.slice(0, 4)) !== input.context.taxYear || due < start || identified < start || received < start || identified > received) issues.push(diagnostic("EXCHANGE_DATE_CONTEXT_INVALID", "1031", "invalid"));
    // Inclusive civil endpoints correspond to half-open [start, deadline + 1 day).
    if (identified >= start + law.identificationDays + 1) negatives.push("identification_after_45_days");
    if (received >= Math.min(start + law.exchangeDays, due) + 1) negatives.push("receipt_after_exchange_deadline");
  } catch { issues.push(diagnostic("DATE_INVALID", "1031", "invalid")); }
  if (issues.length) return incomplete(t, issues);
  if (negatives.length) return complete(t, { eligibility: "ineligible", reasons: negatives });
  // Verify consideration independently of costs paid to exchange professionals.
  const given = r.fairValue.plus(input.liabilitiesAssumed).plus(input.cashPaid);
  const received = p.fairValue.plus(input.liabilitiesRelieved).plus(input.cashReceived).plus(input.nonLikeBootReceived);
  if (!given.equals(received)) return incomplete(t, [diagnostic("EXCHANGE_CONSIDERATION_DOES_NOT_RECONCILE", "1031", "invalid")]);
  const paidAndAssumed = input.cashPaid.plus(input.liabilitiesAssumed);
  const netDebtBoot = positive(input.liabilitiesRelieved.minus(paidAndAssumed));
  const grossBoot = input.cashReceived.plus(input.nonLikeBootReceived).plus(netDebtBoot);
  const costsAgainstBoot = min(grossBoot, input.qualifyingCosts);
  const taxableBoot = grossBoot.minus(costsAgainstBoot);
  const costsToBasis = input.qualifyingCosts.minus(costsAgainstBoot);
  const line18 = input.adjustedBasis.plus(costsToBasis).plus(positive(paidAndAssumed.minus(input.liabilitiesRelieved)));
  const realized = p.fairValue.plus(taxableBoot).minus(line18);
  const recognized = min(positive(realized), taxableBoot);
  const deferred = realized.minus(recognized);
  return complete(t, { eligibility: "eligible", exchangeId: input.exchangeId, relinquished: r.id, replacement: p.id,
    realizedGainOrLoss: realized, recognizedGain: recognized, recognizedLoss: zero, deferredGainOrLoss: deferred,
    replacementBasis: p.fairValue.minus(deferred), nonLikeBootBasis: input.nonLikeBootReceived,
    netDebtBoot, taxableBoot, costsAgainstBoot, costsToBasis });
};
